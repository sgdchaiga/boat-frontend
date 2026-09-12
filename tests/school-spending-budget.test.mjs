import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/schoolSpendingBudget.ts', import.meta.url),'utf8');
const module = { exports: {} };
new Function('exports','module',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module.exports,module);
const {schoolSpendingPeriod,schoolBudgetCoversDate,schoolBudgetIsSpendable,schoolBudgetUnavailableMessage,schoolBudgetLeafLines} = module.exports;
const annual = { id:'annual',name:'FY 2026 Work Budget',financial_year:2026,period_mode:'annual',status:'active',is_active:true,start_date:null,end_date:null };

test('annual budgets cover the full financial year without requiring term budgets',()=>{
  assert.deepEqual(schoolSpendingPeriod(annual),{from:'2026-01-01',to:'2026-12-31'});
  for (const date of ['2026-01-01','2026-09-12','2026-12-31']) assert.equal(schoolBudgetCoversDate(annual,date),true);
  assert.equal(schoolBudgetCoversDate(annual,'2027-01-01'),false);
  assert.equal(schoolBudgetCoversDate({...annual,period_mode:'annual_terms'},'2026-09-12'),true);
});
test('explicit fiscal dates take precedence and undated nonannual budgets are not expanded',()=>{
  const fiscal={...annual,start_date:'2026-07-01',end_date:'2027-06-30'};
  assert.equal(schoolBudgetCoversDate(fiscal,'2027-03-01'),true);
  assert.equal(schoolBudgetCoversDate(fiscal,'2026-06-30'),false);
  assert.equal(schoolSpendingPeriod({...annual,period_mode:'term'}),null);
  assert.equal(schoolSpendingPeriod({...annual,financial_year:null}),null);
});
test('imported drafts are not spendable even when their legacy active flag is true',()=>{
  const draft={...annual,status:'draft'};
  assert.equal(schoolBudgetIsSpendable(draft),false);
  assert.equal(schoolBudgetIsSpendable({...annual,status:'approved'}),false);
  assert.equal(schoolBudgetIsSpendable({...annual,status:'closed'}),false);
  assert.equal(schoolBudgetIsSpendable(annual),true);
  const message=schoolBudgetUnavailableMessage([draft],'2026-09-12');
  assert.match(message,/FY 2026 Work Budget \(draft\)/);
  assert.doesNotMatch(message,/Term 2/);
});
test('nested vote totals are counted only once while independent GL lines remain',()=>{
  const lines=[{id:'vote',parent_line_id:null,amount:100},{id:'group',parent_line_id:'vote',amount:60},{id:'sub1',parent_line_id:'group',amount:60},{id:'sub2',parent_line_id:'vote',amount:40},{id:'other',parent_line_id:null,amount:20}];
  const leaves=schoolBudgetLeafLines(lines);
  assert.deepEqual(leaves.map(l=>l.id),['sub1','sub2','other']);
  assert.equal(leaves.reduce((sum,l)=>sum+l.amount,0),120);
});
