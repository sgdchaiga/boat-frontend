import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const source = JSON.parse(await fs.readFile("C:/Projects/BOAT/.tmp/current_students_export.json", "utf8"));
const outputDir = "C:/Projects/BOAT/outputs/student-import-audit-20260831";
await fs.mkdir(outputDir, { recursive: true });

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Summary");
const students = workbook.worksheets.add("Current Students");
summary.showGridLines = false;
students.showGridLines = false;

summary.getRange("A1:F1").merge();
summary.getRange("A1").values = [["St Peter's S.S Nsambya — Student Import Review"]];
summary.getRange("A1:F1").format = { fill: "#1E3A5F", font: { bold: true, color: "#FFFFFF", size: 16 }, rowHeight: 32 };
summary.getRange("A3:B7").values = [
  ["Snapshot date", new Date("2026-08-31T00:00:00+03:00")],
  ["Requested start date", new Date("2026-08-28T00:00:00+03:00")],
  ["Current student records", source.length],
  ["Current active records", source.length],
  ["Inactive records", 0],
];
summary.getRange("A3:A7").format = { fill: "#E8EEF5", font: { bold: true, color: "#1E3A5F" } };
summary.getRange("B3:B4").format.numberFormat = "yyyy-mm-dd";
summary.getRange("B5:B7").format.numberFormat = "#,##0";
summary.getRange("A9:F9").merge();
summary.getRange("A9").values = [["Important audit limitation"]];
summary.getRange("A9:F9").format = { fill: "#FEF3C7", font: { bold: true, color: "#92400E" } };
summary.getRange("A10:F12").merge();
summary.getRange("A10").values = [["The production application exposes the complete current student state, but there is no student change-history table. This workbook therefore includes every current student record, including rows that may have been overwritten by bulk import. It cannot reconstruct a student's former class or prove the exact import date after an overwrite. The live class movement observed was 17 students reassigned into Senior Six (6 from Senior One and 11 from Senior Four)."]];
summary.getRange("A10:F12").format = { wrapText: true, fill: "#FFFBEB", font: { color: "#78350F" }, verticalAlignment: "top" };
summary.getRange("A10:F12").format.rowHeight = 30;

const classes = [...new Set(source.map((row) => row.class_name))].sort();
summary.getRange("A14:B14").values = [["Current class", "Students"]];
summary.getRange(`A15:A${14 + classes.length}`).values = classes.map((name) => [name]);
summary.getRange(`B15:B${14 + classes.length}`).formulas = classes.map((_, index) => [`=COUNTIF('Current Students'!$D$2:$D$${source.length + 1},A${15 + index})`]);
summary.getRange("A14:B14").format = { fill: "#2563EB", font: { bold: true, color: "#FFFFFF" } };
summary.getRange(`B15:B${14 + classes.length}`).format.numberFormat = "#,##0";
summary.getRange("A1:F20").format.font = { name: "Aptos", size: 11 };
summary.getRange("A:A").format.columnWidth = 26;
summary.getRange("B:B").format.columnWidth = 18;
summary.getRange("C:F").format.columnWidth = 14;

const headers = ["Admission Number", "SchoolPay Number", "Student Name", "Current Class", "Current Stream", "Gender", "Day / Boarding"];
students.getRange("A1:G1").values = [headers];
students.getRange(`A2:G${source.length + 1}`).values = source.map((row) => [row.admission_number, row.school_pay_number, row.student_name, row.class_name, row.stream, row.gender, row.day_boarding]);
students.getRange("A1:G1").format = { fill: "#1E3A5F", font: { bold: true, color: "#FFFFFF" }, rowHeight: 26 };
students.getRange(`A2:G${source.length + 1}`).format = { font: { name: "Aptos", size: 10 }, borders: { insideHorizontal: { style: "thin", color: "#E5E7EB" } } };
students.getRange(`A1:G${source.length + 1}`).format.wrapText = false;
students.getRange("A:B").format.numberFormat = "@";
students.getRange("A:A").format.columnWidth = 18;
students.getRange("B:B").format.columnWidth = 18;
students.getRange("C:C").format.columnWidth = 30;
students.getRange("D:G").format.columnWidth = 18;
students.freezePanes.freezeRows(1);
students.tables.add(`A1:G${source.length + 1}`, true, "CurrentStudentsTable");

const summaryPreview = await workbook.render({ sheetName: "Summary", range: "A1:F20", scale: 1.2, format: "png" });
await fs.writeFile(`${outputDir}/summary-preview.png`, new Uint8Array(await summaryPreview.arrayBuffer()));
const studentsPreview = await workbook.render({ sheetName: "Current Students", range: "A1:G25", scale: 1, format: "png" });
await fs.writeFile(`${outputDir}/students-preview.png`, new Uint8Array(await studentsPreview.arrayBuffer()));

const inspection = await workbook.inspect({ kind: "table", range: "Summary!A1:F20", include: "values,formulas", tableMaxRows: 20, tableMaxCols: 8 });
await fs.writeFile(`${outputDir}/inspection.ndjson`, inspection.ndjson);
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "final formula error scan" });
if (errors.ndjson.includes("match")) await fs.writeFile(`${outputDir}/formula-errors.ndjson`, errors.ndjson);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outputDir}/st-peters-students-from-2026-08-28.xlsx`);
process.stdout.write(JSON.stringify({ rows: source.length, output: `${outputDir}/st-peters-students-from-2026-08-28.xlsx` }));
