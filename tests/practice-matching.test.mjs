import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/practiceMatching.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
const { proposePracticeMatches: match } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const line = (id, side, amount, reference = null, extra = {}) => ({ id, side, amount, reference, account_key: 'BANK-001', currency: 'UGX', line_date: '2026-09-01', description: '', ...extra });
test('equal amount and date alone do not prove a match', () => {
  assert.equal(match([line('c','cashbook',100),line('b','statement',100)]).groups.length, 0);
});
test('unique exact reference matches and records evidence', () => {
  const result=match([line('c','cashbook',100,' REF-42 '),line('b','statement',100,'ref-42')]);
  assert.equal(result.groups.length,1); assert.match(result.groups[0].reason,/REF-42/);
});
test('conflicting references cannot match even with equal descriptions', () => {
  assert.equal(match([line('c','cashbook',100,'A',{description:'Customer payment'}),line('b','statement',100,'B',{description:'Customer payment'})]).groups.length,0);
});
test('grouped reference settlement matches exact totals', () => {
  const result=match([line('c1','cashbook',200000,'BATCH42'),line('c2','cashbook',400000,'BATCH42'),line('b','statement',600000,'BATCH42')]);
  assert.equal(result.groups.length,1); assert.equal(result.groups[0].ids.length,3);
});
test('many-to-one works in either direction', () => {
  assert.equal(match([line('c','cashbook',300,'A'),line('b1','statement',100,'A'),line('b2','statement',200,'A')]).groups.length,1);
});
test('grouping cannot hide reversals or unmatched residuals', () => {
  assert.equal(match([line('c1','cashbook',120,'A'),line('c2','cashbook',-20,'A'),line('b','statement',100,'A')]).groups.length,0);
  assert.equal(match([line('c','cashbook',100,'A'),line('b','statement',99,'A')]).groups.length,0);
});
test('duplicate candidates remain for review regardless of row order', () => {
  const rows=[line('c1','cashbook',100,'A'),line('c2','cashbook',100,'A'),line('b','statement',200,'A')];
  assert.equal(match(rows).groups.length,0); assert.equal(match(rows.reverse()).reviewIds.length,3);
});
test('description matching requires mutual uniqueness', () => {
  const extra={description:'Invoice settlement'};
  const rows=[line('c','cashbook',100,null,extra),line('b1','statement',100,null,extra),line('b2','statement',100,null,{...extra,line_date:'2026-09-02'})];
  assert.equal(match(rows).groups.length,0);
  assert.equal(match(rows.slice(0,2)).groups.length,1);
});
test('date windows and signed amounts are enforced', () => {
  assert.equal(match([line('c','cashbook',100,'A'),line('b','statement',100,'A',{line_date:'2026-09-05'})]).groups.length,0);
  assert.equal(match([line('c','cashbook',100,'A'),line('b','statement',-100,'A')]).groups.length,0);
});
test('decimal totals use minor units, invalid and zero values need review', () => {
  assert.equal(match([line('c1','cashbook',0.1,'A'),line('c2','cashbook',0.2,'A'),line('b','statement',0.3,'A')]).groups.length,1);
  for(const amount of [NaN,Infinity,0,1.001]) assert.equal(match([line('c','cashbook',amount,'A'),line('b','statement',amount,'A')]).groups.length,0);
});
test('generic placeholder references provide no evidence', () => {
  assert.equal(match([line('c','cashbook',100,'N/A'),line('b','statement',100,'N/A')]).groups.length,0);
});
test('different accounts, currencies and unknown scopes never match', () => {
  for (const extra of [{account_key:'BANK-002'},{currency:'USD'},{account_key:null},{currency:null}]) {
    assert.equal(match([line('c','cashbook',100,'A'),line('b','statement',100,'A',extra)]).groups.length,0);
  }
});
