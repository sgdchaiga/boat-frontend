import test from "node:test";
import assert from "node:assert/strict";
import { isGlAccountRelevantForChart as relevant, isGlAccountRelevantForBusinessType } from "../src/lib/glAccountBusinessScope.ts";

test("manufacturing excludes unrelated legacy accounts even when mislabeled as manufacturing", () => {
  for (const name of ["Rooms Revenue", "Room Revenue", "Food & Beverage Revenue", "Food Cost of Sales", "Beverage Cost of Sales", "Inventory – Bar", "Kitchen Cost of Sales", "Bar Equipment", "School Fees Revenue", "Tuition Fees", "Clinic Service Revenue", "Member Savings", "Loan Portfolio", "Conference & Events Income"]) {
    for (const business_type of [null, "manufacturing"]) {
      assert.equal(relevant({ account_name: name, business_type }, "manufacturing"), false, name);
    }
  }
});
test("manufacturing retains factory, payroll, fixed assets and common financial accounts", () => {
  for (const name of ["Raw Materials Inventory", "Finished Goods Inventory", "Work in Progress", "Factory Buildings", "Manufacturing Service Income", "Scrap Sales", "Salaries & Wages", "Wages Payable", "PAYE Payable", "NSSF Payable", "Employee Loans", "Plant & Equipment", "Accumulated Depreciation", "Bank Loan", "Loan Interest", "Interest & Fee Income", "Cash on Hand", "Accounts Receivable", "Taxes Payable", "Staff Welfare", "Factory Cleaning"]) {
    assert.equal(relevant({ account_name: name, business_type: "manufacturing" }, "manufacturing"), true, name);
  }
});
test("account names, not overlapping account codes, determine relevance", () => {
  assert.equal(relevant({ account_code: "4110", account_name: "Product Sales" }, "manufacturing"), true);
  assert.equal(relevant({ account_code: "4110", account_name: "Rooms Revenue" }, "manufacturing"), false);
  assert.equal(relevant({ account_name: "Custom Revenue", business_type: "school" }, "manufacturing"), false);
  assert.equal(relevant({ account_name: "Rooms Revenue", business_type: "hotel" }, "hotel"), true);
  assert.equal(relevant({ account_name: "Rooms Revenue" }, "mixed"), true);
});

test("chart cleanup does not change historical report filtering", () => {
  const postedLegacy = { account_name: "Food & Beverage Revenue", business_type: "manufacturing" };
  assert.equal(relevant(postedLegacy, "manufacturing"), false);
  assert.equal(isGlAccountRelevantForBusinessType(postedLegacy, "manufacturing"), true);
});

test("staff medical benefits remain part of the manufacturing chart", () => {
  assert.equal(relevant({ account_name: "Staff Medical Insurance" }, "manufacturing"), true);
  assert.equal(relevant({ account_name: "Medical Service Revenue" }, "manufacturing"), false);
});
