import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("payroll navigation exposes the complete workflow", () => {
  const pages = read("src/lib/payrollPages.ts");
  for (const route of ["salary", "review", "payments", "statutory", "reports"]) {
    assert.match(pages, new RegExp(`${route}:`));
  }
});

test("payroll migration supports full workflow and operational records", () => {
  const sql = read("supabase/migrations/20260821120000_complete_payroll_workflow.sql");
  for (const status of ["under_review", "paid", "reversed"]) assert.match(sql, new RegExp(`'${status}'`));
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.payroll_payments/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.payroll_statutory_remittances/);
});

test("operational payroll pages are implemented", () => {
  const source = read("src/components/payroll/PayrollOperationsPages.tsx");
  for (const page of ["PayrollReviewPage", "PayrollPaymentsPage", "PayrollStatutoryPage", "PayrollReportsPage"]) {
    assert.match(source, new RegExp(`export function ${page}`));
  }
});
