import pptxgen from "pptxgenjs";
import type { FinancialModelInputs } from "@/lib/financialModellingEngine";
import type { StatementYear } from "@/lib/phase1FinancialEngine";
import type { ModelProject, ProjectProjection } from "@/lib/projectPortfolioEngine";

export async function downloadFinancialModelPresentation(args: {
  company: string; industry: string; currency: string; inputs: FinancialModelInputs;
  statements: StatementYear[]; projects: ModelProject[]; projectRows: ProjectProjection[];
  uses: { name: string; value: number }[]; findings: { level: string; title: string; detail: string }[];
}) {
  const { company, industry, currency, inputs, statements, projects, projectRows, uses, findings } = args;
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "BOAT Financial Modelling Studio";
  pptx.subject = "Investor presentation";
  pptx.title = `${company} Investor Presentation`;
  pptx.company = company;
  pptx.theme = { headFontFace: "Aptos Display", bodyFontFace: "Aptos" };
  const C = { green: "047857", dark: "102B25", mint: "D1FAE5", pale: "F0FDF4", white: "FFFFFF", slate: "475569", red: "B91C1C" };
  const money = (value: number) => `${currency} ${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
  const addTitle = (slide: any, title: string, kicker: string) => {
    slide.addText(kicker.toUpperCase(), { x: .6, y: .35, w: 4.8, h: .25, fontFace: "Aptos", fontSize: 9, bold: true, color: C.green, charSpacing: 1.5 });
    slide.addText(title, { x: .6, y: .68, w: 11.9, h: .55, fontSize: 25, bold: true, color: C.dark, margin: 0 });
    slide.addShape(pptx.ShapeType.line, { x: .6, y: 1.35, w: 12.1, h: 0, line: { color: "DDE5E2", width: 1 } });
  };
  const addFooter = (slide: any, page: number) => slide.addText(`BOAT Financial Modelling Studio  |  ${company}  |  ${page}`, { x: .6, y: 7.12, w: 12.1, h: .18, fontSize: 7, color: "94A3B8", align: "right", margin: 0 });
  const addBullets = (slide: any, items: string[], y = 1.7) => slide.addText(items.map(text => ({ text, options: { bullet: { indent: 14 }, breakLine: true } })), { x: .8, y, w: 11.6, h: 4.8, fontSize: 18, color: C.slate, breakLine: false, valign: "top", paraSpaceAfter: 16, margin: .05 });

  let slide = pptx.addSlide(); slide.background = { color: C.dark };
  slide.addText("BOAT FINANCIAL MODELLING STUDIO", { x: .75, y: .7, w: 6, h: .3, fontSize: 11, bold: true, color: "6EE7B7", charSpacing: 2 });
  slide.addText(company || "Untitled financial model", { x: .75, y: 1.55, w: 11.5, h: 1.25, fontSize: 36, bold: true, color: C.white, margin: 0, breakLine: false });
  slide.addText(`${industry} investment opportunity`, { x: .78, y: 3.0, w: 8, h: .45, fontSize: 20, color: "D1FAE5", margin: 0 });
  slide.addText(`${inputs.years}-year financial outlook  |  ${currency}  |  ${new Date().toLocaleDateString()}`, { x: .78, y: 5.8, w: 8, h: .3, fontSize: 11, color: "A7F3D0", margin: 0 });

  const last = statements[statements.length - 1]!;
  slide = pptx.addSlide(); addTitle(slide, "Executive summary", "Investment case");
  const cards = [["Funding required", money(inputs.fundingRequired)], [`Year ${last.year} revenue`, money(last.revenue)], [`Year ${last.year} EBITDA`, money(last.ebitda)], ["DSCR", `${last.dscr.toFixed(2)}x`]];
  cards.forEach(([label, value], i) => { const x=.65+i*3.12; slide.addShape(pptx.ShapeType.roundRect,{x,y:1.75,w:2.82,h:1.35,rectRadius:.06,fill:{color:i===0?C.dark:C.pale},line:{color:i===0?C.dark:"BBE5D4"}}); slide.addText(label,{x:x+.2,y:1.98,w:2.4,h:.25,fontSize:10,bold:true,color:i===0?"A7F3D0":C.green,margin:0}); slide.addText(value,{x:x+.2,y:2.38,w:2.4,h:.42,fontSize:20,bold:true,color:i===0?C.white:C.dark,margin:0}); });
  addBullets(slide, [
    `${industry} model with ${inputs.years} linked projection years.`,
    `${projects.filter(p=>p.enabled&&p.name.trim()).length || 1} active business project or unit included in the consolidated case.`,
    `Financing assumes ${inputs.debtShare}% debt at ${inputs.interestRate}% over ${inputs.loanTerm} years.`,
    `All figures are management assumptions and should be confirmed during investor due diligence.`
  ], 3.55); addFooter(slide,2);

  slide = pptx.addSlide(); addTitle(slide, "Company overview and business model", "Business");
  addBullets(slide, [`Company: ${company}`, `Industry: ${industry}`, `Projection currency: ${currency}`, "Problem, solution, market size and competitive advantage: add management-approved narrative before external circulation."]);
  addFooter(slide,3);

  slide = pptx.addSlide(); addTitle(slide, "Revenue streams and project portfolio", "Commercial model");
  const active = projects.filter(p=>p.enabled&&p.name.trim());
  const portfolioRows = (active.length ? active : [{ id:"general",name:"General business model",businessType:industry,startYear:1 } as any]).map((project:any) => { const row=projectRows.find(r=>r.projectId===project.id&&r.year===last.year); return [{text:project.name,options:{bold:true}}, String(project.businessType).replaceAll("-"," "), `Year ${project.startYear}`, money(row?.revenue ?? (project.id==="general"?last.revenue:0)), money(row?.ebitda ?? (project.id==="general"?last.ebitda:0))]; });
  slide.addTable([["Project","Business type","Start",`Y${last.year} revenue`,`Y${last.year} EBITDA`],...portfolioRows] as any, { x:.65,y:1.7,w:12,h:4.8,border:{type:"solid",color:"DDE5E2",pt:1},fill:{color:C.white},color:C.slate,fontSize:11,margin:.08,rowH:.48,bold:false }); addFooter(slide,4);

  slide = pptx.addSlide(); addTitle(slide, "Financial projections", "Financial highlights");
  slide.addChart(pptx.ChartType.bar, [
    { name:"Revenue", labels:statements.map(r=>`Y${r.year}`), values:statements.map(r=>Math.round(r.revenue)) },
    { name:"EBITDA", labels:statements.map(r=>`Y${r.year}`), values:statements.map(r=>Math.round(r.ebitda)) }
  ], { x:.65,y:1.65,w:7.5,h:4.8,catAxisLabelFontSize:10,valAxisLabelFontSize:9,showLegend:true,legendPos:"b",showTitle:false,chartColors:[C.green,"6EE7B7"],showValue:false });
  slide.addText([`Closing cash: ${money(last.closingCash)}`,`Net profit: ${money(last.netProfit)}`,`EBITDA margin: ${(last.ebitdaMargin*100).toFixed(1)}%`,`Debt / EBITDA: ${last.debtToEbitda.toFixed(2)}x`,`Interest cover: ${last.interestCover.toFixed(2)}x`].map(t=>({text:t,options:{bullet:{indent:14},breakLine:true}})),{x:8.55,y:1.9,w:3.8,h:3.8,fontSize:15,color:C.slate,paraSpaceAfter:14,margin:.05}); addFooter(slide,5);

  slide = pptx.addSlide(); addTitle(slide, "Funding requirement and use of funds", "The ask");
  slide.addText(money(inputs.fundingRequired),{x:.7,y:1.65,w:4.4,h:.7,fontSize:30,bold:true,color:C.green,margin:0});
  slide.addText(`Requested funding | ${inputs.debtShare}% debt and ${100-inputs.debtShare}% equity/other funding`,{x:.72,y:2.42,w:6.5,h:.35,fontSize:13,color:C.slate,margin:0});
  slide.addChart(pptx.ChartType.doughnut,[{name:"Use of funds",labels:uses.map(u=>u.name),values:uses.map(u=>u.value)}],{x:6.7,y:1.55,w:5.2,h:4.8,showLegend:true,legendPos:"r",showTitle:false,showPercent:true,holeSize:58,chartColors:[C.green,"10B981","34D399","6EE7B7","A7F3D0","D1FAE5"]}); addFooter(slide,6);

  slide = pptx.addSlide(); addTitle(slide, "Debt service capacity", "Lender analysis");
  slide.addTable([["Metric",...statements.map(r=>`Y${r.year}`)],["DSCR",...statements.map(r=>`${r.dscr.toFixed(2)}x`)],["Interest cover",...statements.map(r=>`${r.interestCover.toFixed(2)}x`)],["Current ratio",...statements.map(r=>`${r.currentRatio.toFixed(2)}x`)],["Debt / EBITDA",...statements.map(r=>`${r.debtToEbitda.toFixed(2)}x`)]] as any,{x:.65,y:1.75,w:12,h:3.1,border:{type:"solid",color:"DDE5E2",pt:1},fontSize:13,color:C.slate,margin:.08});
  slide.addText("A DSCR below 1.20x should be reviewed with the proposed lender and may require lower debt, a longer tenor, or revised operating assumptions.",{x:.8,y:5.35,w:11.5,h:.55,fontSize:14,color:C.slate,italic:true,margin:0}); addFooter(slide,7);

  slide = pptx.addSlide(); addTitle(slide, "Key risks and mitigations", "Risk analysis");
  const riskRows = findings.map(f=>[f.level.toUpperCase(),f.title,f.detail]);
  slide.addTable([["Rating","Risk / check","Management response required"],...riskRows] as any,{x:.65,y:1.65,w:12,h:4.9,border:{type:"solid",color:"DDE5E2",pt:1},fontSize:11,color:C.slate,margin:.08,fill:{color:C.white}}); addFooter(slide,8);

  slide = pptx.addSlide(); slide.background={color:C.dark};
  slide.addText("Investment opportunity",{x:.8,y:1.15,w:8,h:.55,fontSize:30,bold:true,color:C.white,margin:0});
  slide.addText(`${company} is seeking ${money(inputs.fundingRequired)} to execute the modelled growth plan.`,{x:.8,y:2.2,w:10.8,h:.75,fontSize:22,color:"D1FAE5",margin:0});
  slide.addText("Next steps",{x:.8,y:3.55,w:3,h:.35,fontSize:14,bold:true,color:"6EE7B7",margin:0});
  slide.addText("Confirm commercial assumptions  |  Complete due diligence  |  Agree financing terms",{x:.8,y:4.05,w:11,h:.4,fontSize:17,color:C.white,margin:0});
  slide.addText("Management should add approved market, product, team, intellectual property and expansion narrative before sharing externally.",{x:.8,y:5.65,w:11,h:.45,fontSize:11,color:"A7F3D0",italic:true,margin:0});

  await pptx.writeFile({ fileName: `${company.replace(/\W+/g,"-").toLowerCase() || "boat"}-investor-presentation.pptx` });
}
