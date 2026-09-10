import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const students = [
  { id: 'a', first_name: 'Jane', last_name: 'Doe', admission_number: 'ADM01', school_pay_number: '0012345678', class_id: 'c1', class_name: 'P1' },
  { id: 'b', first_name: 'John', last_name: 'Doe', admission_number: 'ADM02', class_id: 'c2', class_name: 'P2' },
];
const rows = [
  { student_id: 'a', invoice_number: 'INV01', academic_year: '2026', term_name: 'Term 1', status: 'partial', issue_date: '2026-01-10' },
  { student_id: 'b', invoice_number: 'INV02', academic_year: '2026', term_name: 'Term 2', status: 'sent', issue_date: '2026-05-10' },
  { student_id: 'a', invoice_number: 'INV03', academic_year: '2025', term_name: 'Term 1', status: 'paid', issue_date: null },
];
const code = ts.transpileModule(readFileSync(new URL('../src/components/school/SchoolInvoiceFilters.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function filter(values) {
  const exports = {};
  vm.runInNewContext(code, { exports, require: (name) => name === 'react' ? {
    useState: (initial) => [{ ...initial, ...values }, () => {}], useMemo: (fn) => fn(),
  } : { jsx: () => null, jsxs: () => null } });
  return Array.from(exports.useSchoolInvoiceFilters(rows, students).filteredRows, (row) => row.invoice_number);
}
test('invoice filters combine student, class, year, term, status and inclusive dates', () => {
  assert.deepEqual(filter({ student: 'a', className: 'P1', year: '2026', term: 'Term 1', status: 'partial', from: '2026-01-10', to: '2026-01-10' }), ['INV01']);
  assert.deepEqual(filter({ student: 'a', className: 'P2' }), []);
});
test('search matches names, admissions and invoices without case sensitivity', () => {
  assert.deepEqual(filter({ search: ' jane doe ' }), ['INV01', 'INV03']);
  assert.deepEqual(filter({ search: 'adm02' }), ['INV02']);
  assert.deepEqual(filter({ search: 'inv03' }), ['INV03']);
});
test('date filters exclude undated invoices and clearing filters restores all rows', () => {
  assert.deepEqual(filter({ from: '2026-01-01' }), ['INV01', 'INV02']);
  assert.deepEqual(filter({ to: '2026-01-10' }), ['INV01']);
  assert.deepEqual(filter({}), ['INV01', 'INV02', 'INV03']);
});

test('search finds SchoolPay codes including leading zeros', () => {
  assert.deepEqual(filter({ search: '0012345678' }), ['INV01', 'INV03']);
});
