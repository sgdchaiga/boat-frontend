import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { desktopApi } from "@/lib/desktopApi";
import { useAuth } from "@/contexts/AuthContext";

type ImportEntity =
  | "products"
  | "retail-customers"
  | "hotel-customers"
  | "vendors"
  | "chart-of-accounts";

type ParsedRow = Record<string, unknown>;

const ENTITY_OPTIONS: Array<{ id: ImportEntity; label: string; required: string[] }> = [
  { id: "products", label: "Products", required: ["name"] },
  { id: "retail-customers", label: "Retail Customers", required: ["name"] },
  { id: "hotel-customers", label: "Hotel Customers", required: ["first_name", "last_name"] },
  { id: "vendors", label: "Vendors", required: ["name"] },
  { id: "chart-of-accounts", label: "Chart of Accounts", required: ["name"] },
];

const ENTITY_TEMPLATES: Record<ImportEntity, Record<string, string>[]> = {
  products: [
    { id: "", name: "Coca Cola 300ml", sku: "COKE300", selling_price: "120", qty_on_hand: "250", is_active: "1" },
  ],
  "retail-customers": [
    {
      id: "",
      name: "John Doe",
      email: "john@example.com",
      phone: "+254700000001",
      address: "Nairobi",
      notes: "Walk-in regular customer",
    },
  ],
  "hotel-customers": [
    {
      id: "",
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      phone: "+254711000001",
      id_type: "Passport",
      id_number: "A1234567",
      address: "Nairobi",
    },
  ],
  vendors: [
    {
      id: "",
      name: "Fresh Farm Distributors",
      contact_name: "Peter Maina",
      email: "orders@freshfarm.test",
      phone: "+254722000001",
      address: "Nairobi",
      tax_number: "TAX-001",
      notes: "Weekly produce supplier",
      is_active: "1",
    },
  ],
  "chart-of-accounts": [
    { id: "", code: "1000", name: "Cash on Hand", type: "Asset", parent_code: "", is_active: "1" },
  ],
};

function normalizeRow(row: Record<string, unknown>): ParsedRow {
  const out: ParsedRow = {};
  for (const [key, value] of Object.entries(row)) {
    const normalized = key.trim().toLowerCase().replace(/\s+/g, "_");
    out[normalized] = typeof value === "string" ? value.trim() : value;
  }
  return out;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function asBool(value: unknown, fallback = true): boolean {
  const raw = asText(value).toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "y"].includes(raw)) return true;
  if (["0", "false", "no", "n"].includes(raw)) return false;
  return fallback;
}

function generateId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function AdminLocalImportPage() {
  const { user } = useAuth();
  const [entity, setEntity] = useState<ImportEntity>("products");
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selected = useMemo(
    () => ENTITY_OPTIONS.find((opt) => opt.id === entity) ?? ENTITY_OPTIONS[0],
    [entity]
  );

  const parseSelectedFile = async (): Promise<ParsedRow[]> => {
    if (!file) return [];
    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const first = wb.SheetNames[0];
    if (!first) return [];
    const ws = wb.Sheets[first];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    return rows.map(normalizeRow);
  };

  const importProducts = async (rows: ParsedRow[]) => {
    const localOrgId =
      user?.organization_id ||
      (import.meta.env.VITE_LOCAL_ORGANIZATION_ID || "").trim() ||
      "00000000-0000-0000-0000-000000000001";
    let imported = 0;
    const productRows: Record<string, unknown>[] = [];
    for (const row of rows) {
      const name = asText(row.name);
      if (!name) continue;
      const id = asText(row.id) || generateId("prd");
      const salesPrice = asNumber(row.sales_price, asNumber(row.selling_price, 0));
      const costPrice = asNumber(row.cost_price, 0);
      const active = asBool(row.is_active, true);
      const trackInventory = asBool(row.track_inventory, true);
      await desktopApi.upsertPosProduct({
        id,
        name,
        sku: asText(row.sku) || null,
        selling_price: asNumber(row.selling_price, salesPrice),
        qty_on_hand: asNumber(row.qty_on_hand, 0),
        is_active: active,
      });
      productRows.push({
        id,
        name,
        sales_price: salesPrice,
        cost_price: costPrice,
        barcode: asText(row.barcode) || null,
        active,
        track_inventory: trackInventory,
        organization_id: asText(row.organization_id) || localOrgId,
      });
      imported += 1;
    }
    if (productRows.length > 0) {
      await desktopApi.localUpsert({ table: "products", rows: productRows });
    }
    return imported;
  };

  const importRetailCustomers = async (rows: ParsedRow[]) => {
    let imported = 0;
    for (const row of rows) {
      const name = asText(row.name);
      if (!name) continue;
      await desktopApi.createRetailCustomer({
        id: asText(row.id) || undefined,
        name,
        email: asText(row.email) || null,
        phone: asText(row.phone) || null,
        address: asText(row.address) || null,
        notes: asText(row.notes) || null,
      });
      imported += 1;
    }
    return imported;
  };

  const importHotelCustomers = async (rows: ParsedRow[]) => {
    let imported = 0;
    for (const row of rows) {
      const firstName = asText(row.first_name);
      const lastName = asText(row.last_name);
      if (!firstName || !lastName) continue;
      await desktopApi.createCustomer({
        id: asText(row.id) || undefined,
        first_name: firstName,
        last_name: lastName,
        email: asText(row.email) || null,
        phone: asText(row.phone) || null,
        id_type: asText(row.id_type) || null,
        id_number: asText(row.id_number) || null,
        address: asText(row.address) || null,
      });
      imported += 1;
    }
    return imported;
  };

  const importVendors = async (rows: ParsedRow[]) => {
    const mapped = rows
      .filter((row) => asText(row.name))
      .map((row) => ({
        id: asText(row.id) || generateId("vnd"),
        name: asText(row.name),
        contact_name: asText(row.contact_name),
        email: asText(row.email),
        phone: asText(row.phone),
        address: asText(row.address),
        tax_number: asText(row.tax_number),
        notes: asText(row.notes),
        is_active: asBool(row.is_active, true),
      }));
    if (mapped.length === 0) return 0;
    await desktopApi.localUpsert({ table: "vendors", rows: mapped });
    return mapped.length;
  };

  const importChartOfAccounts = async (rows: ParsedRow[]) => {
    const localOrgId = (import.meta.env.VITE_LOCAL_ORGANIZATION_ID || "").trim() || "00000000-0000-0000-0000-000000000001";
    const mapped = rows
      .filter((row) => asText(row.name) || asText(row.account_name))
      .map((row) => ({
        id: asText(row.id) || generateId("gl"),
        organization_id: asText(row.organization_id) || localOrgId,
        account_code: asText(row.account_code) || asText(row.code),
        account_name: asText(row.account_name) || asText(row.name),
        account_type: (asText(row.account_type) || asText(row.type) || "income").toLowerCase(),
        category: asText(row.category) || null,
        parent_id: asText(row.parent_id) || null,
        parent_code: asText(row.parent_code),
        is_active: asBool(row.is_active, true),
      }));
    if (mapped.length === 0) return 0;
    await desktopApi.localUpsert({ table: "gl_accounts", rows: mapped });
    return mapped.length;
  };

  const runImport = async () => {
    setMessage(null);
    if (!desktopApi.isAvailable()) {
      setMessage("Local import works in desktop mode only.");
      return;
    }
    if (!file) {
      setMessage("Choose a CSV or XLSX file first.");
      return;
    }
    setRunning(true);
    try {
      const rows = await parseSelectedFile();
      if (rows.length === 0) {
        setMessage("No rows found in the selected file.");
        return;
      }
      let imported = 0;
      if (entity === "products") imported = await importProducts(rows);
      else if (entity === "retail-customers") imported = await importRetailCustomers(rows);
      else if (entity === "hotel-customers") imported = await importHotelCustomers(rows);
      else if (entity === "vendors") imported = await importVendors(rows);
      else if (entity === "chart-of-accounts") imported = await importChartOfAccounts(rows);

      const skipped = rows.length - imported;
      setMessage(`Imported ${imported} row(s).${skipped > 0 ? ` Skipped ${skipped} row(s).` : ""}`);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Import failed.";
      setMessage(text);
    } finally {
      setRunning(false);
    }
  };

  const downloadTemplate = () => {
    const rows = ENTITY_TEMPLATES[entity];
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows, { skipHeader: false }));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entity}-template.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadXlsxTemplate = () => {
    const rows = ENTITY_TEMPLATES[entity];
    const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: false });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, `${entity}-template.xlsx`);
  };

  return (
    <div className="app-card p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Local Bulk Import</h2>
        <p className="text-sm text-slate-600 mt-1">
          Import CSV/XLSX into local SQLite for products, customers, vendors, and chart of accounts.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Entity</label>
          <select
            value={entity}
            onChange={(e) => setEntity(e.target.value as ImportEntity)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            {ENTITY_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">File (CSV/XLSX)</label>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
          />
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Required columns for {selected.label}: {selected.required.join(", ")}.
      </p>

      <div className="flex items-center gap-3">
        <button type="button" className="app-btn-secondary" onClick={downloadTemplate}>
          Download CSV Template
        </button>
        <button type="button" className="app-btn-secondary" onClick={downloadXlsxTemplate}>
          Download XLSX Template
        </button>
        <button type="button" className="app-btn-primary" disabled={running} onClick={() => void runImport()}>
          {running ? "Importing..." : "Import File"}
        </button>
        {file ? <span className="text-xs text-slate-600">{file.name}</span> : null}
      </div>

      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
    </div>
  );
}
