import { supabase } from "@/lib/supabase";
import { desktopApi } from "@/lib/desktopApi";
import { getDeploymentMode, getTenantIdFromEnv } from "@/lib/deployment";

type SyncQueueRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload: Record<string, unknown>;
};

export type LocalSyncStatus = {
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
};

const LOCAL_SYNC_STATUS_KEY = "boat.local.sync.status.v1";
const LOCAL_SYNC_STATUS_EVENT = "boat-local-sync-status-changed";

const DEFAULT_LOCAL_SYNC_STATUS: LocalSyncStatus = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
};

function emitLocalSyncStatusChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LOCAL_SYNC_STATUS_EVENT));
}

function writeLocalSyncStatus(next: LocalSyncStatus) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_SYNC_STATUS_KEY, JSON.stringify(next));
    emitLocalSyncStatusChanged();
  } catch {
    // Ignore storage errors for non-critical sync status metadata.
  }
}

export function readLocalSyncStatus(): LocalSyncStatus {
  if (typeof window === "undefined") return DEFAULT_LOCAL_SYNC_STATUS;
  try {
    const raw = window.localStorage.getItem(LOCAL_SYNC_STATUS_KEY);
    if (!raw) return DEFAULT_LOCAL_SYNC_STATUS;
    const parsed = JSON.parse(raw) as Partial<LocalSyncStatus>;
    return {
      lastAttemptAt: typeof parsed.lastAttemptAt === "number" ? parsed.lastAttemptAt : null,
      lastSuccessAt: typeof parsed.lastSuccessAt === "number" ? parsed.lastSuccessAt : null,
      lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
    };
  } catch {
    return DEFAULT_LOCAL_SYNC_STATUS;
  }
}

export function localSyncStatusEventName(): string {
  return LOCAL_SYNC_STATUS_EVENT;
}

function requireTenantId(): string {
  const tenantId = getTenantIdFromEnv();
  if (!tenantId) {
    throw new Error("Missing tenant ID. Set VITE_TENANT_ID (or VITE_LOCAL_ORGANIZATION_ID) to the cloud organization UUID.");
  }
  return tenantId;
}

async function pushRetailCustomer(row: SyncQueueRow, tenantId: string) {
  if (row.operation === "DELETE") {
    const { error } = await supabase
      .from("retail_customers")
      .delete()
      .eq("id", row.entity_id)
      .eq("organization_id", tenantId);
    if (error) throw new Error(error.message);
    return;
  }

  const p = row.payload || {};
  const payload = {
    id: String(p.id || row.entity_id),
    organization_id: tenantId,
    name: String(p.name || ""),
    email: (p.email as string | null) ?? null,
    phone: (p.phone as string | null) ?? null,
    address: (p.address as string | null) ?? null,
    notes: (p.notes as string | null) ?? null,
    created_at: (p.created_at as string | null) ?? new Date().toISOString(),
    updated_at: (p.updated_at as string | null) ?? new Date().toISOString(),
  };
  const { error } = await supabase.from("retail_customers").upsert(payload, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

async function pushRetailSale(row: SyncQueueRow, tenantId: string) {
  const p = row.payload || {};
  const lines = (Array.isArray(p.lines) ? p.lines : []) as Array<Record<string, unknown>>;
  const payments = (Array.isArray(p.payments) ? p.payments : []) as Array<Record<string, unknown>>;
  const salePayload = {
    id: String(p.id || row.entity_id),
    organization_id: tenantId,
    sale_at: (p.sale_at as string | null) ?? new Date().toISOString(),
    customer_name: (p.customer_name as string | null) ?? null,
    customer_phone: (p.customer_phone as string | null) ?? null,
    total_amount: Number(p.total_amount || 0),
    amount_paid: Number(p.amount_paid || 0),
    amount_due: Number(p.amount_due || 0),
    change_amount: Number(p.change_amount || 0),
    payment_status: String(p.payment_status || "completed"),
    sale_type: String(p.sale_type || "cash"),
    credit_due_date: (p.credit_due_date as string | null) ?? null,
    vat_enabled: !!p.vat_enabled,
    vat_rate: p.vat_rate == null ? null : Number(p.vat_rate),
  };
  const { error: saleErr } = await supabase.from("retail_sales").upsert(salePayload, { onConflict: "id" });
  if (saleErr) throw new Error(saleErr.message);

  await supabase.from("retail_sale_lines").delete().eq("sale_id", salePayload.id);
  await supabase.from("retail_sale_payments").delete().eq("sale_id", salePayload.id);

  if (lines.length > 0) {
    const rows = lines.map((line, idx) => ({
      sale_id: salePayload.id,
      line_no: idx + 1,
      product_id: (line.product_id as string | null) ?? null,
      description: (line.description as string | null) ?? null,
      quantity: Number(line.quantity || 0),
      unit_price: Number(line.unit_price || 0),
      line_total: Number(line.line_total || 0),
      unit_cost: line.unit_cost == null ? null : Number(line.unit_cost),
      department_id: (line.department_id as string | null) ?? null,
      track_inventory: line.track_inventory !== false,
    }));
    const { error } = await supabase.from("retail_sale_lines").insert(rows);
    if (error) throw new Error(error.message);
  }

  if (payments.length > 0) {
    const rows = payments.map((pay) => ({
      sale_id: salePayload.id,
      payment_method: String(pay.payment_method || "cash"),
      amount: Number(pay.amount || 0),
      payment_status: String(pay.payment_status || "completed"),
    }));
    const { error } = await supabase.from("retail_sale_payments").insert(rows);
    if (error) throw new Error(error.message);
  }
}

export async function pushPendingLocalSyncQueue(): Promise<{ ok: number; failed: number; total: number }> {
  if (!desktopApi.isAvailable()) return { ok: 0, failed: 0, total: 0 };
  const startedAt = Date.now();
  try {
    const tenantId = requireTenantId();
    const rows = (await desktopApi.listPendingSyncQueue()) as SyncQueueRow[];
    let ok = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        if (row.entity_type === "retail_customers") {
          await pushRetailCustomer(row, tenantId);
        } else if (row.entity_type === "retail_sales") {
          await pushRetailSale(row, tenantId);
        }
        await desktopApi.setSyncQueueStatus({ id: row.id, status: "synced", lastError: null });
        ok += 1;
      } catch (e) {
        await desktopApi.setSyncQueueStatus({
          id: row.id,
          status: "failed",
          lastError: e instanceof Error ? e.message : "Sync failed",
        });
        failed += 1;
      }
    }
    writeLocalSyncStatus({
      lastAttemptAt: startedAt,
      lastSuccessAt: ok > 0 && failed === 0 ? Date.now() : readLocalSyncStatus().lastSuccessAt,
      lastError: failed > 0 ? `${failed} row(s) failed during last sync.` : null,
    });
    return { ok, failed, total: rows.length };
  } catch (e) {
    writeLocalSyncStatus({
      lastAttemptAt: startedAt,
      lastSuccessAt: readLocalSyncStatus().lastSuccessAt,
      lastError: e instanceof Error ? e.message : "Sync failed",
    });
    throw e;
  }
}

export function canRunLocalSyncWorker(): boolean {
  return getDeploymentMode() === "lan" && desktopApi.isAvailable() && Boolean(getTenantIdFromEnv());
}

