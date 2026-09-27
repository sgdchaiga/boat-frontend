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
console.log(JSON.stringify(summary));
for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange(true);
  console.log(`USED ${sheet.name}: ${used.address}`);
  console.log(JSON.stringify(used.getRow(0).resize(25, 6).values));
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
  console.log(JSON.stringify(region));
}

const preview = await workbook.render({
  sheetName: "SchoolPay updates",
  range: "A1:F30",
  scale: 1.5,
  format: "png",
});
await (await import("node:fs/promises")).writeFile(
  "source-preview.png",
  new Uint8Array(await preview.arrayBuffer()),
);
