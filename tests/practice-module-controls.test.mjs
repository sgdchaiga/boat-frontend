import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("practice navigation exposes the Phase 1 operational control pages", () => {
  const layout = read("src/components/Layout.tsx");
  for (const page of ["practice_dashboard", "practice_engagements", "practice_my_work", "practice_document_requests", "practice_support", "practice_billing", "practice_renewals", "practice_profitability", "practice_activity", "practice_time_expenses", "practice_sales", "practice_quality", "practice_capacity", "practice_client_portal", "practice_advanced", "practice_integrations", "practice_mobile"]) {
    assert.match(layout, new RegExp(page));
  }
});

test("practice invoices reuse the canonical BOAT invoice engine", () => {
  const finance = read("src/components/accounting-practice/PracticeFinancePage.tsx");
  assert.match(finance, /from\("retail_invoices"\)/);
  assert.match(finance, /from\("retail_invoice_lines"\)/);
  assert.doesNotMatch(finance, /from\("practice_invoices"\)/);
});

test("practice migrations enforce organization ownership and engagement financial links", () => {
  const operations = read("supabase/migrations/20260802120000_practice_operations_mvp.sql");
  const finance = read("supabase/migrations/20260804110000_practice_financial_integration.sql");
  const hardening = read("supabase/migrations/20260804130000_practice_phase1_hardening.sql");
  assert.match(operations, /organization_id/);
  assert.match(operations, /ENABLE ROW LEVEL SECURITY/);
  assert.match(finance, /practice_engagement_id/);
  assert.match(hardening, /lower\(s\.role\) IN/);
});
