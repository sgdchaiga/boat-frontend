import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const pythonPath = "C:/Users/LUBS/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";
const outputPath = "C:/Projects/BOAT/outputs/matched_stanbic_deposits.xlsx";
const extractionScript = String.raw`import pandas as pd,re,unicodedata,json
d=pd.read_excel(r'C:\Users\LUBS\Documents\Boat\Spensa\Fees Payments\Stanbic Direct Deposit.xlsx')
a=pd.read_excel(r'C:\Users\LUBS\Documents\Boat\Spensa\Boat Alevel.xlsx')
tok=lambda x:' '.join(sorted(re.findall(r'[a-z0-9]+',unicodedata.normalize('NFKD',str(x)).encode('ascii','ignore').decode().lower())))
a['_key']=a['Student'].map(tok)
matches={key:group.iloc[0] for key,group in a.groupby('_key') if len(group)==1}
result=[]
for _,row in d.iterrows():
    student=matches.get(tok(row['Student']))
    if student is not None:
        result.append([str(row['Effective Date'])[:10],str(row['Bank Reference']),row['Amount'],row['Student'],int(student['admission_number']),None if pd.isna(student['school_pay_number']) else int(student['school_pay_number'])])
print(json.dumps(result))`;
const matchedRows = JSON.parse(execFileSync(pythonPath, ["-c", extractionScript], { encoding: "utf8" }));

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("Matched deposits");
sheet.getRange("A1:F1").values = [["Effective Date", "Bank Reference", "Amount", "Student", "Admission Number", "SchoolPay Code"]];
sheet.getRange("A2").write(matchedRows);
sheet.getRange(`A1:F${matchedRows.length + 1}`).format.font = { name: "Arial", size: 10 };
sheet.getRange("A1:F1").format = { fill: "#1F4E78", font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center" };
sheet.getRange(`A1:F${matchedRows.length + 1}`).format.borders = { preset: "all", style: "thin", color: "#D9E2F3" };
sheet.getRange(`A2:A${matchedRows.length + 1}`).format.numberFormat = "yyyy-mm-dd";
sheet.getRange(`C2:C${matchedRows.length + 1}`).format.numberFormat = "#,##0";
sheet.getRange(`E2:F${matchedRows.length + 1}`).format.numberFormat = "0";
sheet.getRange(`A2:A${matchedRows.length + 1}`).format.horizontalAlignment = "center";
sheet.getRange(`C2:C${matchedRows.length + 1}`).format.horizontalAlignment = "right";
sheet.getRange(`E2:F${matchedRows.length + 1}`).format.horizontalAlignment = "right";
sheet.getRange("A:A").format.columnWidth = 16;
sheet.getRange("B:B").format.columnWidth = 18;
sheet.getRange("C:C").format.columnWidth = 14;
sheet.getRange("D:D").format.columnWidth = 28;
sheet.getRange("E:F").format.columnWidth = 18;
sheet.freezePanes.freezeRows(1);
sheet.showGridLines = false;
workbook.recalculate();
const verification = await workbook.inspect({ kind: "table", range: "Matched deposits!A1:F10", include: "values", tableMaxRows: 10, tableMaxCols: 6 });
console.log(verification.ndjson);
await fs.mkdir("C:/Projects/BOAT/outputs", { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`MATCHED_ROWS=${matchedRows.length}`);
