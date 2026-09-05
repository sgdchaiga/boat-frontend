import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function accounting({ retireOk = true } = {}) {
  const calls = [];
  const exports = {};
  const dependencies = {
    './journal': {
      deleteJournalEntryByReference: async (...args) => {
        calls.push(['retire', ...args]);
        return retireOk ? { ok: true } : { ok: false, error: 'Period locked' };
      },
      createJournalForSchoolInvoiceAccrual: async () => { calls.push(['post']); return { ok: true }; },
    },
    './journalAccountSettings': {
      fetchJournalGlSettings: async () => { calls.push(['settings']); return { school_accounting_basis: 'accrual' }; },
    },
    './timezone': { businessTodayISO: () => '2026-09-05' },
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/schoolFeeJournal.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => dependencies[name] });
  return { sync: exports.syncStudentInvoiceAccounting, calls };
}

const options = {
  organizationId: 'school-a', staffUserId: 'staff-a', accountingBasis: 'accrual',
  invoice: { id: 'invoice-a', student_id: 'student-a', invoice_number: 'INV-1', total_due: 100, status: 'sent' },
};

test('bulk accounting reuses its basis and scopes journal retirement to the school', async () => {
  const { sync, calls } = accounting();
  await sync(options);
  assert.deepEqual(calls, [['retire', 'school_invoice', 'invoice-a', 'school-a'], ['post']]);
});

test('failed journal retirement stops reposting and exposes the error', async () => {
  const { sync, calls } = accounting({ retireOk: false });
  assert.equal((await sync(options)).journalMessage, 'Period locked');
  assert.equal(calls.some(([kind]) => kind === 'post'), false);
});

test('standalone synchronization still loads the accounting basis', async () => {
  const { sync, calls } = accounting();
  await sync({ ...options, accountingBasis: undefined });
  assert.equal(calls[0][0], 'settings');
});
