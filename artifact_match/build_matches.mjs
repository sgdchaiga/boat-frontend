import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const inputPath = "C:/Projects/BOAT/match_results.txt";
const outputDir = "C:/Projects/BOAT/outputs/stanbic-student-matches";

const lines = (await fs.readFile(inputPath, "utf8")).trim().split(/\r?\n/).slice(1);
const rows = lines.map((line) => {
  const parts = line.split("|");
  if (parts[0] === "MATCH") {
    return [parts[5], parts[1], parts[2], parts[3], parts[4], "Exact token match", 1, "Matched"];
  }
  const candidate = parts[3].split(" ; ")[0].split(":");
  const score = Number(candidate[0]);
  return ["", parts[1], candidate[1] || "", candidate[2] || "", candidate[3] || "", "Spelling / partial-name match", score, score >= 0.9 ? "Probable match" : "Review needed"];
});

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("Matches");
sheet.showGridLines = false;
sheet.tabColor = "#1F4E78";

sheet.getRange("A2:H2").merge();
sheet.getRange("A2").values = [["Stanbic unmatched payment name matching"]];
sheet.getRange("A2").format = { font: { name: "Arial", size: 14, bold: true, color: "#1F2937" } };
sheet.getRange("A3").values = [["Name order is ignored. Confirm all rows marked Review needed before posting a payment."]];
sheet.getRange("A3:H3").merge();
sheet.getRange("A3").format = { font: { name: "Arial", size: 10, italic: true, color: "#4B5563" } };

const headers = [["Bank reference", "Stanbic name", "Matched student", "Admission number", "SchoolPay code", "Match method", "Score", "Status"]];
sheet.getRange("A5:H5").values = headers;
sheet.getRangeByIndexes(5, 0, rows.length, 8).values = rows;
sheet.getRange(`A5:H${rows.length + 5}`).format.font = { name: "Arial", size: 10 };
sheet.getRange("A5:H5").format = { fill: "#1F4E78", font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center" };
sheet.getRange(`A5:H${rows.length + 5}`).format.borders = { preset: "outside", style: "thin", color: "#D1D5DB" };
sheet.getRange(`A6:H${rows.length + 5}`).format.verticalAlignment = "center";
sheet.getRange(`G6:G${rows.length + 5}`).format.numberFormat = [["0.0%"]];
sheet.getRange(`G6:G${rows.length + 5}`).format.horizontalAlignment = "right";
sheet.getRange(`H6:H${rows.length + 5}`).conditionalFormats.add("containsText", { text: "Review needed", format: { fill: "#FEE2E2", font: { color: "#B91C1C", bold: true } } });
sheet.getRange(`H6:H${rows.length + 5}`).conditionalFormats.add("containsText", { text: "Probable match", format: { fill: "#FEF3C7", font: { color: "#92400E" } } });
sheet.getRange(`H6:H${rows.length + 5}`).conditionalFormats.add("containsText", { text: "Matched", format: { fill: "#DCFCE7", font: { color: "#166534" } } });
sheet.freezePanes.freezeRows(5);
sheet.getRange("A:A").format.columnWidth = 16;
sheet.getRange("B:B").format.columnWidth = 24;
sheet.getRange("C:C").format.columnWidth = 30;
sheet.getRange("D:E").format.columnWidth = 18;
sheet.getRange("F:F").format.columnWidth = 26;
sheet.getRange("G:G").format.columnWidth = 10;
sheet.getRange("H:H").format.columnWidth = 17;
sheet.getRange("A2:H2").format.rowHeight = 24;
sheet.getRange("A3:H3").format.rowHeight = 18;
sheet.getRange("A5:H5").format.rowHeight = 22;
sheet.tables.add(`A5:H${rows.length + 5}`, true, "MatchResults");

const reviewRows = rows.filter((row) => row[7] === "Review needed");
const review = workbook.worksheets.add("Review needed");
review.showGridLines = false;
review.tabColor = "#B45309";
review.getRange("A2:H2").merge();
review.getRange("A2").values = [["Payment names needing manual confirmation"]];
review.getRange("A2").format = { font: { name: "Arial", size: 14, bold: true, color: "#1F2937" } };
review.getRange("A4:H4").values = headers;
review.getRangeByIndexes(4, 0, reviewRows.length, 8).values = reviewRows;
review.getRange(`A4:H${reviewRows.length + 4}`).format.font = { name: "Arial", size: 10 };
review.getRange("A4:H4").format = { fill: "#B45309", font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center" };
review.getRange(`A4:H${reviewRows.length + 4}`).format.borders = { preset: "outside", style: "thin", color: "#D1D5DB" };
review.getRange(`G5:G${reviewRows.length + 4}`).format.numberFormat = [["0.0%"]];
review.getRange("A:A").format.columnWidth = 16;
review.getRange("B:B").format.columnWidth = 24;
review.getRange("C:C").format.columnWidth = 30;
review.getRange("D:E").format.columnWidth = 18;
review.getRange("F:F").format.columnWidth = 26;
review.getRange("G:G").format.columnWidth = 10;
review.getRange("H:H").format.columnWidth = 17;
review.freezePanes.freezeRows(4);
review.tables.add(`A4:H${reviewRows.length + 4}`, true, "ReviewMatches");

workbook.recalculate();
await fs.mkdir(outputDir, { recursive: true });
const inspection = await workbook.inspect({ kind: "table", range: `Matches!A2:H${rows.length + 5}`, include: "values", tableMaxRows: 8, tableMaxCols: 8 });
console.log(inspection.ndjson);
const preview = await workbook.render({ sheetName: "Matches", range: "A2:H20", scale: 1.5 });
await fs.writeFile(`${outputDir}/preview.png`, new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outputDir}/stanbic_student_matches.xlsx`);
console.log(JSON.stringify({ total: rows.length, review: reviewRows.length }));
