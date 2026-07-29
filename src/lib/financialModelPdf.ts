import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { FinancialModelInputs } from "@/lib/financialModellingEngine";
import type { LoanScheduleYear, StatementYear } from "@/lib/phase1FinancialEngine";
import type { ModelProject, ProjectProjection } from "@/lib/projectPortfolioEngine";

type ReadinessFinding = { level: "critical" | "warning" | "good"; title: string; detail: string };

export function downloadFinancialModelPdf(args: {
  company: string; industry: string; currency: string; inputs: FinancialModelInputs;
  statements: StatementYear[]; loan: LoanScheduleYear[]; projects: ModelProject[];
  projectRows: ProjectProjection[]; findings: ReadinessFinding[];
}) {
  const { company, industry, currency, inputs, statements, loan, projects, projectRows, findings } = args;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const green: [number, number, number] = [4, 120, 87];
  const dark: [number, number, number] = [15, 41, 35];
  const money = (value: number) => `${currency} ${Math.round(value).toLocaleString("en-US")}`;
  const compact = (value: number) => `${currency} ${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
  const table = (head: string[][], body: (string | number)[][], options: Record<string, unknown> = {}) => autoTable(doc, {
    head, body, theme: "grid", margin: { left: 14, right: 14 },
    headStyles: { fillColor: dark, textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 7.5, cellPadding: 2.1, overflow: "linebreak" }, ...options,
  });
  const y = () => ((doc as any).lastAutoTable?.finalY ?? 32) + 7;
  const heading = (title: string, top = y()) => { doc.setTextColor(...dark); doc.setFontSize(13); doc.setFont("helvetica", "bold"); doc.text(title, 14, top); return top + 3; };

  doc.setFillColor(...dark); doc.rect(0, 0, 210, 64, "F");
  doc.setTextColor(110, 231, 183); doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.text("BOAT FINANCIAL MODELLING STUDIO", 14, 18);
  doc.setTextColor(255, 255, 255); doc.setFontSize(24); doc.text(company || "Untitled financial model", 14, 33, { maxWidth: 175 });
  doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text(`${industry} | Investor readiness report | ${currency}`, 14, 51);
  doc.setTextColor(90, 100, 110); doc.setFontSize(8); doc.text(`Generated ${new Date().toLocaleDateString()} | Projection period: ${inputs.years} years`, 14, 73);

  const last = statements[statements.length - 1]!;
  heading("Investment case snapshot", 84);
  table([["Funding required", `Year ${last.year} revenue`, `Year ${last.year} EBITDA`, "Closing cash", "DSCR"]], [[money(inputs.fundingRequired), compact(last.revenue), compact(last.ebitda), compact(last.closingCash), `${last.dscr.toFixed(2)}x`]], { startY: 88 });

  heading("Core assumptions");
  table([["Assumption", "Value", "Assumption", "Value"]], [
    ["Debt share", `${inputs.debtShare}%`, "Interest rate", `${inputs.interestRate}%`],
    ["Loan term", `${inputs.loanTerm} years`, "Repayment", (inputs.repaymentMethod ?? "equal-principal").replaceAll("-", " ")],
    ["Principal grace", `${inputs.gracePeriod ?? 0} years`, "Tax rate", `${inputs.taxRate}%`],
    ["Receivable days", inputs.receivableDays, "Payable days", inputs.payableDays],
  ]);

  const activeProjects = projects.filter(project => project.enabled && project.name.trim());
  heading("Project portfolio");
  table([["Project", "Business type", "Start", `Y${last.year} revenue`, `Y${last.year} EBITDA`, "Status"]], activeProjects.length ? activeProjects.map(project => {
    const row = projectRows.find(item => item.projectId === project.id && item.year === last.year);
    return [project.name, project.businessType.replaceAll("-", " "), `Year ${project.startYear}`, compact(row?.revenue ?? 0), compact(row?.ebitda ?? 0), "Included"];
  }) : [["General business model", industry, "Year 1", compact(last.revenue), compact(last.ebitda), "Included"]]);

  doc.addPage();
  doc.setTextColor(...green); doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.text("LINKED FINANCIAL STATEMENTS", 14, 16);
  heading("Income statement", 25);
  const years = statements.map(row => `Y${row.year}`);
  const statementRows: [string, keyof StatementYear][] = [["Revenue","revenue"],["Cost of sales","costOfSales"],["Gross profit","grossProfit"],["Operating expenses","operatingExpenses"],["EBITDA","ebitda"],["Depreciation","depreciation"],["EBIT","ebit"],["Interest","interest"],["Tax","tax"],["Net profit","netProfit"]];
  table([[`Metric (${currency})`, ...years]], statementRows.map(([label, key]) => [label, ...statements.map(row => compact(Number(row[key])))]), { startY: 29 });
  heading("Balance sheet");
  const balanceRows: [string, keyof StatementYear][] = [["Cash","cash"],["Receivables","receivables"],["Net PPE","netPpe"],["Total assets","totalAssets"],["Payables","payables"],["Debt","debt"],["Equity","equity"],["Balance check","balanceCheck"]];
  table([[`Metric (${currency})`, ...years]], balanceRows.map(([label, key]) => [label, ...statements.map(row => compact(Number(row[key])))]));
  heading("Cash flow and lender ratios");
  const cashRows: [string, keyof StatementYear][] = [["Operating cash flow","operatingCashFlow"],["Investing cash flow","investingCashFlow"],["Financing cash flow","financingCashFlow"],["Closing cash","closingCash"]];
  table([[`Metric (${currency})`, ...years]], [
    ...cashRows.map(([label, key]) => [label, ...statements.map(row => compact(Number(row[key])))]),
    ["Current ratio", ...statements.map(row => `${row.currentRatio.toFixed(2)}x`)],
    ["Interest cover", ...statements.map(row => `${row.interestCover.toFixed(2)}x`)],
    ["DSCR", ...statements.map(row => `${row.dscr.toFixed(2)}x`)],
  ]);

  doc.addPage();
  doc.setTextColor(...green); doc.setFontSize(9); doc.text("FINANCING AND READINESS", 14, 16);
  heading("Annual debt schedule", 25);
  table([["Year", "Opening", "Principal", "Interest", "Debt service", "Closing"]], loan.map(row => [row.year, compact(row.openingBalance), compact(row.principal), compact(row.interest), compact(row.debtService), compact(row.closingBalance)]), { startY: 29 });
  heading("Readiness findings");
  table([["Rating", "Finding", "Interpretation"]], findings.map(item => [item.level.toUpperCase(), item.title, item.detail]));
  doc.setFontSize(7.5); doc.setTextColor(100, 110, 120); doc.setFont("helvetica", "normal");
  doc.text("This report is generated from user assumptions and is intended for planning and investor discussion. Validate tax, accounting and lending terms with qualified advisers before reliance.", 14, Math.min(285, y() + 4), { maxWidth: 180 });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page); doc.setFontSize(7); doc.setTextColor(135, 145, 150);
    doc.text(`BOAT Financial Modelling Studio | ${company}`, 14, 292); doc.text(`Page ${page} of ${pages}`, 188, 292, { align: "right" });
  }
  doc.save(`${company.replace(/\W+/g, "-").toLowerCase() || "boat"}-investor-readiness.pdf`);
}
