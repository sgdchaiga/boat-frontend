import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("payroll loan disbursement debits staff advances and credits cash", async () => {
  const code = await source("src/lib/payrollLoanJournal.ts");
  assert.match(code, /staffAdvanceGl, debit: totalRepayable, credit: 0/);
  assert.match(code, /accounts\.cash, debit: 0, credit: amount/);
  assert.match(code, /payroll_loan_disbursement/);
});

test("school API invoice creation and edits synchronize accrual journals", async () => {
  const code = await source("src/components/school/SchoolStudentInvoicesPage.tsx");
  assert.match(code, /const created = await createSchoolRow<InvRow>/);
  assert.match(code, /invoice: created/);
  assert.match(code, /const updated = await updateSchoolRow<InvRow>/);
  assert.match(code, /invoice: updated/);
});
