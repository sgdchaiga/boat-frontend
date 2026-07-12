import { randomUuid } from "./randomUuid";

export interface OfflineRetailPayment {
  method: "cash" | "card" | "bank_transfer" | "mtn_mobile_money" | "airtel_money" | "wallet";
  amount: number;
  status: "pending" | "completed";
  glAccountId?: string | null;
  reference?: string | null;
  gatewayTransactionId?: string | number | null;
}

export interface OfflineRetailLine {
  productId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  costPrice: number | null;
  trackInventory: boolean;
  departmentId: string | null;
  name: string;
}

export interface OfflineRetailSale {
  id: string;
  createdAt: string;
  saleAt?: string;
  organizationId: string | null;
  processedBy: string | null;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  total: number;
  amountPaid: number;
  amountDue: number;
  paymentStatus: "pending" | "partial" | "completed" | "overpaid";
  payments: OfflineRetailPayment[];
  lines: OfflineRetailLine[];
  vatEnabled: boolean;
  vatRate: number | null;
  syncStatus: "queued" | "syncing" | "failed";
  syncAttempts: number;
  lastSyncAttemptAt?: string | null;
  lastSyncError?: string | null;
}

const STORAGE_KEY = "boat.retail.offline.queue.v1";

function hasWindow(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

export function readOfflineRetailQueue(): OfflineRetailSale[] {
  if (!hasWindow()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as OfflineRetailSale[]).map(normalizeOfflineRetailSale);
  } catch {
    return [];
  }
}

function writeOfflineRetailQueue(rows: OfflineRetailSale[]) {
  if (!hasWindow()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  window.dispatchEvent(new CustomEvent("boat:retail-offline-queue", { detail: { count: rows.length } }));
}

export function enqueueOfflineRetailSale(
  payload: Omit<OfflineRetailSale, "id" | "createdAt" | "syncStatus" | "syncAttempts" | "lastSyncAttemptAt" | "lastSyncError">
): OfflineRetailSale {
  const next: OfflineRetailSale = {
    ...payload,
    id: randomUuid(),
    createdAt: new Date().toISOString(),
    syncStatus: "queued",
    syncAttempts: 0,
  };
  const queue = readOfflineRetailQueue();
  queue.push(next);
  writeOfflineRetailQueue(queue);
  return next;
}

export function removeOfflineRetailSale(id: string) {
  const queue = readOfflineRetailQueue();
  writeOfflineRetailQueue(queue.filter((row) => row.id !== id));
}

export function updateOfflineRetailSaleSync(
  id: string,
  patch: Partial<Pick<OfflineRetailSale, "syncStatus" | "syncAttempts" | "lastSyncAttemptAt" | "lastSyncError">>
) {
  const queue = readOfflineRetailQueue();
  writeOfflineRetailQueue(queue.map((row) => row.id === id ? { ...row, ...patch } : row));
}

export function normalizeOfflineRetailSale(row: OfflineRetailSale): OfflineRetailSale {
  return { ...row, syncStatus: row.syncStatus || "queued", syncAttempts: Number(row.syncAttempts || 0) };
}
