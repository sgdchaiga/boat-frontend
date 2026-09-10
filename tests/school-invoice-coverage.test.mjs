import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/schoolInvoiceCoverage.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const fee = { id: 'f', class_id: 's5', class_name: 'Senior Five', academic_year: '2026', term_name: 'Term 2' };
const students = Array.from({ length: 277 }, (_, id) => ({ id: String(id), class_id: 's5', class_name: 'Senior Five', status: 'active' }));
const invoice = (id, changes = {}) => ({ student_id: String(id), fee_structure_id: 'f', academic_year: '2026', term_name: 'Term 2', status: 'sent', ...changes });
test('distinguishes 130 existing invoices from 147 missing student invoices', () => {
  const result = exports.schoolInvoiceCoverage(students, students.slice(0, 130).map((_, id) => invoice(id)), fee);
  assert.equal(result.students, 277);
  assert.equal(result.matchingInvoices, 130);
  assert.equal(result.selectedStudents, 130);
  assert.equal(result.missingStudents.length, 147);
});
test('separates other structures, cancelled invoices and other terms without double counting', () => {
  const result = exports.schoolInvoiceCoverage(students.slice(0, 4), [invoice(0), invoice(0), invoice(1, { fee_structure_id: null }), invoice(2, { status: 'cancelled' }), invoice(3, { term_name: 'Term 1', fee_structure_id: 'old' })], fee);
  assert.equal(result.selectedStudents, 1);
  assert.equal(result.matchingInvoices, 2);
  assert.equal(result.otherStudents, 1);
  assert.equal(result.cancelledStudents, 1);
  assert.equal(result.missingStudents.length, 1);
});
test('uses linked class IDs and falls back to class names for unlinked students', () => {
  const result = exports.schoolInvoiceCoverage([{ ...students[0], class_id: 's4' }, { ...students[1], class_id: null, class_name: ' senior five ' }], [], fee);
  assert.equal(result.students, 1);
});
