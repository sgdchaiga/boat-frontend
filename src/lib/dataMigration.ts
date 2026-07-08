import { parseBulkImportFile, normalizeBulkHeader } from "@/lib/saccoBulkImport";
import { supabase } from "@/lib/supabase";

export type MigrationImportType = "customers" | "suppliers" | "products" | "opening_balances";
export type MigrationSourceType = "csv" | "excel" | "google_sheet" | "manual";
export type MigrationRowStatus = "ok" | "error" | "skip";

export type ParsedMigrationFile = {
  headers: string[];
  rows: Record<string, string>[];
};

export type MigrationPreviewRow = {
  line: number;
  status: MigrationRowStatus;
  summary: string;
  detail?: string;
  payload?: Record<string, unknown>;
};

export type GlAccountMini = {
  id: string;
  account_code: string;
  account_name: string;
  account_type?: string | null;
};

const CSV_TEMPLATES: Record<MigrationImportType, string> = {
  customers: `name,phone,email,address,notes
Jane Customer,+256700000001,jane@example.com,Kampala,Opening import`,
  suppliers: `name,contact_name,phone,email,address
ABC Supplies,Amina Buyer,+256700000002,sales@example.com,Kampala`,
  products: `name,category,unit_of_measure,cost_price,sales_price,purchasable,saleable,track_inventory
General Item,General,unit,1000,1500,yes,yes,yes`,
  opening_balances: `account_code,account_name,debit,credit,memo
1000,Cash,500000,,
3000,Opening Equity,,500000,Opening capital`,
};

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function first(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const normalized = normalizeBulkHeader(key);
    const value = text(row[normalized]);
    if (value) return value;
  }
  return "";
}

function numberValue(value: unknown): number {
  const raw = text(value).replace(/,/g, "");
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  const raw = text(value).toLowerCase();
  if (!raw) return fallback;
  if (["yes", "y", "true", "1", "on"].includes(raw)) return true;
  if (["no", "n", "false", "0", "off"].includes(raw)) return false;
  return fallback;
}

function downloadText(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadMigrationTemplate(type: MigrationImportType) {
  downloadText(`${type}_import_template.csv`, CSV_TEMPLATES[type]);
}

export async function parseMigrationFile(file: File): Promise<ParsedMigrationFile> {
  return parseBulkImportFile(file);
}

export function googleSheetCsvUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  if (/output=csv|format=csv/.test(raw)) return raw;
  const idMatch = raw.match(/\/spreadsheets\/d\/([^/]+)/);
  const gidMatch = raw.match(/[?&]gid=([^&#]+)/);
  if (idMatch?.[1]) {
    const gid = gidMatch?.[1] ?? "0";
    return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv&gid=${gid}`;
  }
  return raw;
}

export async function fetchGoogleSheetRows(sheetUrl: string): Promise<ParsedMigrationFile> {
  const csvUrl = googleSheetCsvUrl(sheetUrl);
  const response = await fetch(csvUrl);
  if (!response.ok) throw new Error(`Google Sheet fetch failed (${response.status}). Publish the sheet as CSV or allow link access.`);
  const csv = await response.text();
  const file = new File([csv], "google-sheet.csv", { type: "text/csv" });
  return parseBulkImportFile(file);
}

export function previewMasterDataImport(type: Exclude<MigrationImportType, "opening_balances">, rows: Record<string, string>[]): MigrationPreviewRow[] {
  return rows.map((row, index) => {
    const line = index + 2;
    if (type === "customers") {
      const name = first(row, ["name", "customer", "customer_name", "full_name"]);
      if (!name) return { line, status: "error", summary: "Missing customer name" };
      return {
        line,
        status: "ok",
        summary: name,
        detail: [first(row, ["phone", "mobile"]), first(row, ["email"])].filter(Boolean).join(" | "),
        payload: {
          name,
          phone: first(row, ["phone", "mobile"]),
          email: first(row, ["email"]),
          address: first(row, ["address", "location"]),
          notes: first(row, ["notes", "note"]),
        },
      };
    }
    if (type === "suppliers") {
      const name = first(row, ["name", "supplier", "supplier_name", "vendor", "vendor_name"]);
      if (!name) return { line, status: "error", summary: "Missing supplier name" };
      return {
        line,
        status: "ok",
        summary: name,
        detail: [first(row, ["contact_name", "contact"]), first(row, ["phone"])].filter(Boolean).join(" | "),
        payload: {
          name,
          contact_name: first(row, ["contact_name", "contact", "contact_person"]),
          phone: first(row, ["phone", "mobile"]),
          email: first(row, ["email"]),
          address: first(row, ["address", "location"]),
        },
      };
    }
    const name = first(row, ["name", "product", "product_name", "item", "item_name", "service"]);
    if (!name) return { line, status: "error", summary: "Missing product/service name" };
    const trackInventory = boolValue(first(row, ["track_inventory", "stock_item", "inventory"]), true);
    return {
      line,
      status: "ok",
      summary: name,
      detail: `${first(row, ["unit_of_measure", "unit", "uom"]) || "unit"} | cost ${numberValue(first(row, ["cost_price", "cost"]))} | sale ${numberValue(first(row, ["sales_price", "price", "selling_price"]))}`,
      payload: {
        name,
        category: first(row, ["category"]),
        unit_of_measure: first(row, ["unit_of_measure", "unit", "uom"]) || "unit",
        cost_price: numberValue(first(row, ["cost_price", "cost"])),
        sales_price: numberValue(first(row, ["sales_price", "price", "selling_price"])),
        purchasable: boolValue(first(row, ["purchasable", "can_buy"]), true),
        saleable: boolValue(first(row, ["saleable", "can_sell"]), true),
        track_inventory: trackInventory,
        active: true,
      },
    };
  });
}

export function previewOpeningBalances(rows: Record<string, string>[], accounts: GlAccountMini[]): MigrationPreviewRow[] {
  const byCode = new Map(accounts.map((account) => [account.account_code.trim().toLowerCase(), account]));
  const byName = new Map(accounts.map((account) => [account.account_name.trim().toLowerCase(), account]));
  return rows.map((row, index) => {
    const line = index + 2;
    const code = first(row, ["account_code", "code", "gl_code"]);
    const name = first(row, ["account_name", "name", "account"]);
    const account = (code ? byCode.get(code.toLowerCase()) : undefined) ?? (name ? byName.get(name.toLowerCase()) : undefined);
    const debit = numberValue(first(row, ["debit", "dr"]));
    const credit = numberValue(first(row, ["credit", "cr"]));
    if (!account) return { line, status: "error", summary: code || name || "Missing account", detail: "Account not found in chart of accounts." };
    if (debit > 0 && credit > 0) return { line, status: "error", summary: account.account_code, detail: "Use either debit or credit, not both." };
    if (debit <= 0 && credit <= 0) return { line, status: "skip", summary: account.account_code, detail: "No amount entered." };
    return {
      line,
      status: "ok",
      summary: `${account.account_code} - ${account.account_name}`,
      detail: debit > 0 ? `Debit ${debit}` : `Credit ${credit}`,
      payload: {
        gl_account_id: account.id,
        debit,
        credit,
        memo: first(row, ["memo", "description", "note"]),
      },
    };
  });
}

export async function loadGlAccounts(organizationId: string): Promise<GlAccountMini[]> {
  const { data, error } = await supabase
    .from("gl_accounts")
    .select("id,account_code,account_name,account_type")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("account_code");
  if (error) throw new Error(error.message);
  return (data ?? []) as GlAccountMini[];
}

export async function applyMasterDataImport(args: {
  organizationId: string;
  type: Exclude<MigrationImportType, "opening_balances">;
  preview: MigrationPreviewRow[];
  sourceType: MigrationSourceType;
  sourceName?: string;
}) {
  const okRows = args.preview.filter((row) => row.status === "ok" && row.payload);
  if (okRows.length === 0) throw new Error("No valid rows to import.");

  const table = args.type === "customers" ? "retail_customers" : args.type === "suppliers" ? "vendors" : "products";
  const existingRes = await supabase.from(table).select("id,name").eq("organization_id", args.organizationId);
  if (existingRes.error) throw new Error(existingRes.error.message);
  const existing = new Map(((existingRes.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.name.trim().toLowerCase(), row.id]));

  let inserted = 0;
  let updated = 0;
  for (const row of okRows) {
    const payload = { ...(row.payload ?? {}), organization_id: args.organizationId } as Record<string, unknown>;
    const name = text(payload.name).toLowerCase();
    const id = existing.get(name);
    const result = id
      ? await supabase.from(table).update(payload).eq("id", id).eq("organization_id", args.organizationId)
      : await supabase.from(table).insert(payload);
    if (result.error) throw new Error(`Line ${row.line}: ${result.error.message}`);
    if (id) updated += 1;
    else inserted += 1;
  }

  const { error: batchError } = await supabase.from("data_migration_batches").insert({
    organization_id: args.organizationId,
    import_type: args.type,
    source_type: args.sourceType,
    source_name: args.sourceName ?? null,
    status: "posted",
    row_count: okRows.length,
    error_count: args.preview.filter((row) => row.status === "error").length,
    warning_count: args.preview.filter((row) => row.status === "skip").length,
    summary: { inserted, updated },
    posted_at: new Date().toISOString(),
  });
  if (batchError) throw new Error(batchError.message);
  return { inserted, updated };
}

export function openingBalanceTotals(preview: MigrationPreviewRow[]) {
  return preview.reduce(
    (totals, row) => {
      if (row.status !== "ok" || !row.payload) return totals;
      totals.debit += Number(row.payload.debit ?? 0);
      totals.credit += Number(row.payload.credit ?? 0);
      return totals;
    },
    { debit: 0, credit: 0 }
  );
}
