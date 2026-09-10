import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('../src/components/school/reports/SchoolOutstandingBalancesReportPage.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
async function render(apiMode, fail = false) {
  const exports = {}, states = [], calls = [];
  let load;
  const invoices = [
    { id: 'corrected', student_id: 's2', total_due: 800, amount_paid: 300, status: 'partial' },
    { id: 'cancelled', student_id: 's2', total_due: 900, amount_paid: 0, status: 'cancelled' },
    { id: 'paid', student_id: 's2', total_due: 200, amount_paid: 200, status: 'paid' },
  ];
  const students = [{ id: 's2', class_name: 'Senior Two' }];
  const deps = {
    react: { useState: (initial) => { const index = states.length; states.push(initial); return [initial, (value) => { states[index] = value; }]; }, useCallback: (fn) => { load = fn; return fn; }, useMemo: (fn) => fn(), useEffect: () => {} },
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
    '@/contexts/AuthContext': { useAuth: () => ({ user: { organization_id: 'org' } }) },
    '@/contexts/AppContext': { useAppContext: () => ({}) },
    '../SchoolInvoiceFilters': { useSchoolInvoiceFilters: (rows) => ({ filteredRows: rows }) },
    '@/lib/schoolApiData': { canUseSchoolApi: () => apiMode, listSchoolRows: async (resource, org) => { calls.push([resource, org]); if (fail) throw new Error('Unavailable'); return resource === 'invoices' ? invoices : students; } },
    '@/lib/supabase': { supabase: { from: (table) => { assert.equal(apiMode, false); calls.push(table); const query = { select: () => query, eq: () => query, neq: () => query, then: (resolve) => resolve({ data: table === 'student_invoices' ? invoices : students }) }; return query; } } },
  };
  vm.runInNewContext(code, { exports, require: (name) => deps[name] || {} });
  exports.SchoolOutstandingBalancesReportPage({});
  await load();
  return { states, calls };
}
for (const mode of [true, false]) test(`outstanding report uses corrected invoice amounts in ${mode ? 'API' : 'Supabase'} mode`, async () => {
  const { states, calls } = await render(mode);
  assert.equal(states[0].length, 1);
  assert.equal(states[0][0].id, 'corrected');
  assert.equal(states[0][0].balance, 500);
  assert.equal(states[0][0].student.class_name, 'Senior Two');
  assert.equal(states[1], false);
  if (mode) assert.deepEqual(calls, [['invoices', 'org'], ['students', 'org']]);
});
test('failed report loading exposes the error and clears balances', async () => {
  const { states } = await render(true, true);
  assert.equal(states[0].length, 0);
  assert.equal(states[1], false);
  assert.equal(states[2], 'Unavailable');
});
