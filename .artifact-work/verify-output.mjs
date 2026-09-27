import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbook = await SpreadsheetFile.importXlsx(
  await FileBlob.load("C:/Projects/BOAT/outputs/schoolpay-code-update/schoolpay-code-update.xlsx"),
);
const sheet = workbook.worksheets.getItem("SchoolPay updates");
console.log(JSON.stringify(sheet.getRange("A1:F26").values));
const preview = await workbook.render({
  sheetName: "SchoolPay updates",
  range: "A1:F26",
  scale: 1,
  format: "png",
});
await (await import("node:fs/promises")).writeFile(
  "C:/Projects/BOAT/outputs/schoolpay-code-update/reimport-preview.png",
  new Uint8Array(await preview.arrayBuffer()),
);
