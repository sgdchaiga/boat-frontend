import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
const input="C:/Users/LUBS/Documents/Others/Single view excel/Coop Fin Statements_Example.xlsx";
const out="C:/Projects/BOAT/outputs/019fecc4-9f94-7e01-b76c-991a6bb24544/reference";
await fs.mkdir(out,{recursive:true});
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(input));
console.log((await wb.inspect({kind:"workbook,sheet,table,drawing",maxChars:12000,tableMaxRows:12,tableMaxCols:15})).ndjson);
const sheets=await wb.inspect({kind:"sheet",include:"id,name",maxChars:6000});
console.log(sheets.ndjson);
const names=[];
for(let i=0;i<20;i++){try{const s=wb.worksheets.getItemAt(i);if(!s)break;names.push(s.name);}catch{break;}}
for(const name of names){const pic=await wb.render({sheetName:name,autoCrop:"all",scale:1,format:"png"});await fs.writeFile(`${out}/${name.replaceAll(/[^A-Za-z0-9]/g,"_")}.png`,new Uint8Array(await pic.arrayBuffer()));}
