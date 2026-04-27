import { useCallback, useEffect, useMemo, useState } from "react";
import { PieChart } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { normalizeGlAccountRows } from "@/lib/glAccountNormalize";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { budgetPeriodRange, budgetVariance } from "@/lib/budgetActuals";
import { fetchJournalActualsByGlIds } from "@/lib/budgetVarianceReport";

type BudgetRow = {
  id: string;
  name: string;
  period_label: string | null;
  start_date: string | null;
  end_date: string | null;
};

type LineRow = {
  id: string;
  gl_account_id: string | null;
  line_label: string;
  amount: number;
  gl_accounts?: { account_code: string; account_name: string } | null;
};

type GLPick = { id: string; account_code: string; account_name: string; account_type: string };

/** Bar showing how much of the budget line was "used" (actual vs budget). */
function BudgetUseBar({ pct, overBudget }: { pct: number; overBudget: boolean }) {
  const w = Math.min(100, Math.max(0, pct));
  return (
    <div className="w-full min-w-[120px]">
      <div className="h-2.5 rounded-full bg-slate-200 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${overBudget ? "bg-red-500" : "bg-emerald-600"}`}
          style={{ width: `${w}%` }}
        />
      </div>
      <p className="text-[10px] text-slate-500 mt-0.5 tabular-nums">{pct.toFixed(0)}% of budget</p>
    </div>
  );
}

export function BudgetVarianceReportPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [accounts, setAccounts] = useState<GLPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [linesLoading, setLinesLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [actualByGlId, setActualByGlId] = useState<Map<string, number>>(new Map());
  const [actualsLoading, setActualsLoading] = useState(false);

  const loadBudgets = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("budgets")
      .select("id,name,period_label,start_date,end_date")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });
    setErr(error?.message ?? null);
    setBudgets((data as BudgetRow[]) || []);
    setLoading(false);
  }, [orgId]);

  const loadAccounts = useCallback(async () => {
    const { data } = await supabase
      .from("gl_accounts")
      .select("*")
      .order("account_code");
    const normalized = normalizeGlAccountRows((data || []) as unknown[]).filter((row) => row.is_active);
    setAccounts(normalized as GLPick[]);
  }, []);

  const accountTypeById = useMemo(() => new Map(accounts.map((a) => [a.id, a.account_type])), [accounts]);

  const loadLines = useCallback(async (budgetId: string) => {
    setLinesLoading(true);
    const { data, error } = await supabase
      .from("budget_lines")
      .select("id,gl_account_id,line_label,amount,gl_accounts(account_code,account_name)")
      .eq("budget_id", budgetId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    setErr(error?.message ?? null);
    setLines((data as LineRow[]) || []);
    setLinesLoading(false);
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    loadBudgets();
  }, [loadBudgets]);

  useEffect(() => {
    if (selectedId) loadLines(selectedId);
    else setLines([]);
  }, [selectedId, loadLines]);

  const selectedBudget = useMemo(() => budgets.find((b) => b.id === selectedId), [budgets, selectedId]);

  const lineTotal = useMemo(() => lines.reduce((s, l) => s + Number(l.amount ?? 0), 0), [lines]);

  const budgetSumByGl = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) {
      if (!l.gl_account_id) continue;
      const g = l.gl_account_id;
      m.set(g, (m.get(g) || 0) + Number(l.amount ?? 0));
    }
    return m;
  }, [lines]);

  const lineActualDisplay = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) {
      if (!l.gl_account_id) {
        m.set(l.id, 0);
        continue;
      }
      const total = actualByGlId.get(l.gl_account_id) ?? 0;
      const share = budgetSumByGl.get(l.gl_account_id) ?? 0;
      const amt = Number(l.amount ?? 0);
      if (share <= 0) {
        m.set(l.id, 0);
        continue;
      }
      m.set(l.id, (amt / share) * total);
    }
    return m;
  }, [lines, actualByGlId, budgetSumByGl]);

  const lineVariance = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) {
      if (!l.gl_account_id) {
        m.set(l.id, 0);
        continue;
      }
      const at = accountTypeById.get(l.gl_account_id) || "expense";
      const bud = Number(l.amount ?? 0);
      const act = lineActualDisplay.get(l.id) ?? 0;
      m.set(l.id, budgetVariance(bud, act, at));
    }
    return m;
  }, [lines, lineActualDisplay, accountTypeById]);

  const loadActuals = useCallback(async () => {
    if (!orgId || !selectedBudget || lines.length === 0) {
      setActualByGlId(new Map());
      return;
    }
    const glIds = [...new Set(lines.map((l) => l.gl_account_id).filter(Boolean))] as string[];
    if (glIds.length === 0) {
      setActualByGlId(new Map());
      return;
    }
    setActualsLoading(true);
    const { from: fromStr, to: toStr } = budgetPeriodRange(selectedBudget);
    try {
      const totals = await fetchJournalActualsByGlIds(supabase, orgId, fromStr, toStr, glIds, accountTypeById);
      setActualByGlId(totals);
    } catch (e) {
      console.error("Budget variance actuals:", e);
      setActualByGlId(new Map());
    } finally {
      setActualsLoading(false);
    }
  }, [orgId, selectedBudget, lines, accountTypeById]);

  useEffect(() => {
    if (linesLoading || !selectedBudget) return;
    loadActuals();
  }, [lines, linesLoading, selectedBudget, loadActuals]);

  const sumActualDisplay = useMemo(
    () => [...lineActualDisplay.values()].reduce((a, b) => a + b, 0),
    [lineActualDisplay]
  );
  const sumVariance = useMemo(() => [...lineVariance.values()].reduce((a, b) => a + b, 0), [lineVariance]);

  const periodHint = useMemo(() => {
    if (!selectedBudget) return "";
    const { from, to } = budgetPeriodRange(selectedBudget);
    return `${from} → ${to}`;
  }, [selectedBudget]);

  const donutPct = useMemo(() => {
    if (lineTotal <= 0) return null;
    const used = Math.min(100, Math.max(0, (sumActualDisplay / lineTotal) * 100));
    return used;
  }, [lineTotal, sumActualDisplay]);

  if (!orgId) {
    return (
      <div className="p-6 md:p-8 max-w-4xl mx-auto">
        <p className="text-slate-600">Select an organization to run this report.</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Budget variance analysis</h1>
        <PageNotes ariaLabel="Budget variance">
          <p>
            Compares each budget line (with a GL account) to net journal activity for the budget period. Actual is split proportionally when several lines share
            an account. The bar shows <strong>% of budget</strong> consumed by actuals (expense: higher use = more spent; income lines are interpreted against
            budget the same way).
          </p>
        </PageNotes>
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}

      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap gap-4 items-end">
        <div className="min-w-[220px] flex-1">
          <label className="block text-xs font-medium text-slate-600 mb-1">Budget</label>
          <select
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value || null)}
          >
            <option value="">Select a budget…</option>
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.period_label ? ` (${b.period_label})` : ""}
              </option>
            ))}
          </select>
        </div>
        {selectedBudget && periodHint && (
          <p className="text-sm text-slate-600">
            GL period: <span className="font-medium"> {periodHint}</span>
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-slate-500">Loading budgets…</p>
      ) : !selectedId ? (
        <p className="text-slate-500">Choose a budget to view variance.</p>
      ) : linesLoading ? (
        <p className="text-slate-500">Loading lines…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Total budget</p>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">{lineTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Total actual (GL)</p>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">
                {actualsLoading ? "…" : sumActualDisplay.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Net variance</p>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">
                {actualsLoading ? "…" : sumVariance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 text-indigo-700">
                <PieChart className="w-7 h-7" />
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide">Budget used (overall)</p>
                <p className="text-2xl font-bold text-slate-900 tabular-nums">
                  {donutPct == null ? "—" : `${donutPct.toFixed(1)}%`}
                </p>
                <div className="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden max-w-[200px]">
                  <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${donutPct ?? 0}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700">Budget used by line</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[880px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80">
                    <th className="text-left p-2 font-semibold text-slate-700">Line</th>
                    <th className="text-right p-2 font-semibold text-slate-700">Budget</th>
                    <th className="text-right p-2 font-semibold text-slate-700">Actual</th>
                    <th className="text-right p-2 font-semibold text-slate-700">Variance</th>
                    <th className="text-left p-2 font-semibold text-slate-700 min-w-[140px]">Budget used</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const hasGl = Boolean(l.gl_account_id);
                    const bud = Number(l.amount ?? 0);
                    const act = lineActualDisplay.get(l.id) ?? 0;
                    const vari = lineVariance.get(l.id) ?? 0;
                    const variClass =
                      !hasGl || vari === 0 ? "text-slate-400" : vari >= 0 ? "text-emerald-700" : "text-red-700";
                    let pct = 0;
                    let over = false;
                    if (hasGl && bud > 0) {
                      pct = (act / bud) * 100;
                      over = pct > 100;
                    }
                    return (
                      <tr key={l.id} className="border-b border-slate-100">
                        <td className="p-2">
                          <div className="font-medium text-slate-800">{l.line_label}</div>
                          {l.gl_accounts && (
                            <div className="text-xs text-slate-500 font-mono">
                              {l.gl_accounts.account_code} · {l.gl_accounts.account_name}
                            </div>
                          )}
                          {!hasGl && <div className="text-xs text-amber-700 bg-amber-50 inline-block rounded px-1.5 py-0.5 mt-1">No GL — no actual</div>}
                        </td>
                        <td className="p-2 text-right tabular-nums">{bud.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                        <td className="p-2 text-right tabular-nums text-slate-800">
                          {!hasGl ? "—" : actualsLoading ? "…" : act.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td className={`p-2 text-right tabular-nums font-medium ${variClass}`}>
                          {!hasGl ? "—" : actualsLoading ? "…" : vari.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-2">
                          {!hasGl || bud <= 0 ? (
                            <span className="text-slate-400 text-xs">—</span>
                          ) : actualsLoading ? (
                            "…"
                          ) : (
                            <BudgetUseBar pct={pct} overBudget={over} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
