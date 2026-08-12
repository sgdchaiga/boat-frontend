import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("employer NSSF posts to a separate expense GL", async () => {
  const [posting, settings, migration] = await Promise.all([
    source("src/lib/payrollPostAccounting.ts"),
    source("src/components/payroll/PayrollSettingsPage.tsx"),
    source("supabase/migrations/20260812213000_separate_nssf_employer_expense.sql"),
  ]);

  assert.match(posting, /gl_account_id: gl\.salaryExpenseGlAccountId,[\s\S]*?debit: round2\(g\)/);
  assert.match(posting, /gl_account_id: gl\.nssfEmployerExpenseGlAccountId,[\s\S]*?debit: round2\(nssfEr\)/);
  assert.doesNotMatch(posting, /round2\(g \+ nssfEr\)/);
  assert.match(settings, /NSSF employer contribution expense/);
  assert.match(migration, /Payroll salary & employer NSSF expense/);
  assert.match(migration, /NSSF Employer Contribution/);
});
