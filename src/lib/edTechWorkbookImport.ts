import * as XLSX from "xlsx";
import type { ModelProject, ProjectDriver } from "@/lib/projectPortfolioEngine";

export type ImportedPersonnelRole = { id:string; jobTitle:string; lowerSalary:number; upperSalary:number; annualSalaryGrowth:number; positions:Record<number,number> };
export type EdTechImportPreview = {
  sourceName:string; layoutVersion:string; projects:ModelProject[]; personnelRoles:ImportedPersonnelRole[];
  capex:number; debt:number; interestRate:number; annualPayroll:number; warnings:string[];
  summary:{yearOneRevenue:number; yearOneDirectCosts:number; projectCount:number; personnelCount:number};
};

const CORE_SHEETS = ["Subscription Econ","Carts Economics","Tablet Economics","Tablet Costs","Human Capital","Capex Investment","Financing","Government"];
const blankProject = (id:string):ModelProject => ({ id, name:"", businessType:"education-technology", enabled:true, startingUnits:0, annualGrowth:0, revenuePerUnit:0, directCostRate:0, annualFixedCosts:0, startYear:1, revenueDrivers:[], costDrivers:[] });

export function parseEdTechWorkbook(workbook:XLSX.WorkBook, sourceName:string, years:number):EdTechImportPreview {
  const missing=CORE_SHEETS.filter(name=>!workbook.Sheets[name]);
  if(missing.length) throw new Error(`Workbook not recognised. Missing sheets: ${missing.join(", ")}.`);
  const warnings:string[]=[];
  if(!workbook.Sheets["Training &Onboarding"]) warnings.push("Training &Onboarding sheet is absent; training costs were not imported.");
  const id=(name:string)=>`${name}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const read=(sheetName:string,cellAddress:string,label:string,required=false)=>{
    const cell=workbook.Sheets[sheetName]?.[cellAddress];
    if(cell?.f) warnings.push(`${label} (${sheetName}!${cellAddress}) is formula-driven; BOAT used Excel's cached value. Recalculate and save the workbook before importing.`);
    const value=typeof cell?.v==="number"&&Number.isFinite(cell.v)?cell.v:Number.NaN;
    if(!Number.isFinite(value)){if(required)warnings.push(`${label} is missing or non-numeric at ${sheetName}!${cellAddress}.`);return 0;}
    return value;
  };
  const magnitude=(value:number,label:string)=>{if(value<0)warnings.push(`${label} was stored as a negative accounting amount and was converted to a positive operating magnitude.`);return Math.abs(value);};
  const first=(values:number[])=>values.find(value=>value!==0)??0;
  const tabletQuantity=magnitude(first([read("Tablet Costs","B6","Tablet quantity"),read("Tablet Costs","B29","Tablet quantity fallback")]),"Tablet quantity");
  const tabletPrice=magnitude(read("Tablet Economics","B5","Tablet selling price",true),"Tablet selling price");
  const tabletCost=magnitude(first([read("Tablet Costs","B49","Tablet landed cost"),read("Tablet Economics","B9","Tablet landed cost fallback")]),"Tablet landed cost");
  const cartQuantity=magnitude(read("Tablet Costs","C6","Charging-cart quantity",true),"Charging-cart quantity");
  const cartPrice=magnitude(read("Carts Economics","B5","Charging-cart selling price",true),"Charging-cart selling price");
  const cartCost=magnitude(first([read("Carts Economics","B12","Charging-cart landed cost"),read("Tablet Costs","C20","Charging-cart landed cost fallback")]),"Charging-cart landed cost");
  const learnerQuantity=magnitude(read("Government","B5","Learner subscriptions",true),"Learner subscriptions");
  const learnerPrice=magnitude(read("Government","C5","Subscription price",true),"Subscription price");
  const tabletRevenueId=id("tablet-revenue"),cartRevenueId=id("cart-revenue"),subscriptionRevenueId=id("subscription-revenue");
  const driver=(name:string,quantity:number,unitAmount:number,frequency:ProjectDriver["frequency"]="annual"):ProjectDriver=>({id:id("driver"),name,amount:0,quantity,unitAmount,frequency});
  const projects:ModelProject[]=[
    {...blankProject(id("project")),name:"EdTechPAD Tablets",businessType:"hardware",revenueDrivers:[{...driver("Tablet and device sales",tabletQuantity,tabletPrice),id:tabletRevenueId}],costDrivers:[{...driver("Tablet landed and configuration cost",tabletQuantity,tabletCost),linkedDriverId:tabletRevenueId,linkedUnitsPerUnit:1}]},
    {...blankProject(id("project")),name:"Charging Carts",businessType:"hardware",revenueDrivers:[{...driver("Charging cart sales",cartQuantity,cartPrice),id:cartRevenueId}],costDrivers:[{...driver("Charging cart landed cost",cartQuantity,cartCost),linkedDriverId:cartRevenueId,linkedUnitsPerUnit:1}]},
    {...blankProject(id("project")),name:"EdTechPAD Subscriptions",businessType:"subscription",revenueDrivers:[{...driver("Learner subscriptions",learnerQuantity,learnerPrice),id:subscriptionRevenueId}],costDrivers:[{...driver("NCDC content share",learnerQuantity,learnerPrice*.2),linkedDriverId:subscriptionRevenueId,linkedUnitsPerUnit:1}]},
  ];
  if(workbook.Sheets["Training &Onboarding"]){
    projects.push({...blankProject(id("project")),name:"Training and Onboarding",businessType:"services",costDrivers:[13,14,15,18].map((row,index)=>driver(["Staff allowance","Meals","Accommodation","Transport and fuel"][index],1,magnitude(read("Training &Onboarding",`J${row}`,`Training cost row ${row}`),`Training cost row ${row}`)))});
  }
  const governmentRevenue=[driver("Government tablet deployment",magnitude(read("Government","B3","Government tablet quantity"),"Government tablet quantity"),magnitude(read("Government","C3","Government tablet price"),"Government tablet price"),"one-off"),driver("Government subscriptions",learnerQuantity,learnerPrice,"annual")];
  const governmentCosts=[4,6,7,8,9,10,11,12,13,14].map(row=>{
    const name=String(workbook.Sheets["Government"]?.[`A${row}`]?.v??`Government cost ${row}`).trim()||`Government cost ${row}`;
    const quantity=magnitude(read("Government",`B${row}`,`${name} quantity`),`${name} quantity`);
    const unitAmount=magnitude(first([read("Government",`C${row}`,`${name} unit cost`),read("Government",`D${row}`,`${name} total cost`)]),`${name} cost`);
    return driver(name,quantity||1,unitAmount,/subscription|support|licen[cs]e/i.test(name)?"annual":"one-off");
  }).filter(item=>item.unitAmount!==0);
  projects.push({...blankProject(id("project")),name:"Government Digital Learning",businessType:"government",enabled:false,revenueDrivers:governmentRevenue,costDrivers:governmentCosts});

  const personnelRoles:ImportedPersonnelRole[]=[];
  const humanSheet=workbook.Sheets["Human Capital"];
  for(let row=6;row<=70;row++){
    const jobTitle=String(humanSheet?.[`B${row}`]?.v??"").trim();
    const count=Number(humanSheet?.[`C${row}`]?.v)||0, lower=Number(humanSheet?.[`D${row}`]?.v)||0, upper=Number(humanSheet?.[`E${row}`]?.v)||0;
    if(!jobTitle||(!lower&&!upper))continue;
    if(count<0||lower<0||upper<0) warnings.push(`${jobTitle} contains a negative headcount or salary; positive planning magnitudes were used.`);
    personnelRoles.push({id:id("role"),jobTitle,lowerSalary:Math.abs(lower)*12,upperSalary:Math.abs(upper)*12,annualSalaryGrowth:5,positions:Object.fromEntries(Array.from({length:years},(_,index)=>[index+1,Math.abs(count)]))});
  }
  if(!personnelRoles.length) warnings.push("No valid personnel roles were found in Human Capital rows 6–70.");

  const capexSheet=workbook.Sheets["Capex Investment"];
  const headerCandidates=["F","E","D"].map(column=>({column,score:Array.from({length:20},(_,index)=>String(capexSheet?.[`${column}${index+1}`]?.v??"")).filter(value=>/total|amount|investment|cost/i.test(value)).length}));
  const capexColumn=headerCandidates.sort((a,b)=>b.score-a.score)[0]?.column??"F";
  if(!headerCandidates.some(item=>item.score>0)) warnings.push(`Capex total-column header was not identified; ${capexColumn} was used as the latest-layout fallback.`);
  const detailAmounts:number[]=[], totalAmounts:number[]=[];
  for(let row=1;row<=139;row++){
    const amount=Number(capexSheet?.[`${capexColumn}${row}`]?.v);
    if(!Number.isFinite(amount)||amount===0)continue;
    const label=`${capexSheet?.[`A${row}`]?.v??""} ${capexSheet?.[`B${row}`]?.v??""}`;
    (/total/i.test(label)?totalAmounts:detailAmounts).push(Math.abs(amount));
  }
  const capex=detailAmounts.length?detailAmounts.reduce((sum,value)=>sum+value,0):(totalAmounts.length?Math.max(...totalAmounts):0);
  if(!capex) warnings.push("No capex amount could be reconciled from the selected Capex Investment amount column.");
  const debt=magnitude(read("Financing","B4","Debt facility 1")+read("Financing","B5","Debt facility 2"),"Total debt funding");
  const rawRate=read("Financing","C4","Interest rate",true);
  const interestRate=rawRate>0&&rawRate<=1?rawRate*100:rawRate;
  if(interestRate<0||interestRate>100) warnings.push(`Interest rate ${interestRate}% is outside the accepted 0–100% range and must be corrected before applying.`);
  const annualPayroll=personnelRoles.reduce((sum,role)=>sum+((role.lowerSalary+role.upperSalary)/2)*(role.positions[1]??0),0);
  const enabled=projects.filter(project=>project.enabled);
  const yearOneRevenue=enabled.flatMap(project=>project.revenueDrivers??[]).reduce((sum,item)=>sum+(item.quantity??0)*(item.unitAmount??0)*(item.frequency==="monthly"?12:item.frequency==="quarterly"?4:1),0);
  const yearOneDirectCosts=enabled.flatMap(project=>project.costDrivers??[]).reduce((sum,item)=>sum+(item.quantity??0)*(item.unitAmount??0)*(item.frequency==="monthly"?12:item.frequency==="quarterly"?4:1),0);
  if(!yearOneRevenue) warnings.push("Imported enabled projects produce zero Year 1 revenue; review missing source cells before applying.");
  return {sourceName,layoutVersion:"EdTech fixed-layout v1",projects,personnelRoles,capex,debt,interestRate,annualPayroll,warnings,summary:{yearOneRevenue,yearOneDirectCosts,projectCount:projects.length,personnelCount:personnelRoles.length}};
}
