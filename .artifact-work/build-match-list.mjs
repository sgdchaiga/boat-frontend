import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const stanbicPath = 'C:\\Users\\LUBS\\Documents\\Boat\\Spensa\\Fees Payments\\Stanbic Combined.xlsx';
const boatPath = 'C:\\Users\\LUBS\\Downloads\\school-statements-and-collections (2).csv';
const outputPath = 'C:\\Projects\\BOAT\\outputs\\fee-payment-matches.xlsx';
const stanbicBook = XLSX.read(fs.readFileSync(stanbicPath), { type: 'buffer' });
const stanbic = XLSX.utils.sheet_to_json(stanbicBook.Sheets.Stanbic, { defval: '' });
const boatBook = XLSX.read(fs.readFileSync(boatPath, 'utf8'), { type: 'string' });
const boat = XLSX.utils.sheet_to_json(boatBook.Sheets[boatBook.SheetNames[0]], { defval: '' });
const byKey = new Map();
for (const row of stanbic) {
  const key = `${String(row.Schoolpay || '').trim()}|${Number(row.Amount || 0)}`;
  byKey.set(key, [...(byKey.get(key) || []), row]);
}
const matches = [];
for (const row of boat) {
  const key = `${String(row['SchoolPay code'] || '').trim()}|${Number(row.Amount || 0)}`;
  for (const bank of byKey.get(key) || []) {
    matches.push({
      'Student': row.Student,
      'SchoolPay code': row['SchoolPay code'],
      'Amount': Number(row.Amount),
      'BOAT paid at': row['Paid at'],
      'BOAT reference': row.Reference,
      'Stanbic effective date': XLSX.SSF.format('yyyy-mm-dd', bank['Effective Date']),
      'Stanbic bank reference': bank['Bank Reference'],
      'Stanbic description': bank.Description,
      'Match basis': 'SchoolPay code + amount',
    });
  }
}
const summary = [{ 'Stanbic entries': stanbic.length, 'BOAT entries': boat.length, 'Candidate matches': matches.length, 'Match rule': 'Exact SchoolPay code and amount' }];
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), 'Summary');
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(matches), 'Matches');
for (const sheet of Object.values(workbook.Sheets)) sheet['!cols'] = Array.from({ length: 9 }, () => ({ wch: 22 }));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
