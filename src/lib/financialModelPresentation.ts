import type { FinancialModelInputs } from "@/lib/financialModellingEngine";
import type { StatementYear } from "@/lib/phase1FinancialEngine";
import type { ModelProject, ProjectProjection } from "@/lib/projectPortfolioEngine";

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char] || char));

/**
 * Export a PowerPoint-compatible HTML presentation without a native image parser.
 * Microsoft PowerPoint opens the generated .ppt document as a multi-page outline.
 */
export async function downloadFinancialModelPresentation(args: {
  company: string; industry: string; currency: string; inputs: FinancialModelInputs;
  statements: StatementYear[]; projects: ModelProject[]; projectRows: ProjectProjection[];
  uses: { name: string; value: number }[]; findings: { level: string; title: string; detail: string }[];
}) {
  const { company, industry, currency, inputs, statements, projects, projectRows, uses, findings } = args;
  const last = statements[statements.length - 1];
  const money = (value: number) => `${esc(currency)} ${Number(value || 0).toLocaleString()}`;
  const table = (headers: string[], rows: unknown[][]) => `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const sections = [
    `<section class="cover"><p>BOAT FINANCIAL MODELLING STUDIO</p><h1>${esc(company || "Untitled financial model")}</h1><h2>${esc(industry)} investment opportunity</h2><p>${inputs.years}-year outlook · ${esc(currency)}</p></section>`,
    `<section><h1>Executive summary</h1>${table(["Funding required", `Year ${last?.year || "-"} revenue`, `Year ${last?.year || "-"} EBITDA`, "DSCR"], [[money(inputs.fundingRequired), money(last?.revenue || 0), money(last?.ebitda || 0), `${Number(last?.dscr || 0).toFixed(2)}x`]])}</section>`,
    `<section><h1>Financial projections</h1>${table(["Year","Revenue","EBITDA","Net profit","Closing cash","DSCR"], statements.map((row) => [row.year,money(row.revenue),money(row.ebitda),money(row.netProfit),money(row.closingCash),`${row.dscr.toFixed(2)}x`]))}</section>`,
    `<section><h1>Project portfolio</h1>${table(["Project","Business type","Start year","Final-year revenue","Final-year EBITDA"], projects.filter((p) => p.enabled).map((project) => { const row=projectRows.find((item) => item.projectId===project.id && item.year===last?.year); return [project.name,project.businessType,project.startYear,money(row?.revenue || 0),money(row?.ebitda || 0)]; }))}</section>`,
    `<section><h1>Funding and use of funds</h1><h2>${money(inputs.fundingRequired)}</h2>${table(["Use","Amount"], uses.map((item) => [item.name,money(item.value)]))}</section>`,
    `<section><h1>Key risks and mitigations</h1>${table(["Rating","Risk / check","Management response required"], findings.map((item) => [item.level.toUpperCase(),item.title,item.detail]))}</section>`,
  ];
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:13.333in 7.5in;margin:.55in}body{font-family:Arial;color:#102b25;margin:0}section{page-break-after:always;min-height:6.2in;padding:.2in}.cover{background:#102b25;color:white;padding:.8in}h1{font-size:28pt}h2{color:#047857}table{border-collapse:collapse;width:100%;font-size:12pt}th,td{border:1px solid #cbd5e1;padding:9px;text-align:left}th{background:#d1fae5;color:#047857}</style></head><body>${sections.join("")}</body></html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-powerpoint;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${company.replace(/\W+/g,"-").toLowerCase() || "boat"}-investor-presentation.ppt`;
  anchor.click();
  URL.revokeObjectURL(url);
}
