export type AdminTab =
  | "users"
  | "business"
  | "products"
  | "recipes"
  | "approval"
  | "journal_accounts"
  | "pos_cogs_reconciliation"
  | "gender_types"
  | "hotel_pos"
  | "sync_queue"
  | "local_import"
  | "subscription_renewal";

export const ADMIN_TAB_IDS: AdminTab[] = [
  "users",
  "business",
  "products",
  "recipes",
  "approval",
  "journal_accounts",
  "pos_cogs_reconciliation",
  "gender_types",
  "hotel_pos",
  "sync_queue",
  "local_import",
  "subscription_renewal",
];

export function parseAdminTabParam(raw: string | null | undefined): AdminTab | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  return ADMIN_TAB_IDS.includes(raw as AdminTab) ? (raw as AdminTab) : undefined;
}
