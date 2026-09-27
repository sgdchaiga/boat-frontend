import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "C:/Users/LUBS/Downloads/schoolpay-code-update-template.xlsx";
const outputDir = "C:/Projects/BOAT/outputs/schoolpay-code-update";
const outputPath = `${outputDir}/schoolpay-code-update.xlsx`;

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheet = workbook.worksheets.getItem("SchoolPay updates");
const records = sheet.getRange("A2:F1944").values.filter((row) => row[0] !== null);
const lastRecordRow = records.length + 1;

const invalid = records.filter((row) => {
  const [admissionNumber, studentName, currentCode, correctedCode] = row;
  return !Number.isInteger(admissionNumber)
    || typeof studentName !== "string"
    || !/^\d{10}$/.test(String(currentCode))
    || !/^\d{10}$/.test(String(correctedCode))
    || currentCode === correctedCode;
});
if (invalid.length > 0) {
  throw new Error(`Cannot prepare code updates: ${invalid.length} record(s) are invalid.`);
}

const admissions = records.map(([admissionNumber]) => admissionNumber);
if (new Set(admissions).size !== admissions.length) {
  throw new Error("Cannot prepare code updates: duplicate admission numbers found.");
}

// The template records both source and target codes. Retain those audit fields
// and mark each supplied row as prepared for the administrator's SchoolPay update.
sheet.getRange(`E2:E${lastRecordRow}`).values = records.map(() => ["Ready for update"]);
// The downloaded template includes residual note values below the populated
// records. Clear those rows so BOAT's importer does not treat them as updates.
sheet.getRange(`A${lastRecordRow + 1}:F1944`).clear({ applyTo: "contents" });

workbook.recalculate();

const updated = sheet.getRange(`A1:F${lastRecordRow}`).values;
const readyCount = updated.slice(1).filter((row) => row[4] === "Ready for update").length;
const correctedCodesPreserved = updated.slice(1).every((row, index) => row[3] === records[index][3]);
if (readyCount !== records.length || !correctedCodesPreserved) {
  throw new Error("Verification failed: the update queue was not preserved correctly.");
}

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(`Formula error scan records: ${errors.recordCount}`);

const preview = await workbook.render({
  sheetName: "SchoolPay updates",
  range: "A1:F30",
  scale: 1.5,
  format: "png",
});
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(`${outputDir}/schoolpay-code-update-preview.png`, new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ outputPath, records: readyCount, correctedCodesPreserved }));
