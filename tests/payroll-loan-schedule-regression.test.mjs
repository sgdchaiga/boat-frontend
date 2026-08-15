import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");
test("loan schedule supports flat default and declining interest", async () => {
  const [math, page] = await Promise.all([source("src/lib/payrollLoanSchedule.ts"), source("src/components/payroll/PayrollLoansPage.tsx")]);
  assert.match(math, /method: PayrollLoanInterestMethod = "flat"/);
  assert.match(math, /method === "declining" \? openingBalance \* monthlyRate : flatInterest/);
  assert.match(page, /Edit/); assert.match(page, /Schedule/); assert.match(page, /Cancel/);
  assert.match(page, /Repayment period \(months\)/);
  assert.match(page, /Total amount payable/);
  assert.match(page, /const i = repaymentPreview\.installment/);
});
