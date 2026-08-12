import { Workbook } from "@oai/artifact-tool";
const wb=Workbook.create();wb.worksheets.add("Sheet1");
console.log(wb.help("hyperlink",{include:"index,examples,notes",maxChars:5000}).ndjson);
