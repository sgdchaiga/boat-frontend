import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Link2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { normalizeGlAccountRows } from "@/lib/glAccountNormalize";
import { buildModelBudgetLines, suggestBudgetGlAccount, type BudgetGlAccount, type ModelBudgetLine } from "@/lib/modelBudgetBridge";
import type { StatementYear } from "@/lib/phase1FinancialEngine";
import type { ProjectionYear, ModelScenario } from "@/lib/financialModellingEngine";
import type { ProjectProjection } from "@/lib/projectPortfolioEngine";

interface Props {
  organizationId?: string;
  company: string;
  scenario: ModelScenario;
  forecastStartYear: number;
  statements: StatementYear[];
  projections: ProjectionYear[];
  projectRows: ProjectProjection[];
  currency: string;
  money: (value: number, compact?: boolean) => string;
}

export function AdoptModelAsBudget({ organizationId, company, scenario, forecastStartYear, statements, projections, projectRows, currency, money }: Props) {
  const [modelYear, setModelYear] = useState(1);
  const [accounts, setAccounts] = useState<BudgetGlAccount[]>([]);
  const [lines, setLines] = useState<ModelBudgetLine[]>([]);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const statement = statements[modelYear - 1];
  const calendarYear = forecastStartYear + modelYear - 1;
  const generatedLines = useMemo(() => statement ? buildModelBudgetLines(statement, projectRows, projections[modelYear - 1]?.capexPurchases ?? 0) : [], [modelYear, projectRows, projections, statement]);

  useEffect(() => {
    let active = true;
    void supabase.from("gl_accounts").select("*").order("account_code").then(({ data }) => {
      if (!active) return;
      const normalized = normalizeGlAccountRows((data || []) as unknown[]).filter(row => row.is_active);
      setAccounts(normalized.map(row => ({ id: row.id, account_code: row.account_code, account_name: row.account_name, account_type: row.account_type })));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setLines(generatedLines.map(line => ({ ...line, glAccountId: suggestBudgetGlAccount(line, accounts) })));
    setMessage("");
  }, [accounts, generatedLines]);

  const income = lines.filter(line => line.kind === "income").reduce((sum, line) => sum + line.amount, 0);
  const expenditure = lines.filter(line => line.kind !== "income").reduce((sum, line) => sum + line.amount, 0);
  const unmapped = lines.filter(line => !line.glAccountId).length;

  const createDraftBudget = async () => {
    if (!organizationId || !statement || !lines.length || creating) return;
    setCreating(true);
    setMessage("");
    const budgetResult = await supabase.from("budgets").insert({
      organization_id: organizationId,
      name: `${company.trim() || "Financial model"} — ${calendarYear} ${scenario} case`,
      period_label: `${calendarYear} annual operating plan`,
      start_date: `${calendarYear}-01-01`,
      end_date: `${calendarYear}-12-31`,
      notes: `Draft generated from BOAT Financial Modelling, model year ${modelYear}, ${scenario} scenario. Review GL mappings and amounts before activation.`,
      is_active: false,
    }).select("id").single();
    if (budgetResult.error || !budgetResult.data) {
      setMessage(budgetResult.error?.message || "The draft budget could not be created.");
      setCreating(false);
      return;
    }
    const budgetId = budgetResult.data.id;
    const lineResult = await supabase.from("budget_lines").insert(lines.map((line, index) => ({
      budget_id: budgetId,
      gl_account_id: line.glAccountId,
      line_label: line.label,
      amount: line.amount,
      sort_order: index,
      unit: "annual total",
      frequency: "annual",
      quantity: 1,
      unit_price: line.amount,
      notes: `Generated from model year ${modelYear}; ${line.kind} line.`,
    })));
    if (lineResult.error) {
      await supabase.from("budgets").delete().eq("id", budgetId);
      setMessage(lineResult.error.message);
    } else {
      setMessage(`Draft budget created for ${calendarYear}. Open BOAT Budgeting to review and activate it.`);
    }
    setCreating(false);
  };

  return <section className="mt-6 overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm">
    <div className="flex flex-col justify-between gap-4 border-b border-indigo-100 bg-indigo-50 p-5 lg:flex-row lg:items-center">
      <div><p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Model-to-budget bridge</p><h3 className="mt-1 text-xl font-bold">Adopt the forecast as a BOAT budget</h3><p className="mt-1 text-sm text-slate-600">Creates an inactive draft. Budget controls do not use it until it is reviewed and activated in Budgeting.</p></div>
      <div className="flex items-center gap-2"><select value={modelYear} onChange={event => setModelYear(Number(event.target.value))} className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm">{statements.map(row => <option key={row.year} value={row.year}>Model Y{row.year} · {forecastStartYear + row.year - 1}</option>)}</select><span className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold capitalize text-white">{scenario} case</span></div>
    </div>
    <div className="grid gap-3 border-b border-slate-100 p-5 sm:grid-cols-3"><div><p className="text-xs font-bold uppercase text-slate-400">Budget income</p><p className="mt-1 text-lg font-bold text-emerald-700">{money(income)}</p></div><div><p className="text-xs font-bold uppercase text-slate-400">Expenditure + capex</p><p className="mt-1 text-lg font-bold">{money(expenditure)}</p></div><div><p className="text-xs font-bold uppercase text-slate-400">GL mapping</p><p className={`mt-1 text-lg font-bold ${unmapped ? "text-amber-700" : "text-emerald-700"}`}>{lines.length - unmapped}/{lines.length} mapped</p></div></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Budget line</th><th className="p-3 text-left">Type</th><th className="p-3 text-right">Annual amount ({currency})</th><th className="p-3 text-left">BOAT GL account</th></tr></thead><tbody>{lines.map(line => <tr key={line.key} className="border-t border-slate-100"><td className="p-3 font-semibold">{line.label}</td><td className="p-3 capitalize text-slate-500">{line.kind}</td><td className="p-3 text-right font-semibold">{line.amount.toLocaleString()}</td><td className="p-3"><select value={line.glAccountId ?? ""} onChange={event => setLines(current => current.map(item => item.key === line.key ? { ...item, glAccountId: event.target.value || null } : item))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"><option value="">Leave unmapped for review</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.account_code} — {account.account_name}</option>)}</select></td></tr>)}</tbody></table></div>
    <div className="flex flex-col justify-between gap-3 border-t border-slate-100 p-5 sm:flex-row sm:items-center"><div className="flex items-start gap-2 text-xs text-slate-500"><Link2 size={15} className="mt-0.5 shrink-0"/><span>Unmapped lines are allowed in the draft, but should be linked before activation for accurate budget-versus-actual reporting.</span></div><button type="button" disabled={!organizationId || creating || !lines.length} onClick={() => void createDraftBudget()} className="flex shrink-0 items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{message.startsWith("Draft budget created") ? <CheckCircle2 size={17}/> : <ArrowRight size={17}/>} {creating ? "Creating..." : "Create draft budget"}</button></div>
    {message && <p className={`border-t px-5 py-3 text-sm font-semibold ${message.startsWith("Draft budget created") ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-red-100 bg-red-50 text-red-700"}`}>{message}</p>}
  </section>;
}
