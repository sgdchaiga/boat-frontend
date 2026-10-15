import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const templatePath = "C:/Users/LUBS/Documents/Boat/Spensa/Fees Payments/School Fee Report.xlsx";
const outputDir = "C:/Projects/BOAT/outputs/school-fees-report-2026";
const outputPath = `${outputDir}/School Fee Report - 2026.xlsx`;

const termData = [
  { term: "Term 1", invoices: 2748, charged: 2515882400, paid: 984723490, balance: 1531238910 },
  { term: "Term 2", invoices: 2033, charged: 2475635200, paid: 391785308, balance: 2083849892 },
  { term: "Term 3", invoices: 2034, charged: 2479740200, paid: 117751765, balance: 2361988435 },
];

const input = await FileBlob.load(templatePath);
const workbook = await SpreadsheetFile.importXlsx(input);
const sheet = workbook.worksheets.getItem("Sheet1");

sheet.getRange("A1:H1").merge();
sheet.getRange("A1").values = [["CLOUD School — School Fees Report (Academic Year 2026)"]];
sheet.getRange("A1:H1").format = {
  fill: "#17365D",
  font: { name: "Arial", size: 13, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
sheet.getRange("A1:H1").format.rowHeight = 26;

// The supplied template is a class grid. BOAT's verified report currently provides
// organization-level term totals, so the All Classes column is used instead of
// fabricating allocations by senior class.
sheet.getRange("C2:H2").values = [["All Classes", "Senior Two", "Senior Three", "Senior Four", "Senior Five", "Senior Six"]];
sheet.getRange("C2:H2").format = {
  fill: "#DCE6F1",
  font: { name: "Arial", size: 10, bold: true, color: "#17365D" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};

for (const [index, item] of termData.entries()) {
  const startRow = [3, 9, 14][index];
  sheet.getRange(`A${startRow}`).values = [[item.term]];
  sheet.getRange(`B${startRow}`).values = [["Opening Balance"]];
  sheet.getRange(`B${startRow + 1}`).values = [["Fees Charged"]];
  sheet.getRange(`B${startRow + 2}`).values = [["Paid"]];
  sheet.getRange(`B${startRow + 3}`).values = [["Balance"]];
  sheet.getRange(`C${startRow}:C${startRow + 3}`).values = [[null], [item.charged], [item.paid], [item.balance]];
  sheet.getRange(`A${startRow}:H${startRow + 3}`).format.font = { name: "Arial", size: 10, color: "#1F2937" };
  sheet.getRange(`A${startRow}`).format = { fill: "#17365D", font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" }, verticalAlignment: "center" };
  sheet.getRange(`B${startRow}:H${startRow}`).format.fill = "#EAF1F8";
  sheet.getRange(`B${startRow}:B${startRow + 3}`).format.font = { name: "Arial", size: 10, bold: true, color: "#17365D" };
  sheet.getRange(`C${startRow}:H${startRow + 3}`).format.numberFormat = "#,##0;(#,##0);-";
  sheet.getRange(`C${startRow}:H${startRow + 3}`).format.horizontalAlignment = "right";
  sheet.getRange(`A${startRow}:H${startRow + 3}`).format.borders = { preset: "all", style: "thin", color: "#B8C6D1" };
}

sheet.getRange("A19:H19").merge();
sheet.getRange("A19").values = [["Source: BOAT Term Performance Summaries, reviewed 13 Oct 2026. Amounts in UGX. Opening balances and class-level allocations are unavailable in the live source report."]];
sheet.getRange("A19:H19").format = {
  font: { name: "Arial", size: 9, italic: true, color: "#4B5563" },
  horizontalAlignment: "left",
  verticalAlignment: "center",
  wrapText: true,
};
sheet.getRange("A19:H19").format.rowHeight = 28;

sheet.getRange("A1:H19").format.verticalAlignment = "center";
sheet.getRange("A:A").format.columnWidth = 15;
sheet.getRange("B:B").format.columnWidth = 20;
sheet.getRange("C:H").format.columnWidth = 16;
sheet.showGridLines = false;

workbook.recalculate();
const check = await workbook.inspect({
  kind: "table",
  range: "Sheet1!A1:H19",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 8,
});
console.log(check.ndjson);
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 50 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);
const preview = await workbook.render({ sheetName: "Sheet1", range: "A1:H19", scale: 1.5, format: "png" });
await fs.writeFile(`${outputDir}/preview.png`, new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(outputPath);
