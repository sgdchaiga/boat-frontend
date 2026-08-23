import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const source = "C:/Users/LUBS/Documents/Personal/Charkk/IT/Boat/Tuyige S.S budget estimates Year 2022.xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source));
const summary = await workbook.inspect({
  kind: "workbook,sheet,table,formula,drawing",
  maxChars: 18000,
  tableMaxRows: 20,
  tableMaxCols: 16,
  tableMaxCellChars: 120,
  options: { maxResults: 250 },
});
console.log("SUMMARY");
console.log(summary.ndjson);
const names = workbook.worksheets.items.map((sheet) => sheet.name);
console.log(`NAMES ${JSON.stringify(names)}`);
for (const name of names) {
  const sheet = workbook.worksheets.getItem(name);
  const used = sheet.getUsedRange();
  console.log(`SHEET ${name} USED ${used?.address ?? "unknown"}`);
  const detail = await workbook.inspect({ kind: "region,formula", sheetId: name, range: used?.address?.split("!").pop() ?? "A1:Z200", maxChars: 16000, tableMaxRows: 120, tableMaxCols: 20, options: { maxResults: 300 } });
  console.log(detail.ndjson);
  const preview = await workbook.render({ sheetName: name, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(`C:/Projects/BOAT/.tmp_budget_review/${name.replace(/[^a-z0-9]+/gi, "_")}.png`, new Uint8Array(await preview.arrayBuffer()));
}
