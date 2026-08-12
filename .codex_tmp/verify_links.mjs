import {FileBlob,SpreadsheetFile} from "@oai/artifact-tool";
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load("C:/Projects/BOAT/outputs/019fecc4-9f94-7e01-b76c-991a6bb24544/BOAT_Microfinance_Module.xlsx"));
console.log((await wb.inspect({kind:"formula",sheetId:"Menu",range:"A4:A27",maxChars:5000,options:{maxResults:30}})).ndjson);
