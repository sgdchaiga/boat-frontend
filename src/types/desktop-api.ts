export type PosProduct = {
  id: string;
  name: string;
  sku: string | null;
  selling_price: number;
  qty_on_hand: number;
  is_active: number;
  created_at: string;
  updated_at: string;
};

export type PosProductUpsertInput = {
  id: string;
  name: string;
  sku?: string | null;
  selling_price?: number;
  qty_on_hand?: number;
  is_active?: boolean;
};

export type LocalCustomer = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  id_type: string | null;
  id_number: string | null;
  address: string | null;
  created_at: string;
};

export type LocalCustomerCreateInput = {
  id?: string;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  id_type?: string | null;
  id_number?: string | null;
  address?: string | null;
};

export type BoatDesktopSettings = {
  apiBaseUrl: string;
  deploymentMode: "lan" | "server" | "wan";
  businessType: string;
};

export type BoatApiHealth = {
  ok: boolean;
  status: number;
  baseUrl: string;
  service: string | null;
  time: string | null;
  message: string | null;
};

export type BoatBootstrapAdmin = {
  email: string;
  password: string;
  full_name: string;
  role?: string;
  phone?: string;
  staff_code?: string;
  pin?: string;
};

export type BoatDesktopApi = {
  health: () => Promise<{ ok: boolean; dataMode?: "sqlite"; sqlitePath: string }>;
  settings: {
    get: () => Promise<BoatDesktopSettings>;
    update: (payload: Partial<BoatDesktopSettings>) => Promise<BoatDesktopSettings>;
  };
  api: {
    health: (payload?: { baseUrl?: string }) => Promise<BoatApiHealth>;
  };
  bootstrapAdmin?: {
    peek: () => Promise<BoatBootstrapAdmin | null>;
    consume: () => Promise<BoatBootstrapAdmin | null>;
  };
  backup: {
    createLocal: () => Promise<{ ok: boolean; backupPath: string; backupFileName: string; createdAt: string }>;
  };
  ocr?: {
    readImage: (payload: { dataUrl: string; fileName?: string }) => Promise<{ ok: boolean; text: string }>;
  };
  license: {
    getDeviceId: () => Promise<{ deviceId: string }>;
  };
  pos: {
    listProducts: () => Promise<PosProduct[]>;
    upsertProduct: (payload: PosProductUpsertInput) => Promise<{ ok: true }>;
  };
  customers: {
    list: () => Promise<LocalCustomer[]>;
    create: (payload: LocalCustomerCreateInput) => Promise<LocalCustomer>;
    update: (payload: LocalCustomerCreateInput & { id: string }) => Promise<LocalCustomer | null>;
  };
  sessions: {
    getActive: (payload: { opened_by: string }) => Promise<{ id: string; opened_at: string; opening_float: number; status: "open" | "closed" } | null>;
    open: (payload: { opened_by: string; opening_float: number }) => Promise<{ id: string; opened_at: string; opening_float: number; status: "open" | "closed" } | null>;
    close: (payload: {
      id: string;
      closed_by: string;
      closing_cash_counted: number;
      expected_cash: number;
      variance_amount: number;
    }) => Promise<{ ok: true }>;
  };
  retail: {
    createSale: (payload: Record<string, unknown>) => Promise<{ id: string; sale_at: string }>;
  };
  retailCustomers: {
    list: () => Promise<
      Array<{
        id: string;
        name: string;
        email: string | null;
        phone: string | null;
        address: string | null;
        notes: string | null;
        created_at: string;
        updated_at: string;
      }>
    >;
    create: (payload: {
      id?: string;
      name: string;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      notes?: string | null;
    }) => Promise<{
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      address: string | null;
      notes: string | null;
      created_at: string;
      updated_at: string;
    }>;
    update: (payload: {
      id: string;
      name: string;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      notes?: string | null;
    }) => Promise<{
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      address: string | null;
      notes: string | null;
      created_at: string;
      updated_at: string;
    } | null>;
    remove: (payload: { id: string }) => Promise<{ ok: true }>;
  };
  syncQueue: {
    list: () => Promise<
      Array<{
        id: string;
        entity_type: string;
        entity_id: string;
        operation: string;
        payload: Record<string, unknown>;
        status: string;
        created_at: string;
        last_error: string | null;
      }>
    >;
    listPending: () => Promise<
      Array<{
        id: string;
        entity_type: string;
        entity_id: string;
        operation: string;
        payload: Record<string, unknown>;
        status: string;
        created_at: string;
        last_error: string | null;
      }>
    >;
    setStatus: (payload: { id: string; status: string; last_error?: string | null }) => Promise<{ ok: true }>;
  };
  localStore: {
    select: (payload: {
      table: string;
      filters?: Array<{ column: string; operator: string; value: unknown }>;
      orderBy?: { column: string; ascending?: boolean };
      limit?: number;
      offset?: number;
    }) => Promise<{ rows: Record<string, unknown>[]; count: number }>;
    upsert: (payload: { table: string; rows: Record<string, unknown>[] }) => Promise<Record<string, unknown>[]>;
    update: (payload: {
      table: string;
      filters?: Array<{ column: string; operator: string; value: unknown }>;
      patch: Record<string, unknown>;
    }) => Promise<Record<string, unknown>[]>;
    delete: (payload: {
      table: string;
      filters?: Array<{ column: string; operator: string; value: unknown }>;
    }) => Promise<Record<string, unknown>[]>;
  };
};
