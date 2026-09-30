import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const uploadPath = "C:/Users/LUBS/Downloads/boat-schoolpay-upload-template (1).xlsx";
const statementsPath = "C:/Users/LUBS/Documents/Boat/Spensa/Fees Payments/school-statements-and-collections 29092026.xlsx";
const outputDir = "C:/Projects/BOAT/outputs/schoolpay-unposted-20260929";
const outputPath = `${outputDir}/schoolpay-unposted-entries.xlsx`;

const readRows = async (path) => {
  const input = await FileBlob.load(path);
  const workbook = await SpreadsheetFile.importXlsx(input);
  const sheet = workbook.worksheets.getItemAt(0);
  return sheet.getUsedRange(true).values;
};

const normalize = (value) => String(value ?? "").trim().replace(/\.0+$/, "");
const parsePaymentDate = (value) => {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return String(value ?? "");
  const [, year, month, day, hour, minute, second] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
};
const uploadValues = await readRows(uploadPath);
const statementValues = await readRows(statementsPath);

const uploadHeaders = uploadValues[0];
const statementHeaders = statementValues[0];
const uploadIndex = Object.fromEntries(uploadHeaders.map((header, index) => [header, index]));
const statementIndex = Object.fromEntries(statementHeaders.map((header, index) => [header, index]));

const postedReferences = new Set(
  statementValues.slice(1).map((row) => normalize(row[statementIndex.Reference])).filter(Boolean),
);
const unposted = uploadValues.slice(1)
  .map((row, index) => ({
    sourceRow: index + 2,
    schoolPayCode: normalize(row[uploadIndex["SchoolPay Code"]]),
    amount: Number(row[uploadIndex.Amount] ?? 0),
    reference: normalize(row[uploadIndex["Transaction Reference"]]),
    paymentDate: parsePaymentDate(row[uploadIndex["Payment Date"]]),
  }))
  .filter((entry) => !postedReferences.has(entry.reference));

const total = unposted.reduce((sum, entry) => sum + entry.amount, 0);
const workbook = Workbook.create();
const sheet = workbook.worksheets.add("Unposted payments");
sheet.showGridLines = false;

sheet.getRange("A2:F2").merge();
sheet.getRange("A2").values = [["SchoolPay entries not posted"]];
sheet.getRange("A3:F3").merge();
sheet.getRange("A3").values = [["Compared with school-statements-and-collections 29092026.xlsx by transaction reference"]];
sheet.getRange("A5:B6").values = [
  ["Unposted entries", unposted.length],
  ["Unposted amount (UGX)", total],
];

const headers = [["Source row", "SchoolPay code", "Amount (UGX)", "Transaction reference", "Payment date", "Status"]];
const dataRows = unposted.map((entry) => [
  entry.sourceRow,
  entry.schoolPayCode,
  entry.amount,
  entry.reference,
  entry.paymentDate,
  "Not posted",
]);
const tableStart = 8;
const tableEnd = tableStart + dataRows.length;
sheet.getRange(`A${tableStart}:F${tableStart}`).values = headers;
sheet.getRange(`A${tableStart + 1}:F${tableEnd}`).values = dataRows;
const table = sheet.tables.add(`A${tableStart}:F${tableEnd}`, true, "UnpostedSchoolPayPayments");
table.style = "TableStyleMedium2";

sheet.getRange("A2:F2").format = {
  font: { name: "Arial", size: 14, bold: true, color: "#17365D" },
  horizontalAlignment: "left",
  verticalAlignment: "center",
};
sheet.getRange("A3:F3").format = {
  font: { name: "Arial", size: 10, italic: true, color: "#595959" },
};
sheet.getRange("A5:A6").format = {
  font: { name: "Arial", size: 10, bold: true, color: "#17365D" },
  fill: "#D9EAF7",
};
sheet.getRange("B5:B6").format = {
  font: { name: "Arial", size: 10, bold: true },
  fill: "#EAF3F8",
};
sheet.getRange("B5").format.numberFormat = "#,##0";
sheet.getRange("B6").format.numberFormat = "#,##0";
sheet.getRange(`A${tableStart}:F${tableEnd}`).format.font = { name: "Arial", size: 10 };
sheet.getRange(`A${tableStart}:F${tableStart}`).format = {
  fill: "#1F4E78",
  font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
sheet.getRange(`A${tableStart + 1}:A${tableEnd}`).format.horizontalAlignment = "center";
sheet.getRange(`C${tableStart + 1}:C${tableEnd}`).format.numberFormat = "#,##0";
sheet.getRange(`E${tableStart + 1}:E${tableEnd}`).format.numberFormat = "yyyy-mm-dd hh:mm";
sheet.getRange(`F${tableStart + 1}:F${tableEnd}`).format.font = { name: "Arial", size: 10, color: "#9C0006", bold: true };
sheet.getRange(`F${tableStart + 1}:F${tableEnd}`).format.fill = "#FDE9D9";

sheet.getRange("A:A").format.columnWidth = 24;
sheet.getRange("B:B").format.columnWidth = 18;
sheet.getRange("C:C").format.columnWidth = 16;
sheet.getRange("D:D").format.columnWidth = 22;
sheet.getRange("E:E").format.columnWidth = 28;
sheet.getRange("F:F").format.columnWidth = 16;
sheet.getRange("2:2").format.rowHeight = 24;
sheet.freezePanes.freezeRows(tableStart);

workbook.recalculate();
const inspection = await workbook.inspect({
  kind: "table",
  range: "Unposted payments!A2:F14",
  include: "values,formulas",
  tableMaxRows: 14,
  tableMaxCols: 6,
});
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 30 },
  summary: "final formula error scan",
});
const preview = await workbook.render({ sheetName: "Unposted payments", range: "A2:F18", scale: 1.5, format: "png" });
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(`${outputDir}/preview.png`, new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

console.log(JSON.stringify({
  outputPath,
  entries: unposted.length,
  total,
  inspection: inspection.ndjson,
  errors: errors.ndjson,
}));
