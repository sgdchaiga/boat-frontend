import { supabase } from "@/lib/supabase";

export type MainAction = "deposit" | "withdraw" | "send" | "airtime" | "bill";
export type TxStatus = "success" | "pending" | "error";
export type NetworkName = "MTN" | "Airtel" | "Bank" | "SACCO";

export interface SavedCustomer {
  id: string;
  name: string;
  phone: string;
  network: NetworkName;
}

export interface AgentTx {
  id: string;
  type: MainAction;
  customerPhone: string;
  customerName?: string;
  amount: number;
  charges: number;
  commission: number;
  createdAt: string;
  status: TxStatus;
  queuedOffline: boolean;
}

export interface StaffSummaryRow {
  name: string;
  transactions: number;
  commission: number;
  suspicious: boolean;
}

export interface AgentFloat {
  eFloat: number;
  cash: number;
}

const AGENT_CUSTOMERS_KEY = "boat.agent.saved.customers.v1";
const AGENT_TX_KEY = "boat.agent.transactions.v1";
const AGENT_PENDING_KEY = "boat.agent.pending.v1";
const AGENT_FLOAT_KEY = "boat.agent.float.v1";
const AGENT_STAFF_KEY = "boat.agent.staff.v1";

const defaultCustomers: SavedCustomer[] = [
  { id: "c1", name: "Sarah N.", phone: "0701122334", network: "MTN" },
  { id: "c2", name: "Kato S.", phone: "0756677889", network: "Airtel" },
  { id: "c3", name: "Nabirye M.", phone: "0709988776", network: "SACCO" },
];
const defaultFloat: AgentFloat = { eFloat: 2_500_000, cash: 800_000 };
const defaultStaffRows: StaffSummaryRow[] = [
  { name: "Main Agent", transactions: 42, commission: 68_500, suspicious: false },
  { name: "Shift B", transactions: 19, commission: 22_900, suspicious: false },
  { name: "Trainee", transactions: 6, commission: 3_800, suspicious: true },
];

function scopedKey(base: string, organizationId?: string | null, staffId?: string | null): string {
  const org = organizationId || "no-org";
  const staff = staffId || "no-staff";
  return `${base}:${org}:${staff}`;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function mapDbTx(row: any): AgentTx {
  return {
    id: String(row.id),
    type: row.tx_type as MainAction,
    customerPhone: row.customer_phone ?? "",
    customerName: row.customer_name ?? undefined,
    amount: Number(row.amount ?? 0),
    charges: Number(row.charges ?? 0),
    commission: Number(row.commission ?? 0),
    createdAt: row.created_at ?? new Date().toISOString(),
    status: (row.status ?? "success") as TxStatus,
    queuedOffline: false,
  };
}

export async function loadAgentHubData(organizationId?: string | null, staffId?: string | null) {
  const customersKey = scopedKey(AGENT_CUSTOMERS_KEY, organizationId, staffId);
  const txKey = scopedKey(AGENT_TX_KEY, organizationId, staffId);
  const pendingKey = scopedKey(AGENT_PENDING_KEY, organizationId, staffId);
  const floatKey = scopedKey(AGENT_FLOAT_KEY, organizationId, staffId);
  const staffKey = scopedKey(AGENT_STAFF_KEY, organizationId, staffId);

  const local = {
    customers: loadJson<SavedCustomer[]>(customersKey, defaultCustomers),
    history: loadJson<AgentTx[]>(txKey, []),
    pending: loadJson<AgentTx[]>(pendingKey, []),
    float: loadJson<AgentFloat>(floatKey, defaultFloat),
    staffRows: loadJson<StaffSummaryRow[]>(staffKey, defaultStaffRows),
  };

  if (!organizationId) return local;

  try {
    const [customersRes, txRes, floatRes] = await Promise.all([
      supabase.from("agent_customers").select("*").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(200),
      supabase.from("agent_transactions").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(200),
      supabase.from("agent_float").select("*").eq("organization_id", organizationId).maybeSingle(),
    ]);
    if (customersRes.error || txRes.error || floatRes.error) return local;
    return {
      ...local,
      customers: (customersRes.data || []).map((r: any) => ({
        id: String(r.id),
        name: r.name ?? "Customer",
        phone: r.phone ?? "",
        network: (r.network ?? "MTN") as NetworkName,
      })),
      history: (txRes.data || []).map(mapDbTx),
      float: floatRes.data
        ? { eFloat: Number(floatRes.data.e_float ?? local.float.eFloat), cash: Number(floatRes.data.cash_balance ?? local.float.cash) }
        : local.float,
    };
  } catch {
    return local;
  }
}

export async function persistCustomers(customers: SavedCustomer[], organizationId?: string | null, staffId?: string | null) {
  saveJson(scopedKey(AGENT_CUSTOMERS_KEY, organizationId, staffId), customers);
  if (!organizationId) return;
  try {
    await supabase.from("agent_customers").upsert(
      customers.map((c) => ({
        organization_id: organizationId,
        name: c.name,
        phone: c.phone,
        network: c.network,
      })),
      { onConflict: "organization_id,phone" }
    );
  } catch {
    // local fallback already persisted
  }
}

export async function persistFloat(float: AgentFloat, organizationId?: string | null, staffId?: string | null) {
  saveJson(scopedKey(AGENT_FLOAT_KEY, organizationId, staffId), float);
  if (!organizationId) return;
  try {
    await supabase.from("agent_float").upsert({
      organization_id: organizationId,
      e_float: float.eFloat,
      cash_balance: float.cash,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // local fallback already persisted
  }
}

export async function persistHistory(history: AgentTx[], organizationId?: string | null, staffId?: string | null) {
  saveJson(scopedKey(AGENT_TX_KEY, organizationId, staffId), history);
}

export async function persistPending(pending: AgentTx[], organizationId?: string | null, staffId?: string | null) {
  saveJson(scopedKey(AGENT_PENDING_KEY, organizationId, staffId), pending);
}

export async function writeOnlineTransaction(tx: AgentTx, organizationId?: string | null, staffId?: string | null) {
  if (!organizationId) return;
  try {
    await supabase.from("agent_transactions").insert({
      id: tx.id,
      organization_id: organizationId,
      agent_staff_id: staffId,
      tx_type: tx.type,
      customer_phone: tx.customerPhone,
      customer_name: tx.customerName ?? null,
      amount: tx.amount,
      charges: tx.charges,
      commission: tx.commission,
      status: tx.status,
      created_at: tx.createdAt,
    });
  } catch {
    // local fallback already persisted in history
  }
}
