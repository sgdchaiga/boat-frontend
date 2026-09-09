import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/admin/AdminLocalImportPage.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const importCloudExpenses =');
const end = source.indexOf('  const importCloudPayments =', start);
const javascript = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

async function run(row) {
  const saved = {};
  const supabase = { from(table) {
    if (table === 'gl_accounts') return {
      select: () => ({ eq: () => ({ eq: async () => ({ data: [
        { id: 'expense-gl', account_code: '6100' },
        { id: 'cash-gl', account_code: '1000' },
      ], error: null }) }) }),
    };
    return { insert(payload) {
      saved[table] = payload;
      return table === 'expenses'
        ? { select: () => ({ single: async () => ({ data: { id: 'expense-id' }, error: null }) }) }
        : Promise.resolve({ error: null });
    } };
  } };
  const dependencies = {
    requireOrganizationId: () => 'active-org', supabase,
    isSpendMoneyApprovalEnabled: async () => true,
    asText: (value) => value == null ? '' : String(value).trim(),
    asNumber: (value) => Number(value),
    findOrCreateVendor: async () => 'vendor-id',
    createJournalForExpenseWithLines: async () => { throw new Error('Approval must precede posting'); },
    queueExpenseForTreasury: async (payload) => { saved.treasury = payload; },
    user: { id: 'user-id' },
  };
  const importer = new Function(...Object.keys(dependencies), javascript + '\nreturn importCloudExpenses;')(...Object.values(dependencies));
  assert.equal(await importer([{ expense_date: '2026-09-09', amount: 100, description: 'Stationery', expense_account_code: '6100', cash_account_code: '1000', vendor_name: 'Supplier', ...row }]), 1);
  return saved;
}

test('expense import preserves recipient and payment identifiers with leading zeros', async () => {
  const saved = await run({ payee: 'Named recipient', cheque_number: '000123', voucher_number: '000456' });
  assert.equal(saved.expenses.organization_id, 'active-org');
  assert.equal(saved.expenses.payee_name, 'Named recipient');
  assert.equal(saved.expenses.cheque_number, '000123');
  assert.equal(saved.expenses.voucher_number, '000456');
  assert.equal(saved.treasury.payeeName, 'Named recipient');
});

test('older expense templates keep working with optional payment identifiers', async () => {
  const saved = await run({});
  assert.equal(saved.expenses.payee_name, 'Supplier');
  assert.equal(saved.expenses.cheque_number, null);
  assert.equal(saved.expenses.voucher_number, null);
});

test('expense import accepts common alternative identifier headers', async () => {
  const saved = await run({ payee_name: 'Recipient', cheque_no: '001', voucher_no: 'PV-2' });
  assert.equal(saved.expenses.payee_name, 'Recipient');
  assert.equal(saved.expenses.cheque_number, '001');
  assert.equal(saved.expenses.voucher_number, 'PV-2');
});
