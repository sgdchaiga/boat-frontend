import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "C:/Users/LUBS/Downloads/schoolpay-code-update-template.xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const summary = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 12000,
  tableMaxRows: 30,
  tableMaxCols: 20,
  tableMaxCellChars: 100,
});
console.log(summary.ndjson);
for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange(true);
  console.log(`USED ${sheet.name}: ${used.address}`);
  const region = await workbook.inspect({
    kind: "table",
    sheetId: sheet.sheetId,
    range: used.address,
    include: "values,formulas",
    maxChars: 18000,
    tableMaxRows: 100,
    tableMaxCols: 30,
    tableMaxCellChars: 140,
  });
  console.log(region.ndjson);
}
