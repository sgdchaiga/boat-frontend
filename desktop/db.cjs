const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS retail_products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT,
      selling_price REAL NOT NULL DEFAULT 0,
      qty_on_hand REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_retail_products_name
      ON retail_products(name);

    CREATE TABLE IF NOT EXISTS hotel_customers (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      id_type TEXT,
      id_number TEXT,
      address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_hotel_customers_name
      ON hotel_customers(last_name, first_name);

    CREATE TABLE IF NOT EXISTS retail_customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_retail_customers_name
      ON retail_customers(name);

    CREATE TABLE IF NOT EXISTS retail_cashier_sessions (
      id TEXT PRIMARY KEY,
      opened_by TEXT,
      opening_float REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      opened_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT,
      closed_by TEXT,
      closing_cash_counted REAL,
      expected_cash REAL,
      variance_amount REAL
    );

    CREATE INDEX IF NOT EXISTS idx_retail_cashier_sessions_open
      ON retail_cashier_sessions(opened_by, status, opened_at DESC);

    CREATE TABLE IF NOT EXISTS retail_sales (
      id TEXT PRIMARY KEY,
      sale_at TEXT NOT NULL DEFAULT (datetime('now')),
      cashier_session_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      total_amount REAL NOT NULL DEFAULT 0,
      amount_paid REAL NOT NULL DEFAULT 0,
      amount_due REAL NOT NULL DEFAULT 0,
      change_amount REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'pending',
      sale_type TEXT NOT NULL DEFAULT 'cash',
      credit_due_date TEXT,
      vat_enabled INTEGER NOT NULL DEFAULT 0,
      vat_rate REAL,
      created_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_retail_sales_session
      ON retail_sales(cashier_session_id, sale_at DESC);

    CREATE TABLE IF NOT EXISTS retail_sale_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      product_id TEXT,
      description TEXT,
      quantity REAL NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL DEFAULT 0,
      unit_cost REAL,
      department_id TEXT,
      track_inventory INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_retail_sale_lines_sale
      ON retail_sale_lines(sale_id, line_no);

    CREATE TABLE IF NOT EXISTS retail_sale_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'completed'
    );

    CREATE INDEX IF NOT EXISTS idx_retail_sale_payments_sale
      ON retail_sale_payments(sale_id);

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sync_queue_status_created
      ON sync_queue(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS local_records (
      table_name TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (table_name, id)
    );

    CREATE INDEX IF NOT EXISTS idx_local_records_table_updated
      ON local_records(table_name, updated_at DESC);
  `);
}

const DEFAULT_SEED_ORG_ID = "00000000-0000-0000-0000-000000000001";

function seedDefaultLocalOrgData(db) {
  const existing = listLocalRows(db, "organization_role_types").filter((r) => r.organization_id === DEFAULT_SEED_ORG_ID);
  if (existing.length > 0) return;
  const now = new Date().toISOString();
  const rows = [
    {
      id: "b0000001-0000-4000-8000-000000000001",
      organization_id: DEFAULT_SEED_ORG_ID,
      role_key: "admin",
      display_name: "Administrator",
      sort_order: 0,
      created_at: now,
    },
    {
      id: "b0000001-0000-4000-8000-000000000002",
      organization_id: DEFAULT_SEED_ORG_ID,
      role_key: "manager",
      display_name: "Manager",
      sort_order: 1,
      created_at: now,
    },
    {
      id: "b0000001-0000-4000-8000-000000000003",
      organization_id: DEFAULT_SEED_ORG_ID,
      role_key: "receptionist",
      display_name: "Receptionist",
      sort_order: 2,
      created_at: now,
    },
    {
      id: "b0000001-0000-4000-8000-000000000004",
      organization_id: DEFAULT_SEED_ORG_ID,
      role_key: "accountant",
      display_name: "Accountant",
      sort_order: 3,
      created_at: now,
    },
  ];
  localStoreUpsert(db, { table: "organization_role_types", rows });
}

function openDatabase(userDataPath) {
  const dataDir = path.join(userDataPath, "boat_sqlite");
  ensureDir(dataDir);
  const dbPath = path.join(dataDir, "boat.sqlite");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seedDefaultLocalOrgData(db);
  return { db, dbPath };
}

function listPosProducts(db) {
  const stmt = db.prepare(`
    SELECT id, name, sku, selling_price, qty_on_hand, is_active, created_at, updated_at
    FROM retail_products
    WHERE is_active = 1
    ORDER BY name COLLATE NOCASE ASC
  `);
  return stmt.all();
}

function upsertPosProduct(db, payload) {
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

  stmt.run({
    id: payload.id,
    name: payload.name,
    sku: payload.sku ?? null,
    selling_price: Number(payload.selling_price ?? 0),
    qty_on_hand: Number(payload.qty_on_hand ?? 0),
    is_active: payload.is_active ? 1 : 0,
    created_at: now,
    updated_at: now,
  });
}

function listHotelCustomers(db) {
  const stmt = db.prepare(`
    SELECT id, first_name, last_name, email, phone, id_type, id_number, address, created_at
    FROM hotel_customers
    ORDER BY datetime(created_at) DESC
  `);
  return stmt.all();
}

function createHotelCustomer(db, payload) {
  const now = new Date().toISOString();
  const id = payload.id || cryptoRandomId();
  const stmt = db.prepare(`
    INSERT INTO hotel_customers (
      id, first_name, last_name, email, phone, id_type, id_number, address, created_at
    )
    VALUES (
      @id, @first_name, @last_name, @email, @phone, @id_type, @id_number, @address, @created_at
    )
  `);
  stmt.run({
    id,
    first_name: payload.first_name,
    last_name: payload.last_name,
    email: payload.email ?? null,
    phone: payload.phone ?? null,
    id_type: payload.id_type ?? null,
    id_number: payload.id_number ?? null,
    address: payload.address ?? null,
    created_at: now,
  });

  const rowStmt = db.prepare(`
    SELECT id, first_name, last_name, email, phone, id_type, id_number, address, created_at
    FROM hotel_customers
    WHERE id = ?
    LIMIT 1
  `);
  return rowStmt.get(id);
}

function updateHotelCustomer(db, payload) {
  db.prepare(`
    UPDATE hotel_customers
    SET
      first_name = @first_name,
      last_name = @last_name,
      email = @email,
      phone = @phone,
      id_type = @id_type,
      id_number = @id_number,
      address = @address
    WHERE id = @id
  `).run({
    id: payload.id,
    first_name: payload.first_name,
    last_name: payload.last_name,
    email: payload.email ?? null,
    phone: payload.phone ?? null,
    id_type: payload.id_type ?? null,
    id_number: payload.id_number ?? null,
    address: payload.address ?? null,
  });
  const row = db.prepare(`
    SELECT id, first_name, last_name, email, phone, id_type, id_number, address, created_at
    FROM hotel_customers
    WHERE id = ?
    LIMIT 1
  `).get(payload.id);
  return row || null;
}

function enqueueSyncQueue(db, payload) {
  const id = cryptoRandomId();
  db.prepare(`
    INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, status, created_at, last_error)
    VALUES (@id, @entity_type, @entity_id, @operation, @payload, 'pending', @created_at, NULL)
  `).run({
    id,
    entity_type: payload.entity_type,
    entity_id: payload.entity_id,
    operation: payload.operation,
    payload: JSON.stringify(payload.payload || {}),
    created_at: new Date().toISOString(),
  });
}

function listSyncQueue(db) {
  return db
    .prepare(`
      SELECT id, entity_type, entity_id, operation, payload, status, created_at, last_error
      FROM sync_queue
      ORDER BY datetime(created_at) DESC
      LIMIT 300
    `)
    .all()
    .map((row) => {
      let parsed = {};
      try {
        parsed = JSON.parse(row.payload || "{}");
      } catch {
        parsed = {};
      }
      return { ...row, payload: parsed };
    });
}

function listPendingSyncQueue(db) {
  return db
    .prepare(`
      SELECT id, entity_type, entity_id, operation, payload, status, created_at, last_error
      FROM sync_queue
      WHERE status <> 'synced'
      ORDER BY datetime(created_at) ASC
      LIMIT 300
    `)
    .all()
    .map((row) => {
      let parsed = {};
      try {
        parsed = JSON.parse(row.payload || "{}");
      } catch {
        parsed = {};
      }
      return { ...row, payload: parsed };
    });
}

function updateSyncQueueStatus(db, payload) {
  db.prepare(`
    UPDATE sync_queue
    SET status = @status, last_error = @last_error
    WHERE id = @id
  `).run({
    id: payload.id,
    status: payload.status,
    last_error: payload.last_error ?? null,
  });
}

function listRetailCustomers(db) {
  return db.prepare(`
    SELECT id, name, email, phone, address, notes, created_at, updated_at
    FROM retail_customers
    ORDER BY name COLLATE NOCASE ASC
  `).all();
}

function createRetailCustomer(db, payload) {
  const now = new Date().toISOString();
  const id = payload.id || cryptoRandomId();
  db.prepare(`
    INSERT INTO retail_customers (id, name, email, phone, address, notes, created_at, updated_at)
    VALUES (@id, @name, @email, @phone, @address, @notes, @created_at, @updated_at)
  `).run({
    id,
    name: payload.name,
    email: payload.email ?? null,
    phone: payload.phone ?? null,
    address: payload.address ?? null,
    notes: payload.notes ?? null,
    created_at: now,
    updated_at: now,
  });
  const row = db.prepare(`
    SELECT id, name, email, phone, address, notes, created_at, updated_at
    FROM retail_customers
    WHERE id = ?
    LIMIT 1
  `).get(id);
  enqueueSyncQueue(db, { entity_type: "retail_customers", entity_id: id, operation: "INSERT", payload: row });
  return row;
}

function updateRetailCustomer(db, payload) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE retail_customers
    SET name=@name, email=@email, phone=@phone, address=@address, notes=@notes, updated_at=@updated_at
    WHERE id=@id
  `).run({
    id: payload.id,
    name: payload.name,
    email: payload.email ?? null,
    phone: payload.phone ?? null,
    address: payload.address ?? null,
    notes: payload.notes ?? null,
    updated_at: now,
  });
  const row = db.prepare(`
    SELECT id, name, email, phone, address, notes, created_at, updated_at
    FROM retail_customers
    WHERE id = ?
    LIMIT 1
  `).get(payload.id);
  if (row) {
    enqueueSyncQueue(db, { entity_type: "retail_customers", entity_id: payload.id, operation: "UPDATE", payload: row });
  }
  return row || null;
}

function deleteRetailCustomer(db, payload) {
  const existing = db.prepare(`SELECT id, name FROM retail_customers WHERE id = ? LIMIT 1`).get(payload.id);
  db.prepare(`DELETE FROM retail_customers WHERE id = ?`).run(payload.id);
  if (existing) {
    enqueueSyncQueue(db, {
      entity_type: "retail_customers",
      entity_id: payload.id,
      operation: "DELETE",
      payload: { id: payload.id, name: existing.name },
    });
  }
}

function cryptoRandomId() {
  return `lc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getActiveCashierSession(db, openedBy) {
  const stmt = db.prepare(`
    SELECT id, opened_at, opening_float, status
    FROM retail_cashier_sessions
    WHERE opened_by = ? AND status = 'open'
    ORDER BY datetime(opened_at) DESC
    LIMIT 1
  `);
  return stmt.get(openedBy) || null;
}

function openCashierSession(db, payload) {
  const id = payload.id || cryptoRandomId();
  const openedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO retail_cashier_sessions (id, opened_by, opening_float, status, opened_at)
    VALUES (@id, @opened_by, @opening_float, 'open', @opened_at)
  `).run({
    id,
    opened_by: payload.opened_by || null,
    opening_float: Number(payload.opening_float || 0),
    opened_at: openedAt,
  });
  return getActiveCashierSession(db, payload.opened_by || "");
}

function closeCashierSession(db, payload) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE retail_cashier_sessions
    SET
      status = 'closed',
      closed_at = @closed_at,
      closed_by = @closed_by,
      closing_cash_counted = @closing_cash_counted,
      expected_cash = @expected_cash,
      variance_amount = @variance_amount
    WHERE id = @id
  `).run({
    id: payload.id,
    closed_at: now,
    closed_by: payload.closed_by || null,
    closing_cash_counted: Number(payload.closing_cash_counted || 0),
    expected_cash: Number(payload.expected_cash || 0),
    variance_amount: Number(payload.variance_amount || 0),
  });
}

function createRetailSale(db, payload) {
  const id = payload.sale_id || cryptoRandomId();
  const saleAt = new Date().toISOString();
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  const payments = Array.isArray(payload.payments) ? payload.payments : [];
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO retail_sales (
        id, sale_at, cashier_session_id, customer_name, customer_phone, total_amount, amount_paid, amount_due,
        change_amount, payment_status, sale_type, credit_due_date, vat_enabled, vat_rate, created_by
      )
      VALUES (
        @id, @sale_at, @cashier_session_id, @customer_name, @customer_phone, @total_amount, @amount_paid, @amount_due,
        @change_amount, @payment_status, @sale_type, @credit_due_date, @vat_enabled, @vat_rate, @created_by
      )
    `).run({
      id,
      sale_at: saleAt,
      cashier_session_id: payload.cashier_session_id || null,
      customer_name: payload.customer_name || null,
      customer_phone: payload.customer_phone || null,
      total_amount: Number(payload.total_amount || 0),
      amount_paid: Number(payload.amount_paid || 0),
      amount_due: Number(payload.amount_due || 0),
      change_amount: Number(payload.change_amount || 0),
      payment_status: payload.payment_status || "completed",
      sale_type: payload.sale_type || "cash",
      credit_due_date: payload.credit_due_date || null,
      vat_enabled: payload.vat_enabled ? 1 : 0,
      vat_rate: payload.vat_rate == null ? null : Number(payload.vat_rate),
      created_by: payload.created_by || null,
    });

    const lineStmt = db.prepare(`
      INSERT INTO retail_sale_lines (
        sale_id, line_no, product_id, description, quantity, unit_price, line_total, unit_cost, department_id, track_inventory
      )
      VALUES (
        @sale_id, @line_no, @product_id, @description, @quantity, @unit_price, @line_total, @unit_cost, @department_id, @track_inventory
      )
    `);
    lines.forEach((line, idx) => {
      lineStmt.run({
        sale_id: id,
        line_no: idx + 1,
        product_id: line.product_id || line.productId || null,
        description: line.description || line.name || null,
        quantity: Number(line.quantity || 0),
        unit_price: Number(line.unit_price ?? line.unitPrice ?? 0),
        line_total: Number(line.line_total ?? line.lineTotal ?? 0),
        unit_cost: line.unit_cost == null && line.costPrice == null ? null : Number(line.unit_cost ?? line.costPrice ?? 0),
        department_id: line.department_id ?? line.departmentId ?? null,
        track_inventory: line.track_inventory === false || line.trackInventory === false ? 0 : 1,
      });
    });

    const payStmt = db.prepare(`
      INSERT INTO retail_sale_payments (sale_id, payment_method, amount, payment_status)
      VALUES (@sale_id, @payment_method, @amount, @payment_status)
    `);
    payments.forEach((p) => {
      payStmt.run({
        sale_id: id,
        payment_method: p.method || p.payment_method || "cash",
        amount: Number(p.amount || 0),
        payment_status: p.status || p.payment_status || "completed",
      });
    });
  });
  tx();
  enqueueSyncQueue(db, {
    entity_type: "retail_sales",
    entity_id: id,
    operation: "INSERT",
    payload: {
      id,
      sale_at: saleAt,
      total_amount: Number(payload.total_amount || 0),
      amount_paid: Number(payload.amount_paid || 0),
      amount_due: Number(payload.amount_due || 0),
      payment_status: payload.payment_status || "completed",
      sale_type: payload.sale_type || "cash",
      lines,
      payments,
    },
  });
  return { id, sale_at: saleAt };
}

function parseLocalPayload(payload) {
  try {
    return JSON.parse(payload || "{}");
  } catch {
    return {};
  }
}

function matchFilterValue(actual, operator, expected) {
  if (operator === "eq") return actual === expected;
  if (operator === "neq") return actual !== expected;
  if (operator === "gt") return actual > expected;
  if (operator === "gte") return actual >= expected;
  if (operator === "lt") return actual < expected;
  if (operator === "lte") return actual <= expected;
  if (operator === "is") return expected === null ? actual == null : actual === expected;
  if (operator === "is_not_null") return actual != null && String(actual).trim() !== "";
  if (operator === "not_in") return Array.isArray(expected) && !expected.includes(String(actual ?? ""));
  if (operator === "in") return Array.isArray(expected) && expected.includes(actual);
  if (operator === "ilike") {
    const a = String(actual ?? "").toLowerCase();
    const e = String(expected ?? "").toLowerCase().replaceAll("%", "");
    return a.includes(e);
  }
  return true;
}

function rowMatchesFilters(row, filters) {
  if (!Array.isArray(filters) || filters.length === 0) return true;
  return filters.every((f) => matchFilterValue(row[f.column], f.operator, f.value));
}

function listLocalRows(db, table) {
  return db
    .prepare(
      `
      SELECT id, payload, created_at, updated_at
      FROM local_records
      WHERE table_name = ?
    `
    )
    .all(table)
    .map((r) => {
      const payload = parseLocalPayload(r.payload);
      return {
        id: payload.id ?? r.id,
        ...payload,
        created_at: payload.created_at ?? r.created_at,
        updated_at: payload.updated_at ?? r.updated_at,
      };
    });
}

function localStoreSelect(db, payload) {
  const rows = listLocalRows(db, payload.table).filter((r) => rowMatchesFilters(r, payload.filters));
  const count = rows.length;
  let resultRows = rows;
  if (payload.orderBy?.column) {
    const col = payload.orderBy.column;
    const asc = payload.orderBy.ascending !== false;
    resultRows = [...resultRows].sort((a, b) => {
      if (a[col] == null && b[col] == null) return 0;
      if (a[col] == null) return asc ? -1 : 1;
      if (b[col] == null) return asc ? 1 : -1;
      if (a[col] < b[col]) return asc ? -1 : 1;
      if (a[col] > b[col]) return asc ? 1 : -1;
      return 0;
    });
  }
  const offset = Number(payload.offset || 0);
  const limit = payload.limit == null ? undefined : Number(payload.limit);
  if (offset > 0 || limit != null) {
    resultRows = resultRows.slice(offset, limit == null ? undefined : offset + limit);
  }
  return {
    rows: resultRows,
    count,
  };
}

function localStoreUpsert(db, payload) {
  const now = new Date().toISOString();
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const stmt = db.prepare(`
    INSERT INTO local_records (table_name, id, payload, created_at, updated_at)
    VALUES (@table_name, @id, @payload, @created_at, @updated_at)
    ON CONFLICT(table_name, id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `);
  rows.forEach((row) => {
    const id = String(row.id || cryptoRandomId());
    const merged = { ...row, id, updated_at: now, created_at: row.created_at || now };
    stmt.run({
      table_name: payload.table,
      id,
      payload: JSON.stringify(merged),
      created_at: merged.created_at,
      updated_at: now,
    });
  });
  return localStoreSelect(db, {
    table: payload.table,
    filters: rows.map((r) => ({ column: "id", operator: "eq", value: String(r.id || "") })).filter((f) => f.value),
  }).rows;
}

function localStoreUpdate(db, payload) {
  const now = new Date().toISOString();
  const allRows = listLocalRows(db, payload.table);
  const matched = allRows.filter((r) => rowMatchesFilters(r, payload.filters));
  const upsertStmt = db.prepare(`
    INSERT INTO local_records (table_name, id, payload, created_at, updated_at)
    VALUES (@table_name, @id, @payload, @created_at, @updated_at)
    ON CONFLICT(table_name, id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `);
  matched.forEach((row) => {
    const merged = {
      ...row,
      ...(payload.patch || {}),
      id: row.id,
      updated_at: now,
      created_at: row.created_at || now,
    };
    upsertStmt.run({
      table_name: payload.table,
      id: String(row.id),
      payload: JSON.stringify(merged),
      created_at: merged.created_at,
      updated_at: now,
    });
  });
  return matched.map((row) => ({ ...row, ...(payload.patch || {}), updated_at: now }));
}

function localStoreDelete(db, payload) {
  const matched = listLocalRows(db, payload.table).filter((r) => rowMatchesFilters(r, payload.filters));
  const del = db.prepare(`DELETE FROM local_records WHERE table_name = ? AND id = ?`);
  matched.forEach((row) => {
    del.run(payload.table, String(row.id));
  });
  return matched;
}

function localRecord(db, table, id) {
  return listLocalRows(db, table).find((row) => String(row.id) === String(id)) || null;
}

function saveLocalRecord(db, table, row) {
  const id = String(row.id || cryptoRandomId());
  localStoreUpsert(db, { table, rows: [{ ...row, id }] });
  return localRecord(db, table, id);
}

function auditLocalMfi(db, organizationId, action, module, recordId, values, reason) {
  return saveLocalRecord(db, "mf_audit_logs", {
    organization_id: organizationId,
    action,
    module,
    record_id: recordId,
    new_values: values || {},
    reason: reason || null,
    source_system: "boat_desktop",
    sync_status: "local_only",
  });
}

function localStoreRpc(db, payload) {
  const fn = String(payload.functionName || "");
  const args = payload.args || {};
  return db.transaction(() => {
    if (fn === "mf_loan_subledger_reconciliation") {
      const orgId = args.p_organization_id;
      const loans = listLocalRows(db, "mf_loans").filter((row) => row.organization_id === orgId);
      const subledger = loans.reduce((sum, row) => sum + Number(row.outstanding_principal || 0), 0);
      return {
        as_of_date: args.p_as_of || new Date().toISOString().slice(0, 10),
        loan_subledger_balance: subledger,
        control_account_balance: subledger,
        difference: 0,
        reconciled: true,
      };
    }

    if (fn === "mf_post_repayment") {
      const repayment = localRecord(db, "mf_repayments", args.p_repayment_id);
      if (!repayment) throw new Error("Repayment was not found.");
      if (repayment.status === "posted") return repayment;
      const loan = localRecord(db, "mf_loans", repayment.loan_id);
      if (!loan) throw new Error("Loan was not found.");
      let remaining = Number(repayment.amount || 0);
      const penalties = Math.min(remaining, Number(loan.outstanding_penalties || 0)); remaining -= penalties;
      const fees = Math.min(remaining, Number(loan.outstanding_fees || 0)); remaining -= fees;
      const interest = Math.min(remaining, Number(loan.outstanding_interest || 0)); remaining -= interest;
      const principal = Math.min(remaining, Number(loan.outstanding_principal || 0));
      const posted = saveLocalRecord(db, "mf_repayments", {
        ...repayment,
        receipt_number: repayment.receipt_number || `RCP-${Date.now()}`,
        principal_amount: principal,
        interest_amount: interest,
        fee_amount: fees,
        penalty_amount: penalties,
        status: "posted",
        posted_at: new Date().toISOString(),
      });
      saveLocalRecord(db, "mf_loans", {
        ...loan,
        outstanding_principal: Math.max(0, Number(loan.outstanding_principal || 0) - principal),
        outstanding_interest: Math.max(0, Number(loan.outstanding_interest || 0) - interest),
        outstanding_fees: Math.max(0, Number(loan.outstanding_fees || 0) - fees),
        outstanding_penalties: Math.max(0, Number(loan.outstanding_penalties || 0) - penalties),
        status: Number(loan.outstanding_principal || 0) - principal <= 0 ? "closed" : loan.status,
      });
      auditLocalMfi(db, repayment.organization_id, "repayment_posted", "collections", repayment.id, posted);
      return posted;
    }

    if (fn === "mf_post_disbursement") {
      const disbursement = localRecord(db, "mf_disbursements", args.p_disbursement_id);
      if (!disbursement) throw new Error("Disbursement was not found.");
      const loan = localRecord(db, "mf_loans", disbursement.loan_id);
      if (!loan) throw new Error("Loan was not found.");
      if (!["approved", "disbursed", "active"].includes(String(loan.status))) {
        throw new Error("A loan must be approved before disbursement.");
      }
      const posted = saveLocalRecord(db, "mf_disbursements", {
        ...disbursement,
        disbursement_reference: disbursement.disbursement_reference || `DSB-${Date.now()}`,
        status: "posted",
        posted_at: new Date().toISOString(),
      });
      saveLocalRecord(db, "mf_loans", { ...loan, status: "active", disbursed_at: disbursement.disbursed_at || new Date().toISOString() });
      auditLocalMfi(db, disbursement.organization_id, "loan_disbursed", "loans", loan.id, posted);
      return posted;
    }

    if (fn === "mf_suspend_interest" || fn === "mf_resume_interest") {
      const loan = localRecord(db, "mf_loans", args.p_loan_id);
      if (!loan) throw new Error("Loan was not found.");
      const suspending = fn === "mf_suspend_interest";
      const updated = saveLocalRecord(db, "mf_loans", {
        ...loan,
        interest_suspended: suspending,
        interest_suspension_date: suspending ? new Date().toISOString().slice(0, 10) : null,
      });
      saveLocalRecord(db, "mf_interest_suspensions", {
        organization_id: loan.organization_id,
        loan_id: loan.id,
        action: suspending ? "suspend" : "resume",
        effective_date: new Date().toISOString().slice(0, 10),
        interest_outstanding: loan.outstanding_interest || 0,
        reason: args.p_reason,
        automatic: Boolean(args.p_automatic),
      });
      auditLocalMfi(db, loan.organization_id, suspending ? "interest_suspended" : "interest_resumed", "portfolio_risk", loan.id, updated, args.p_reason);
      return updated;
    }

    if (fn === "mf_apply_waiver") {
      const loan = localRecord(db, "mf_loans", args.p_loan_id);
      if (!loan) throw new Error("Loan was not found.");
      const component = String(args.p_component || "");
      const field = component === "penalty" ? "outstanding_penalties" : component === "fee" ? "outstanding_fees" : "outstanding_interest";
      const amount = Math.min(Number(args.p_amount || 0), Number(loan[field] || 0));
      saveLocalRecord(db, "mf_loans", { ...loan, [field]: Math.max(0, Number(loan[field] || 0) - amount) });
      const waiver = saveLocalRecord(db, "mf_waivers", {
        organization_id: loan.organization_id, loan_id: loan.id, component, amount,
        reason: args.p_reason, status: "approved", approved_at: new Date().toISOString(),
      });
      auditLocalMfi(db, loan.organization_id, "waiver_approved", "portfolio_risk", loan.id, waiver, args.p_reason);
      return waiver;
    }

    if (fn === "mf_calculate_provisions") {
      const orgId = args.p_organization_id;
      const rules = listLocalRows(db, "mf_classification_rules").filter((row) => row.organization_id === orgId && row.is_active !== false);
      return listLocalRows(db, "mf_loans").filter((row) => row.organization_id === orgId && Number(row.outstanding_principal || 0) > 0).map((loan) => {
        const dpd = Number(loan.days_past_due || 0);
        const rule = rules.find((r) => dpd >= Number(r.min_days_past_due || 0) && (r.max_days_past_due == null || dpd <= Number(r.max_days_past_due))) || { name: "Current", provision_rate: 0 };
        return saveLocalRecord(db, "mf_provisions", {
          organization_id: orgId, loan_id: loan.id, calculation_date: args.p_calculation_date,
          classification: rule.name, outstanding_principal: loan.outstanding_principal,
          provision_rate: rule.provision_rate, required_provision: Number(loan.outstanding_principal || 0) * Number(rule.provision_rate || 0) / 100,
        });
      });
    }

    if (fn === "mf_restructure_loan") {
      const loan = localRecord(db, "mf_loans", args.p_loan_id);
      if (!loan) throw new Error("Loan was not found.");
      const restructure = saveLocalRecord(db, "mf_restructures", {
        organization_id: loan.organization_id, loan_id: loan.id, restructure_type: args.p_type,
        reason: args.p_reason, new_terms: args.p_new_terms || {}, outstanding_principal: loan.outstanding_principal,
        old_schedule_version: loan.schedule_version || 1, status: "approved",
      });
      saveLocalRecord(db, "mf_loans", { ...loan, status: "restructured", schedule_version: Number(loan.schedule_version || 1) + 1 });
      auditLocalMfi(db, loan.organization_id, "loan_restructured", "portfolio_risk", loan.id, restructure, args.p_reason);
      return restructure;
    }

    if (fn === "mf_writeoff_loan") {
      const loan = localRecord(db, "mf_loans", args.p_loan_id);
      if (!loan) throw new Error("Loan was not found.");
      const writeoff = saveLocalRecord(db, "mf_writeoffs", {
        organization_id: loan.organization_id, loan_id: loan.id, writeoff_date: args.p_writeoff_date,
        principal_written_off: loan.outstanding_principal || 0, interest_written_off: loan.outstanding_interest || 0,
        fees_written_off: loan.outstanding_fees || 0, penalties_written_off: loan.outstanding_penalties || 0,
        reason: args.p_reason, status: "approved",
      });
      saveLocalRecord(db, "mf_loans", { ...loan, status: "written_off" });
      auditLocalMfi(db, loan.organization_id, "loan_written_off", "portfolio_risk", loan.id, writeoff, args.p_reason);
      return writeoff;
    }

    if (fn === "mf_record_recovery") {
      const writeoff = localRecord(db, "mf_writeoffs", args.p_writeoff_id);
      if (!writeoff) throw new Error("Write-off was not found.");
      const recovery = saveLocalRecord(db, "mf_recoveries", {
        organization_id: writeoff.organization_id, writeoff_id: writeoff.id, loan_id: writeoff.loan_id,
        amount: Number(args.p_amount || 0), recovery_date: args.p_recovery_date,
        payment_method: args.p_payment_method, external_reference: args.p_external_reference,
        status: "posted",
      });
      auditLocalMfi(db, writeoff.organization_id, "writeoff_recovery", "portfolio_risk", writeoff.loan_id, recovery);
      return recovery;
    }

    if (fn === "mf_reverse_repayment") {
      const repayment = localRecord(db, "mf_repayments", args.p_repayment_id);
      if (!repayment || repayment.status !== "posted") throw new Error("Only a posted repayment can be reversed.");
      const reason = String(args.p_reason || "").trim();
      if (!reason) throw new Error("Reversal reason is required.");
      const loan = localRecord(db, "mf_loans", repayment.loan_id);
      if (!loan) throw new Error("Loan was not found.");
      const principal = Number(repayment.principal_amount || 0);
      const interest = Number(repayment.interest_amount || 0);
      const fees = Number(repayment.fee_amount || 0);
      const penalties = Number(repayment.penalty_amount || 0);
      const reversed = saveLocalRecord(db, "mf_repayments", { ...repayment, status: "reversed", reversal_reason: reason });
      saveLocalRecord(db, "mf_repayments", {
        organization_id: repayment.organization_id, loan_id: repayment.loan_id,
        receipt_number: `REV-${repayment.receipt_number || repayment.id}`,
        external_reference: `REV-${repayment.external_reference || repayment.id}`,
        amount: repayment.amount, payment_date: new Date().toISOString().slice(0, 10),
        payment_method: repayment.payment_method, status: "posted", reversal_of: repayment.id,
        reversal_reason: reason, principal_amount: -principal, interest_amount: -interest,
        fee_amount: -fees, penalty_amount: -penalties,
      });
      saveLocalRecord(db, "mf_loans", {
        ...loan,
        outstanding_principal: Number(loan.outstanding_principal || 0) + principal,
        outstanding_interest: Number(loan.outstanding_interest || 0) + interest,
        outstanding_fees: Number(loan.outstanding_fees || 0) + fees,
        outstanding_penalties: Number(loan.outstanding_penalties || 0) + penalties,
        status: loan.status === "closed" ? "active" : loan.status,
      });
      auditLocalMfi(db, repayment.organization_id, "repayment_reversed", "collections", repayment.id, reversed, reason);
      return reversed;
    }

    if (fn === "seed_microfinance_chart_of_accounts") {
      const orgId = args.p_organization_id;
      const definitions = [
        ["1000","Assets","asset","other"],["1110","Cash on hand","asset","cash"],
        ["1120","Bank account","asset","cash"],["1130","Mobile money account","asset","cash"],
        ["1210","Loan principal receivable","asset","receivable"],["1220","Interest receivable","asset","receivable"],
        ["1240","Suspended interest memorandum","asset","receivable"],["1290","Allowance for loan losses","asset","receivable"],
        ["2000","Liabilities","liability","other"],["2110","Accounts payable","liability","payable"],
        ["2120","Insurance payable","liability","payable"],["2140","Borrower overpayments","liability","payable"],
        ["3000","Equity","equity","other"],["3100","Owner capital","equity","other"],
        ["3200","Retained earnings","equity","other"],["4000","Income","income","revenue"],
        ["4100","Interest income on loans","income","revenue"],["4110","Processing fee income","income","revenue"],
        ["4120","Loan form fee income","income","revenue"],["4140","Penalty income","income","revenue"],
        ["4160","Written-off loan recovery income","income","revenue"],["5000","Operating expenses","expense","expense"],
        ["5100","Salaries and wages","expense","expense"],["5110","Rent expense","expense","expense"],
        ["5120","Utilities","expense","expense"],["5150","Bank and mobile-money charges","expense","expense"],
        ["5200","Loan-loss provision expense","expense","expense"],["5210","Loan write-off expense","expense","expense"],
      ];
      const existing = listLocalRows(db, "gl_accounts").filter((row) => row.organization_id === orgId);
      let inserted = 0;
      for (const [account_code, account_name, account_type, category] of definitions) {
        if (existing.some((row) => row.account_code === account_code)) continue;
        saveLocalRecord(db, "gl_accounts", { organization_id: orgId, account_code, account_name, account_type, category, is_active: true });
        inserted += 1;
      }
      const accounts = listLocalRows(db, "gl_accounts").filter((row) => row.organization_id === orgId);
      const id = (code) => accounts.find((row) => row.account_code === code)?.id || null;
      saveLocalRecord(db, "mf_accounting_settings", {
        id: String(orgId), organization_id: orgId, loan_principal_receivable_id: id("1210"),
        interest_receivable_id: id("1220"), interest_income_id: id("4100"),
        processing_fee_income_id: id("4110"), loan_form_income_id: id("4120"),
        insurance_account_id: id("2120"), penalty_income_id: id("4140"), cash_account_id: id("1110"),
        bank_account_id: id("1120"), mobile_money_account_id: id("1130"), loan_loss_provision_id: id("1290"),
        provision_expense_id: id("5200"), writeoff_expense_id: id("5210"),
        written_off_recovery_income_id: id("4160"), suspended_interest_account_id: id("1240"),
      });
      return inserted;
    }
    throw new Error(`Local desktop function is not implemented: ${fn}`);
  })();
}

module.exports = {
  openDatabase,
  listPosProducts,
  upsertPosProduct,
  listHotelCustomers,
  createHotelCustomer,
  updateHotelCustomer,
  getActiveCashierSession,
  openCashierSession,
  closeCashierSession,
  createRetailSale,
  listRetailCustomers,
  createRetailCustomer,
  updateRetailCustomer,
  deleteRetailCustomer,
  listSyncQueue,
  listPendingSyncQueue,
  updateSyncQueueStatus,
  localStoreSelect,
  localStoreUpsert,
  localStoreUpdate,
  localStoreDelete,
  localStoreRpc,
};
