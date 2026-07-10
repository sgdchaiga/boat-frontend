import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet, FileText, Printer, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { filterByOrganizationId, filterJournalLinesByOrganizationId } from "@/lib/supabaseOrgFilter";
import { downloadXlsx, exportAccountingPdf } from "@/lib/accountingReportExport";

type Totals = Record<string, number>;
const money = new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 });
const readNumber = (value: unknown) => Number(String(value ?? "").replace(/[^0-9.-]/g, "")) || 0;

export function SaccoAnnualAccountsPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [name, setName] = useState("SACCO Limited");
  const [period, setPeriod] = useState(String(new Date().getFullYear() - 1));
  const [board, setBoard] = useState("");
  const [committees, setCommittees] = useState("");
  const [totals, setTotals] = useState<Totals>({});
  const [source, setSource] = useState("Enter figures, upload a CSV/XLSX trial balance, or pull posted BOAT balances.");
  const rows = useMemo(() => Object.entries(totals).filter(([, amount]) => amount !== 0), [totals]);
  const balance = (terms: string[]) => rows.filter(([key]) => terms.some((t) => key.toLowerCase().includes(t))).reduce((sum, [, amount]) => sum + amount, 0);
  const assets = balance(["cash", "bank", "loan", "receivable", "prepayment", "stock", "property", "equipment"]);
  const liabilities = balance(["deposit", "payable", "accrual", "loan payable"]);
  const income = balance(["interest income", "fee", "commission", "other income"]);
  const expenses = balance(["expense", "wage", "salary", "provision", "interest expense"]);

  const importFile = async (file: File | null) => {
    if (!file) return;
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) { setSource(`${file.name} attached as supporting evidence. Upload CSV/XLSX to populate figures automatically.`); return; }
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    const next: Totals = {};
    for (const row of data) { const label = String(row.account_name ?? row.name ?? row.account ?? row.description ?? "").trim(); const amount = readNumber(row.balance ?? row.amount ?? row.total ?? row.closing_balance); if (label) next[label] = amount; }
    setTotals(next); setSource(`Imported ${Object.keys(next).length} balances from ${file.name}.`);
  };
  const pullBoat = async () => {
    if (!orgId) return;
    const [accountsRes, linesRes] = await Promise.all([
      filterByOrganizationId(supabase.from("gl_accounts").select("id,account_name,account_type").eq("is_active", true), orgId, superAdmin),
      filterJournalLinesByOrganizationId(supabase.from("journal_entry_lines").select("gl_account_id,debit,credit,journal_entries!inner(is_posted,is_deleted,entry_date)").eq("journal_entries.is_posted", true).eq("journal_entries.is_deleted", false).gte("journal_entries.entry_date", `${period}-01-01`).lte("journal_entries.entry_date", `${period}-12-31`), orgId, superAdmin),
    ]);
    if (accountsRes.error || linesRes.error) { setSource(accountsRes.error?.message || linesRes.error?.message || "Could not load BOAT balances."); return; }
    const accounts = new Map<string, { account_name: string; account_type: string }>((accountsRes.data || []).map((a: any) => [a.id, a])); const next: Totals = {};
    for (const line of (linesRes.data || []) as any[]) { const a = accounts.get(line.gl_account_id); if (!a) continue; const delta = ["asset", "expense"].includes(a.account_type) ? readNumber(line.debit) - readNumber(line.credit) : readNumber(line.credit) - readNumber(line.debit); next[a.account_name] = (next[a.account_name] || 0) + delta; }
    setTotals(next); setSource(`Loaded ${Object.keys(next).length} posted BOAT account balances for ${period}.`);
  };
  const fileStem = `sacco-annual-accounts-${period}-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "report"}`;
  const statementRows: [string, number][] = [["Assets", assets], ["Liabilities", liabilities], ["Net assets / (liabilities)", assets - liabilities]];
  const incomeRows: [string, number][] = [["Total income", income], ["Total expenditure", expenses], ["Surplus / (deficit) for the year", income - expenses]];
  const exportExcel = () => downloadXlsx(fileStem, [["Annual Report and Financial Statements"], [`For the year ended 31 December ${period}`], [], ["Statement of financial position"], ["Description", "Amount (UShs)"], ...statementRows, [], ["Statement of comprehensive income"], ["Description", "Amount (UShs)"], ...incomeRows, [], ["Supporting account balances"], ["Account", "Amount (UShs)"], ...rows], { companyName: name, sheetName: "Annual Accounts" });
  const exportPdf = () => exportAccountingPdf({ title: "Annual Report and Financial Statements", subtitle: `For the year ended 31 December ${period}`, filename: fileStem, companyName: name, sections: [{ title: "Statement of financial position", head: ["Description", "Amount (UShs)"], body: statementRows.map(([label, amount]) => [label, money.format(amount)]) }, { title: "Statement of comprehensive income", head: ["Description", "Amount (UShs)"], body: incomeRows.map(([label, amount]) => [label, money.format(amount)]) }, { title: "Supporting account balances", head: ["Account", "Amount (UShs)"], body: rows.map(([label, amount]) => [label, money.format(amount)]) }], footerLines: ["Board of Directors", board || "To be completed", "Committees / SUPCO", committees || "To be completed", "Complete accounting policies, prior-year comparatives, audit report and statutory appropriations before issue."] });
  const print = () => window.print();
  return <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 print:p-0">
    <div className="flex flex-wrap justify-end gap-2 print:hidden">
      <button type="button" className="app-btn-secondary" onClick={exportExcel}><Download className="h-4 w-4" />Export Excel</button>
      <button type="button" className="app-btn-secondary" onClick={exportPdf}><FileText className="h-4 w-4" />Export PDF</button>
    </div>
    <div className="print:hidden"><h1 className="flex items-center gap-2 text-2xl font-bold"><Sparkles className="text-emerald-600"/>Annual accounts generator</h1><p className="mt-1 text-sm text-slate-600">Uses the supplied SACCO annual-report layout. Review all figures and narrative before board approval or audit.</p></div>
    <section className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-2 print:hidden"><input className="rounded border p-2" value={name} onChange={e=>setName(e.target.value)} placeholder="SACCO / company name"/><input className="rounded border p-2" value={period} onChange={e=>setPeriod(e.target.value)} placeholder="Financial year"/><textarea className="rounded border p-2" value={board} onChange={e=>setBoard(e.target.value)} placeholder="Board members (one per line: Name — Title)"/><textarea className="rounded border p-2" value={committees} onChange={e=>setCommittees(e.target.value)} placeholder="Committees / SUPCO (one per line)"/><div className="flex flex-wrap gap-2 md:col-span-2"><button className="app-btn-primary" onClick={()=>void pullBoat}>Pull posted BOAT figures</button><label className="app-btn-secondary cursor-pointer"><FileSpreadsheet className="h-4 w-4"/>Upload CSV / Excel / PDF<input className="hidden" type="file" accept=".csv,.xls,.xlsx,.pdf" onChange={e=>void importFile(e.target.files?.[0] || null)}/></label><button className="app-btn-secondary" onClick={print}><Printer className="h-4 w-4"/>Print / Save PDF</button></div><p className="text-sm text-slate-600 md:col-span-2">{source}</p></section>
    <article className="bg-white p-8 print:p-4"><header className="border-b pb-6 text-center"><h2 className="text-3xl font-bold">{name}</h2><p className="mt-2 text-lg">Annual Report and Financial Statements</p><p>For the year ended 31 December {period}</p></header><h3 className="mt-8 text-xl font-bold">SACCO information and governance</h3><p className="mt-2 whitespace-pre-line text-sm">Board of Directors\n{board || "To be completed"}\n\nCommittees / SUPCO\n{committees || "To be completed"}</p><h3 className="mt-8 text-xl font-bold">Statement of financial position</h3><table className="mt-2 w-full text-sm"><tbody><tr><td>Assets</td><td className="text-right">UShs {money.format(assets)}</td></tr><tr><td>Liabilities</td><td className="text-right">UShs {money.format(liabilities)}</td></tr><tr className="border-t font-bold"><td>Net assets / (liabilities)</td><td className="text-right">UShs {money.format(assets-liabilities)}</td></tr></tbody></table><h3 className="mt-8 text-xl font-bold">Statement of comprehensive income</h3><table className="mt-2 w-full text-sm"><tbody><tr><td>Total income</td><td className="text-right">UShs {money.format(income)}</td></tr><tr><td>Total expenditure</td><td className="text-right">UShs {money.format(expenses)}</td></tr><tr className="border-t font-bold"><td>Surplus / (deficit) for the year</td><td className="text-right">UShs {money.format(income-expenses)}</td></tr></tbody></table><h3 className="mt-8 text-xl font-bold">Notes and supporting schedules</h3><p className="text-sm">The following imported or BOAT-sourced account balances support the statements. Complete accounting policies, prior-year comparatives, audit report and statutory appropriations before issue.</p><table className="mt-2 w-full text-sm"><tbody>{rows.map(([label,value])=><tr key={label}><td>{label}</td><td className="text-right">{money.format(value)}</td></tr>)}</tbody></table></article>
  </div>;
}

export default SaccoAnnualAccountsPage;
