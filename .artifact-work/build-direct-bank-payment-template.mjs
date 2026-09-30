import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "C:/Projects/BOAT/outputs/direct-bank-fees-template-20260930";
const outputPath = `${outputDir}/direct-bank-fee-payments-template.xlsx`;
const workbook = Workbook.create();
const sheet = workbook.worksheets.add("Direct bank payments");
sheet.showGridLines = false;

sheet.getRange("A2:L2").merge();
sheet.getRange("A2").values = [["Direct bank fee payments template"]];
sheet.getRange("A3:L3").merge();
sheet.getRange("A3").values = [["Enter one payment per row. Fields marked * are required. Use Other for a fee type not listed, then explain it in Notes."]];
sheet.getRange("A5:B7").values = [
  ["Payment method", "Bank"],
  ["Bank payment source", "Direct bank slip"],
  ["Fee type options", "School fees; Examination fees; Uniform; Other"],
];

const headers = [[
  "Payment date *",
  "Bank *",
  "Bank account *",
  "Bank slip / transaction reference *",
  "Student admission number *",
  "Student name",
  "SchoolPay code",
  "Amount (UGX) *",
  "Fee type *",
  "Academic year",
  "Term",
  "Notes",
]];
const firstDataRow = 10;
const lastDataRow = 2009;
sheet.getRange("A9:L9").values = headers;
sheet.getRange(`A${firstDataRow}:L${lastDataRow}`).values = Array.from({ length: lastDataRow - firstDataRow + 1 }, () => Array(12).fill(null));

sheet.getRange("A2:L2").format = {
  font: { name: "Arial", size: 14, bold: true, color: "#17365D" },
  horizontalAlignment: "left",
  verticalAlignment: "center",
};
sheet.getRange("A3:L3").format = {
  font: { name: "Arial", size: 10, italic: true, color: "#595959" },
};
sheet.getRange("A5:A7").format = {
  fill: "#D9EAF7",
  font: { name: "Arial", size: 10, bold: true, color: "#17365D" },
};
sheet.getRange("B5:B7").format = {
  fill: "#EAF3F8",
  font: { name: "Arial", size: 10 },
};
sheet.getRange("A9:L9").format = {
  fill: "#1F4E78",
  font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
};
sheet.getRange(`A${firstDataRow}:L${lastDataRow}`).format.font = { name: "Arial", size: 10 };
sheet.getRange(`A${firstDataRow}:L${lastDataRow}`).format.verticalAlignment = "center";
sheet.getRange(`A${firstDataRow}:L${lastDataRow}`).format.borders = { preset: "insideHorizontal", style: "thin", color: "#E6E6E6" };
sheet.getRange(`A${firstDataRow}:L${lastDataRow}`).format.fill = "#FFFDF5";
sheet.getRange(`A${firstDataRow}:A${lastDataRow}`).format.numberFormat = "yyyy-mm-dd";
sheet.getRange(`H${firstDataRow}:H${lastDataRow}`).format.numberFormat = "#,##0";

sheet.getRange(`I${firstDataRow}:I${lastDataRow}`).dataValidation = {
  rule: { type: "list", values: ["School fees", "Examination fees", "Uniform", "Other"] },
};
sheet.getRange(`K${firstDataRow}:K${lastDataRow}`).dataValidation = {
  rule: { type: "list", values: ["Term 1", "Term 2", "Term 3"] },
};

const widths = [16, 18, 24, 34, 30, 28, 18, 18, 22, 16, 14, 34];
for (let index = 0; index < widths.length; index += 1) {
  sheet.getRangeByIndexes(0, index, 1, 1).format.columnWidth = widths[index];
}
sheet.getRange("2:2").format.rowHeight = 24;
sheet.getRange("3:3").format.rowHeight = 22;
sheet.getRange("9:9").format.rowHeight = 30;
sheet.freezePanes.freezeRows(9);

workbook.recalculate();
const inspection = await workbook.inspect({
  kind: "table",
  range: "Direct bank payments!A2:L12",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 12,
});
const preview = await workbook.render({ sheetName: "Direct bank payments", range: "A2:L15", scale: 1.25, format: "png" });
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(`${outputDir}/preview.png`, new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ outputPath, inspection: inspection.ndjson }));
