import { supabase } from "@/lib/supabase";

export type LiteShortcut = { page: string; label: string; description: string; heavy?: boolean };

const KEY = "boat.mobile-lite.shortcuts.v1";
const PERSONAL_KEY = "boat.mobile-lite.personal-shortcuts.v1";

const defaults: Record<string, LiteShortcut[]> = {
  retail: [
    { page: "retail_pos", label: "New sale", description: "Sell and receive payment" },
    { page: "retail_pos_orders", label: "Orders", description: "Review recent orders" },
    { page: "retail_customers", label: "Customers", description: "Find customer accounts" },
    { page: "stock_balances", label: "Stock", description: "Check available quantities" },
  ],
  clinic: [
    { page: "clinic_pos", label: "Dispense", description: "Dispense and receive payment" },
    { page: "clinic_patients", label: "Patients", description: "Find patient records" },
    { page: "clinic_consultation", label: "Consultation", description: "Open clinical workflow" },
    { page: "stock_balances", label: "Drug stock", description: "Check medicine quantities" },
  ],
  hotel: [
    { page: "reservations", label: "Reservations", description: "Find or create a booking" },
    { page: "active_stays", label: "Active stays", description: "Guests currently checked in" },
    { page: "pos", label: "POS", description: "Record an order or payment" },
    { page: "housekeeping", label: "Housekeeping", description: "Update room status" },
  ],
  sacco: [
    { page: "sacco_teller", label: "Teller", description: "Record member transactions" },
    { page: "sacco_members", label: "Members", description: "Find a member" },
    { page: "sacco_cashbook", label: "Cashbook", description: "Review money movement" },
    { page: "sacco_loans", label: "Loans", description: "Open loan workspace" },
  ],
  school: [
    { page: "school_fee_payments", label: "Receive fees", description: "Record a student payment" },
    { page: "school_students", label: "Students", description: "Find student records" },
    { page: "school_student_invoices", label: "Invoices", description: "Review student bills" },
    { page: "school_collections_summary", label: "Collections", description: "Today’s collections" },
  ],
  vsla: [
    { page: "vsla_savings", label: "Savings", description: "Record member savings" },
    { page: "vsla_members", label: "Members", description: "Find a group member" },
    { page: "vsla_loans", label: "Loans", description: "Manage group loans" },
    { page: "vsla_meetings", label: "Meetings", description: "Open meeting workflow" },
  ],
  manufacturing: [
    { page: "manufacturing_production_entries", label: "Production", description: "Record completed output" },
    { page: "manufacturing_work_orders", label: "Work orders", description: "Review production work" },
    { page: "stock_balances", label: "Materials", description: "Check stock quantities" },
    { page: "manufacturing_costing", label: "Costing", description: "Review current costs", heavy: true },
  ],
};

export function defaultLiteShortcuts(businessType: string | null): LiteShortcut[] {
  return defaults[businessType || ""] || [
    { page: "cash_receipts", label: "Money in", description: "Record a receipt" },
    { page: "expenses", label: "Expense", description: "Record money spent" },
    { page: "transactions", label: "Transactions", description: "Review recent activity" },
    { page: "treasury", label: "Balances", description: "Check cash and bank balances" },
  ];
}

function storageKey(organizationId: string | null, role: string | null) {
  return `${KEY}:${organizationId || "none"}:${role || "staff"}`;
}

function personalStorageKey(organizationId: string | null, role: string | null) {
  return `${PERSONAL_KEY}:${organizationId || "none"}:${role || "staff"}`;
}

export function writePersonalLiteShortcuts(organizationId: string | null, role: string | null, rows: LiteShortcut[]) {
  localStorage.setItem(personalStorageKey(organizationId, role), JSON.stringify(rows.slice(0, 6)));
}

function readPersonalLiteShortcuts(organizationId: string | null, role: string | null): LiteShortcut[] | null {
  try {
    const rows = JSON.parse(localStorage.getItem(personalStorageKey(organizationId, role)) || "null");
    return Array.isArray(rows) && rows.length ? rows.slice(0, 6) as LiteShortcut[] : null;
  } catch { return null; }
}

export function readLiteShortcuts(organizationId: string | null, role: string | null, businessType: string | null) {
  if (typeof window === "undefined") return defaultLiteShortcuts(businessType);
  try {
    const rows = JSON.parse(localStorage.getItem(storageKey(organizationId, role)) || "null");
    return Array.isArray(rows) && rows.length ? rows.slice(0, 6) as LiteShortcut[] : defaultLiteShortcuts(businessType);
  } catch {
    return defaultLiteShortcuts(businessType);
  }
}

export function writeLiteShortcuts(organizationId: string | null, role: string | null, rows: LiteShortcut[]) {
  localStorage.setItem(storageKey(organizationId, role), JSON.stringify(rows.slice(0, 6)));
}

export async function loadLiteShortcuts(organizationId: string | null, role: string | null, businessType: string | null) {
  const personal = readPersonalLiteShortcuts(organizationId, role);
  if (personal) return personal;
  const local = readLiteShortcuts(organizationId, role, businessType);
  if (!organizationId || !navigator.onLine) return local;
  const { data, error } = await supabase
    .from("organization_mobile_lite_policies")
    .select("shortcuts")
    .eq("organization_id", organizationId)
    .eq("role", role || "staff")
    .maybeSingle();
  if (error || !Array.isArray(data?.shortcuts) || data.shortcuts.length === 0) return local;
  const remote = (data.shortcuts as unknown as LiteShortcut[]).slice(0, 6);
  writeLiteShortcuts(organizationId, role, remote);
  return remote;
}

export async function saveLiteShortcuts(organizationId: string | null, role: string | null, rows: LiteShortcut[]) {
  writeLiteShortcuts(organizationId, role, rows);
  if (!organizationId || !navigator.onLine) return { savedRemotely: false, error: null as string | null };
  const { error } = await supabase.from("organization_mobile_lite_policies").upsert({
    organization_id: organizationId,
    role: role || "staff",
    shortcuts: rows.slice(0, 6),
    updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,role" });
  return { savedRemotely: !error, error: error?.message || null };
}
