import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("payroll automatically loads and deducts active loan installments", async () => {
  const [runPage, loansPage, loanMath] = await Promise.all([
    source("src/components/payroll/PayrollRunPage.tsx"),
    source("src/components/payroll/PayrollLoansPage.tsx"),
    source("src/lib/payrollLoanWriteDown.ts"),
  ]);

  assert.match(runPage, /computeLoanDeductionForStaff\(p\.staff_id, loanList\)/);
  assert.match(runPage, /gross - paye - nssfE - loan/);
  assert.match(runPage, /if \(profilesError \|\| loansError\)/);
  assert.match(loanMath, /l\.staff_id === staffId && l\.is_active/);
  assert.match(loanMath, /Math\.min\(Number\(l\.installment_amount\), Number\(l\.balance_remaining\)\)/);

  // Leaving the opening balance blank must not create an active zero-balance
  // loan, which would silently produce a zero payroll deduction.
  assert.match(loansPage, /form\.balance_remaining\.trim\(\) === "" \? Math\.max\(0, totalRepayable - alreadyRecovered\)/);
  assert.match(loansPage, /p > 0 && b > 0 && i > 0/);
});
