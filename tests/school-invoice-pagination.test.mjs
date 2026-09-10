import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/supabasePagination.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
test('loads Senior Five students beyond the first 1000 school records', async () => {
  const students = Array.from({ length: 1147 }, (_, id) => ({ id, class_name: id >= 870 ? 'Senior Five' : 'Other' }));
  const loaded = await exports.fetchAllPages(async (from, to) => ({ data: students.slice(from, to + 1), error: null }));
  const seniorFive = loaded.filter((student) => student.class_name === 'Senior Five');
  assert.equal(seniorFive.length, 277);
  const existing = new Set(seniorFive.slice(0, 130).map((student) => student.id));
  assert.equal(seniorFive.filter((student) => !existing.has(student.id)).length, 147);
});
test('invoice loading, student loading and duplicate checks all use pagination', () => {
  const source = readFileSync(new URL('../src/components/school/SchoolStudentInvoicesPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /fetchAllPages<StudentOpt>/);
  assert.equal((source.match(/fetchAllPages<InvRow>/g) || []).length, 2);
});
