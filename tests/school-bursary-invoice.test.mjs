import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/schoolBursaryInvoice.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports });
const calculate = exports.bursaryInvoiceChanges;
const invoice = { subtotal: 1000, discount_amount: 100, scholarship_amount: 50, amount_paid: 200, status: 'partial' };

test('bursary replaces the reduction while preserving other discounts and payments', () => {
  const result = calculate(invoice, 300);
  assert.equal(result.total_due, 550);
  assert.equal(result.bursary_amount, 300);
  assert.equal(result.status, 'partial');
  assert.equal(invoice.amount_paid, 200);
  assert.equal(calculate(invoice, 0).total_due, 850);
  assert.equal(calculate(invoice, 300).total_due, result.total_due);
});

test('fully covered invoices become paid and totals never go below zero', () => {
  assert.equal(calculate(invoice, 650).status, 'paid');
  assert.equal(calculate(invoice, 1200).total_due, 0);
  assert.equal(calculate({ ...invoice, status: 'paid' }, 0).status, 'partial');
});

test('draft and cancelled invoices retain their workflow', () => {
  assert.equal(calculate({ ...invoice, status: 'draft' }, 900).status, 'draft');
  assert.equal(calculate({ ...invoice, status: 'cancelled' }, 300), null);
  assert.equal(calculate({ ...invoice, amount_paid: 0, status: 'sent' }, 100).status, 'sent');
});
