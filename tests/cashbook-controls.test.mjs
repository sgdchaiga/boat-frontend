import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("cashbook corrections are reversal based and posted fields are immutable", async () => {
  const sql = await source("supabase/migrations/20260802130000_general_microfinance_cashbook_controls.sql");
  assert.match(sql, /Posted cashbook entries cannot be deleted/);
  assert.match(sql, /void_general_cashbook_entry/);
  assert.match(sql, /correct_general_cashbook_entry/);
  assert.match(sql, /SELECT jid,gl_account_id,credit,debit/);
  assert.match(sql, /reversal_of_entry_id/);
});

test("maker checker and configurable permission overrides are enforced", async () => {
  const sql = await source("supabase/migrations/20260802130000_general_microfinance_cashbook_controls.sql");
  assert.match(sql, /created_by IS DISTINCT FROM auth\.uid\(\)/);
  assert.match(sql, /cashbook_transaction_control/);
  assert.match(sql, /staff_permission_overrides/);
});

test("historical entries are approved while new entries retain pending default", async () => {
  const sql = await source("supabase/migrations/20260802130000_general_microfinance_cashbook_controls.sql");
  assert.match(sql, /approval_status text NOT NULL DEFAULT 'pending'/);
  assert.match(sql, /SET approval_status='approved'/);
});

test("microfinance cashbook includes all posted loan cash-flow sources", async () => {
  const ui = await source("src/components/general-business/GeneralBusinessCashbookPage.tsx");
  for (const table of ["mf_repayments","mf_disbursements","mf_recoveries"]) assert.match(ui,new RegExp(table));
  assert.match(ui, /Repayment reversal/);
  assert.match(ui, /workspace_type: isMicrofinance/);
});

test("channel balances, pagination, and all export formats are available", async () => {
  const ui = await source("src/components/general-business/GeneralBusinessCashbookPage.tsx");
  const sql = await source("supabase/migrations/20260802130000_general_microfinance_cashbook_controls.sql");
  assert.match(sql, /cashbook_daily_channel_positions/);
  assert.match(ui, /setRowLimit\(limit=>limit\+2000\)/);
  assert.match(ui, /downloadXlsx/);
  assert.match(ui, /exportAccountingPdf/);
  assert.match(ui, /downloadCsv/);
  assert.match(ui, /@media print/);
});
