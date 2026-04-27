import { randomUuid } from "./randomUuid";

export interface OfflineRetailPayment {
  method: "cash" | "card" | "bank_transfer" | "mtn_mobile_money" | "airtel_money";
  amount: number;
  status: "pending" | "completed";
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
    return parsed as OfflineRetailSale[];
  } catch {
    return [];
  }
}

function writeOfflineRetailQueue(rows: OfflineRetailSale[]) {
  if (!hasWindow()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

export function enqueueOfflineRetailSale(
  payload: Omit<OfflineRetailSale, "id" | "createdAt">
): OfflineRetailSale {
  const next: OfflineRetailSale = {
    ...payload,
    id: randomUuid(),
    createdAt: new Date().toISOString(),
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
