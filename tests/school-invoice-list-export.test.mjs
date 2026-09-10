import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('../src/components/school/SchoolInvoiceListExport.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
test('selected columns and exact filtered rows are shared by Excel, PDF and print', () => {
  const exports = {}, captures = {};
  const element = (type, props) => ({ type, props });
  const deps = {
    react: { useState: () => [['name', 'admission', 'residency', 'due'], () => {}] },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    jspdf: { jsPDF: class { setFontSize() {} text() {} save() {} } },
    'jspdf-autotable': { default: (_, options) => { captures.pdf = options; } },
    xlsx: { utils: { aoa_to_sheet: (values) => { captures.excel = values; return {}; }, book_new: () => ({}), book_append_sheet: () => {} }, writeFile: () => {} },
  };
  vm.runInNewContext(code, { exports, require: (name) => deps[name], window: { open: () => ({ document: { write: (html) => { captures.print = html; }, close: () => {} } }) } });
  const tree = exports.SchoolInvoiceListExport({ rows: [{ name: 'Jane Doe', admission: '00123', residency: 'Day', due: 1500, schoolPay: 'SECRET', invoice: 'INV1' }], school: { name: 'School', address: '' }, disabled: false, onError: () => {} });
  const buttons = [];
  const visit = (node) => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(visit); return; } if (node.type === 'button') buttons.push(node); visit(node.props?.children); };
  visit(tree);
  for (const title of ['Export Excel', 'Export PDF', 'Print list']) buttons.find((button) => button.props.children === title).props.onClick();
  assert.deepEqual(Array.from(captures.excel[0]), ['Student name', 'Admission number', 'Day/Boarding', 'Total due']);
  assert.deepEqual(Array.from(captures.excel[1]), ['Jane Doe', '00123', 'Day', 1500]);
  assert.equal(captures.excel.length, 2);
  assert.deepEqual(Array.from(captures.pdf.body[0]), ['Jane Doe', '00123', 'Day', 1500]);
  assert.match(captures.print, /<td>Jane Doe<\/td><td>00123<\/td>/);
  assert.doesNotMatch(captures.print, /SECRET|SchoolPay code/);
});
