import type { BoatDesktopApi } from "@/types/desktop-api";

function getDesktopApi(): BoatDesktopApi | null {
  if (typeof window === "undefined") return null;
  return window.boatDesktop ?? null;
}

export const desktopApi = {
  isAvailable(): boolean {
    return getDesktopApi() !== null;
  },
  async createLocalBackup() {
    const api = getDesktopApi();
    if (!api) {
      return { ok: false as const, backupPath: "", backupFileName: "", createdAt: "" };
    }
    return api.backup.createLocal();
  },
  async health() {
    const api = getDesktopApi();
    if (!api) return { ok: false as const, sqlitePath: "" };
    return api.health();
  },
  async getDeviceId(): Promise<string | null> {
    const api = getDesktopApi();
    if (!api) return null;
    const res = await api.license.getDeviceId();
    return res?.deviceId || null;
  },
  async listPosProducts() {
    const api = getDesktopApi();
    if (!api) return [];
    return api.pos.listProducts();
  },
  async upsertPosProduct(payload: {
    id: string;
    name: string;
    sku?: string | null;
    selling_price?: number;
    qty_on_hand?: number;
    is_active?: boolean;
  }) {
    const api = getDesktopApi();
    if (!api) return { ok: false as const };
    return api.pos.upsertProduct(payload);
  },
  async listCustomers() {
    const api = getDesktopApi();
    if (!api) return [];
    return api.customers.list();
  },
  async createCustomer(payload: {
    id?: string;
    first_name: string;
    last_name: string;
    email?: string | null;
    phone?: string | null;
    id_type?: string | null;
    id_number?: string | null;
    address?: string | null;
  }) {
    const api = getDesktopApi();
    if (!api) return null;
    return api.customers.create(payload);
  },
  async getActiveSession(openedBy: string) {
    const api = getDesktopApi();
    if (!api) return null;
    return api.sessions.getActive({ opened_by: openedBy });
  },
  async openSession(openedBy: string, openingFloat: number) {
    const api = getDesktopApi();
    if (!api) return null;
    return api.sessions.open({ opened_by: openedBy, opening_float: openingFloat });
  },
  async closeSession(payload: {
    id: string;
    closedBy: string;
    closingCashCounted: number;
    expectedCash: number;
    varianceAmount: number;
  }) {
    const api = getDesktopApi();
    if (!api) return { ok: false as const };
    return api.sessions.close({
      id: payload.id,
      closed_by: payload.closedBy,
      closing_cash_counted: payload.closingCashCounted,
      expected_cash: payload.expectedCash,
      variance_amount: payload.varianceAmount,
    });
  },
  async createRetailSale(payload: Record<string, unknown>) {
    const api = getDesktopApi();
    if (!api) return null;
    return api.retail.createSale(payload);
  },
  async listRetailCustomers() {
    const api = getDesktopApi();
    if (!api) return [];
    return api.retailCustomers.list();
  },
  async createRetailCustomer(payload: {
    id?: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    notes?: string | null;
  }) {
    const api = getDesktopApi();
    if (!api) return null;
    return api.retailCustomers.create(payload);
  },
  async updateRetailCustomer(payload: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    notes?: string | null;
  }) {
    const api = getDesktopApi();
    if (!api) return null;
    return api.retailCustomers.update(payload);
  },
  async deleteRetailCustomer(id: string) {
    const api = getDesktopApi();
    if (!api) return { ok: false as const };
    return api.retailCustomers.remove({ id });
  },
  async listSyncQueue() {
    const api = getDesktopApi();
    if (!api) return [];
    return api.syncQueue.list();
  },
  async listPendingSyncQueue() {
    const api = getDesktopApi();
    if (!api) return [];
    return api.syncQueue.listPending();
  },
  async setSyncQueueStatus(payload: { id: string; status: string; lastError?: string | null }) {
    const api = getDesktopApi();
    if (!api) return { ok: false as const };
    return api.syncQueue.setStatus({
      id: payload.id,
      status: payload.status,
      last_error: payload.lastError ?? null,
    });
  },
  async localSelect(payload: {
    table: string;
    filters?: Array<{ column: string; operator: string; value: unknown }>;
    orderBy?: { column: string; ascending?: boolean };
    limit?: number;
    offset?: number;
  }) {
    const api = getDesktopApi();
    if (!api) return { rows: [], count: 0 };
    return api.localStore.select(payload);
  },
  async localUpsert(payload: { table: string; rows: Record<string, unknown>[] }) {
    const api = getDesktopApi();
    if (!api) return [];
    return api.localStore.upsert(payload);
  },
  async localUpdate(payload: {
    table: string;
    filters?: Array<{ column: string; operator: string; value: unknown }>;
    patch: Record<string, unknown>;
  }) {
    const api = getDesktopApi();
    if (!api) return [];
    return api.localStore.update(payload);
  },
  async localDelete(payload: {
    table: string;
    filters?: Array<{ column: string; operator: string; value: unknown }>;
  }) {
    const api = getDesktopApi();
    if (!api) return [];
    return api.localStore.delete(payload);
  },
};
