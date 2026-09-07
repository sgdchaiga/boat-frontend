import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
const compiled=ts.transpileModule(fs.readFileSync(new URL("../src/lib/expenseReview.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exported={};new Function("exports",compiled)(exported);
const line={id:"line",vendor_id:"vendor",expense_gl_account_id:"expense",source_cash_gl_account_id:"cash",amount:200,vat_amount:36,bank_charges:5,quantity:2,comment:"Wire supplies",vat_gl_account_id:"vat",bank_charges_gl_account_id:null};
test("review lists every posting with particulars, individual GL, amount and direction",()=>{
  const entries=exported.expenseReviewEntries([line],"Purchase","fees");
  assert.deepEqual(entries.map(e=>[e.glAccountId,e.amount,e.direction]),[["expense",200,"Debit"],["vat",36,"Debit"],["fees",5,"Debit"],["cash",241,"Credit"]]);
  assert.ok(entries.every(e=>e.particulars.includes("Wire supplies")&&e.vendorId==="vendor"));
  assert.equal(exported.validateExpenseReviewLines([line]),241,"quantity must not multiply an already extended net amount");
});
test("VAT falls back to expense GL and zero charges are omitted",()=>{
  const entries=exported.expenseReviewEntries([{...line,vat_gl_account_id:null,bank_charges:0,comment:null}],"School supplies",null);
  assert.equal(entries.length,3);assert.equal(entries[1].glAccountId,"expense");assert.equal(entries[0].particulars,"School supplies");
});
test("invalid edits are rejected before saving",()=>{
  for(const patch of [{amount:NaN},{amount:-1},{quantity:0},{source_cash_gl_account_id:""}])assert.throws(()=>exported.validateExpenseReviewLines([{...line,...patch}]));
  assert.throws(()=>exported.validateExpenseReviewLines([]));
});
