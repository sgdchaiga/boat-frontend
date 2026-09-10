import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const exports = {}, printed = [], csv = [];
class PDF {
  setDrawColor() {} setLineWidth() {} rect() {} setFontSize() {} setFont() {} setTextColor() {}
  splitTextToSize(value) { return [value]; }
  text(value) { printed.push(value); }
  output() { return new Blob(); }
}
const dependencies = {
  jspdf: { jsPDF: PDF },
  '@/lib/accountingReportExport': { downloadCsv: (...args) => csv.push(args) },
  '@/constants/branding': { APP_SHORT_NAME: 'BOAT' },
  '@/lib/supabase': {},
};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/schoolFeeReceipt.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, require: (name) => dependencies[name] });
test('SchoolPay code retains leading zeros in receipt payload, PDF and spreadsheet export', () => {
  const detail = exports.schoolFeeReceiptDetailFromPayment({ amount: 100, method: 'cash', reference: null, paid_at: '2026-09-10' }, 'R1', '2026-09-10', 'Jane Doe', 'School', null, null, '0012345678');
  assert.equal(detail.schoolPayCode, '0012345678');
  exports.createSchoolFeeReceiptPdfBlob(detail);
  assert.ok(printed.flat().includes('0012345678'));
  exports.downloadSchoolFeeReceiptExcel(detail);
  assert.ok(csv[0][1].some(([key, value]) => key === 'SchoolPay code' && value === '0012345678'));
});
test('missing SchoolPay code is optional for existing receipt callers', () => {
  const detail = exports.schoolFeeReceiptDetailFromPayment({ amount: 100, method: 'cash', paid_at: '2026-09-10' }, 'R2', '2026-09-10', 'Jane Doe', 'School', null);
  assert.equal(detail.schoolPayCode, null);
});
