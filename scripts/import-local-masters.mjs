import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import XLSX from "xlsx";

const SUPPORTED_ENTITIES = new Set([
  "products",
  "retail-customers",
  "hotel-customers",
  "vendors",
  "chart-of-accounts",
]);

function usage() {
  console.log(`Usage:
  npm run local:import -- --db "<absolute path to boat.sqlite>" --entity <entity> --file "<csv/xlsx file>"

Entities:
  - products
  - retail-customers
  - hotel-customers
  - vendors
  - chart-of-accounts

Example:
  npm run local:import -- --db "C:/Users/YourUser/AppData/Roaming/boat/boat_sqlite/boat.sqlite" --entity products --file "C:/imports/products.csv"
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

function asNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function asBoolInt(value, fallback = 1) {
  if (value === null || value === undefined || value === "") return fallback;
  const str = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(str)) return 1;
  if (["0", "false", "no", "n"].includes(str)) return 0;
  return fallback;
}

function normalizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const key = String(k).trim().toLowerCase().replace(/\s+/g, "_");
    out[key] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

function readRows(filePath) {
  const workbook = XLSX.readFile(filePath, { raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return rows.map(normalizeRow);
}

function upsertLocalRecords(db, tableName, rows) {
  const stmt = db.prepare(`
    INSERT INTO local_records (table_name, id, payload, created_at, updated_at)
    VALUES (@table_name, @id, @payload, @created_at, @updated_at)
    ON CONFLICT(table_name, id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `);
  const now = new Date().toISOString();
  let count = 0;
  for (const row of rows) {
    const id = String(row.id || randomUUID());
    const payload = {
      ...row,
      id,
      created_at: row.created_at || now,
      updated_at: now,
    };
    stmt.run({
      table_name: tableName,
      id,
      payload: JSON.stringify(payload),
      created_at: payload.created_at,
      updated_at: now,
    });
    count += 1;
  }
  return count;
}

function importProducts(db, rows) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO retail_products (id, name, sku, selling_price, qty_on_hand, is_active, created_at, updated_at)
    VALUES (@id, @name, @sku, @selling_price, @qty_on_hand, @is_active, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      sku = excluded.sku,
      selling_price = excluded.selling_price,
      qty_on_hand = excluded.qty_on_hand,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at
  `);
  let count = 0;
  for (const row of rows) {
    if (!row.name) continue;
    stmt.run({
      id: String(row.id || randomUUID()),
      name: String(row.name),
      sku: row.sku ? String(row.sku) : null,
      selling_price: asNumber(row.selling_price, 0),
      qty_on_hand: asNumber(row.qty_on_hand, 0),
      is_active: asBoolInt(row.is_active, 1),
      created_at: now,
      updated_at: now,
    });
    count += 1;
  }
  return count;
}

function importRetailCustomers(db, rows) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO retail_customers (id, name, email, phone, address, notes, created_at, updated_at)
    VALUES (@id, @name, @email, @phone, @address, @notes, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      phone = excluded.phone,
      address = excluded.address,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `);
  let count = 0;
  for (const row of rows) {
    if (!row.name) continue;
    stmt.run({
      id: String(row.id || randomUUID()),
      name: String(row.name),
      email: row.email ? String(row.email) : null,
      phone: row.phone ? String(row.phone) : null,
      address: row.address ? String(row.address) : null,
      notes: row.notes ? String(row.notes) : null,
      created_at: now,
      updated_at: now,
    });
    count += 1;
  }
  return count;
}

function importHotelCustomers(db, rows) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO hotel_customers (id, first_name, last_name, email, phone, id_type, id_number, address, created_at)
    VALUES (@id, @first_name, @last_name, @email, @phone, @id_type, @id_number, @address, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      email = excluded.email,
      phone = excluded.phone,
      id_type = excluded.id_type,
      id_number = excluded.id_number,
      address = excluded.address
  `);
  let count = 0;
  for (const row of rows) {
    const firstName = row.first_name || "";
    const lastName = row.last_name || "";
    if (!firstName || !lastName) continue;
    stmt.run({
      id: String(row.id || randomUUID()),
      first_name: String(firstName),
      last_name: String(lastName),
      email: row.email ? String(row.email) : null,
      phone: row.phone ? String(row.phone) : null,
      id_type: row.id_type ? String(row.id_type) : null,
      id_number: row.id_number ? String(row.id_number) : null,
      address: row.address ? String(row.address) : null,
      created_at: now,
    });
    count += 1;
  }
  return count;
}

function importVendors(db, rows) {
  const normalized = rows
    .filter((r) => r.name)
    .map((r) => ({
      id: String(r.id || randomUUID()),
      name: String(r.name),
      contact_name: r.contact_name ? String(r.contact_name) : "",
      email: r.email ? String(r.email) : "",
      phone: r.phone ? String(r.phone) : "",
      address: r.address ? String(r.address) : "",
      tax_number: r.tax_number ? String(r.tax_number) : "",
      notes: r.notes ? String(r.notes) : "",
      is_active: asBoolInt(r.is_active, 1),
    }));
  return upsertLocalRecords(db, "vendors", normalized);
}

function importChartOfAccounts(db, rows) {
  const normalized = rows
    .filter((r) => r.name)
    .map((r) => ({
      id: String(r.id || randomUUID()),
      code: r.code ? String(r.code) : "",
      name: String(r.name),
      type: r.type ? String(r.type) : "",
      parent_code: r.parent_code ? String(r.parent_code) : "",
      is_active: asBoolInt(r.is_active, 1),
    }));
  return upsertLocalRecords(db, "gl_accounts", normalized);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.db || !args.entity || !args.file) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const dbPath = path.resolve(String(args.db));
  const importFile = path.resolve(String(args.file));
  const entity = String(args.entity).trim().toLowerCase();

  if (!SUPPORTED_ENTITIES.has(entity)) {
    console.error(`Unsupported entity: ${entity}`);
    usage();
    process.exit(1);
  }
  if (!fs.existsSync(dbPath)) {
    console.error(`SQLite file not found: ${dbPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(importFile)) {
    console.error(`Import file not found: ${importFile}`);
    process.exit(1);
  }

  const rows = readRows(importFile);
  if (rows.length === 0) {
    console.error("No rows found in the import file.");
    process.exit(1);
  }

  const db = new Database(dbPath);
  let imported = 0;
  try {
    const tx = db.transaction(() => {
      if (entity === "products") imported = importProducts(db, rows);
      else if (entity === "retail-customers") imported = importRetailCustomers(db, rows);
      else if (entity === "hotel-customers") imported = importHotelCustomers(db, rows);
      else if (entity === "vendors") imported = importVendors(db, rows);
      else if (entity === "chart-of-accounts") imported = importChartOfAccounts(db, rows);
    });
    tx();
  } finally {
    db.close();
  }

  console.log(`Imported ${imported} row(s) for '${entity}'.`);
  if (imported < rows.length) {
    console.log(`Skipped ${rows.length - imported} row(s) with missing required fields.`);
  }
}

main();
