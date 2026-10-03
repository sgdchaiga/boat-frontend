import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load("C:/Projects/BOAT/outputs/matched_stanbic_deposits.xlsx"));
const preview = await workbook.render({ sheetName: "Matched deposits", range: "A1:F12", scale: 1.5, format: "png" });
await fs.writeFile("C:/Projects/BOAT/outputs/matched_stanbic_deposits_preview.png", new Uint8Array(await preview.arrayBuffer()));
const check = await workbook.inspect({ kind: "table", range: "Matched deposits!A1:F86", include: "values", tableMaxRows: 90, tableMaxCols: 6 });
console.log(check.ndjson.slice(0, 800));
