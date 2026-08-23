import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("collaborative reconciliation is optional, versioned, auditable and multi-source", async () => {
  const sql = await source("supabase/migrations/20260823120000_collaborative_reconciliation.sql");
  assert.match(sql, /work_mode text NOT NULL DEFAULT 'individual'/);
  assert.match(sql, /source_type text NOT NULL DEFAULT 'bank'/);
  assert.match(sql, /version=version\+1/);
  assert.match(sql, /reconciliation_activity/);
  assert.match(sql, /supabase_realtime ADD TABLE public\.reconciliation_sessions/);
});

test("reconciliation centre exposes shared workspace roles and approvals", async () => {
  const page = await source("src/components/accounting/BankReconciliationPage.tsx");
  assert.match(page, /Collaborative mode/);
  assert.match(page, /Cashbook owner/);
  assert.match(page, /Statement owner/);
  assert.match(page, /Approve and close/);
  assert.match(page, /Ask teammate/);
});
