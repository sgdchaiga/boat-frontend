import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
const code = ts.transpileModule(fs.readFileSync(new URL("../src/lib/chartOfAccountsImport.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exported = {};
new Function("exports", code)(exported);
const validate = exported.validateChartImport;
const scopeCode = ts.transpileModule(fs.readFileSync(new URL("../src/lib/glAccountBusinessScope.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const scope = {};
new Function("exports", scopeCode)(scope);
test("organization-owned accounts remain visible regardless of template naming rules", () => {
  assert.equal(scope.isGlAccountRelevantForChart({ account_code: "CUSTOM01", account_name: "Raw Materials Inventory", account_source: "custom" }, "school"), true);
  assert.equal(scope.isGlAccountRelevantForBusinessType({ account_code: "CUSTOM02", account_name: "Staff School Support", account_source: "custom" }, "manufacturing"), true);
});
test("custom chart preserves codes, types, parent relationships and inactive accounts", () => {
  const accounts = validate([{ "Account Code": "001", "Account Name": "Assets", "Account Type": "Asset" }, { account_code: "0011", account_name: "Special inventory", account_type: "asset", parent_code: "001", is_active: "false" }]);
  assert.equal(accounts[0].account_code, "001");
  assert.equal(accounts[1].parent_code, "001");
  assert.equal(accounts[1].is_active, false);
});
test("rejects duplicate codes, invalid account types, missing parents and cycles", () => {
  const row = { account_code: "1", account_name: "Assets", account_type: "asset" };
  assert.throws(() => validate([row, row]), /Duplicate/);
  assert.throws(() => validate([{ ...row, account_type: "cash" }]), /account_type/);
  assert.throws(() => validate([{ ...row, parent_code: "2" }]), /Unknown parent/);
  assert.throws(() => validate([{ ...row, parent_code: "2" }, { ...row, account_code: "2", parent_code: "1" }]), /cycle/);
});
