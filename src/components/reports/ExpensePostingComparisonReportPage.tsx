import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { supabase } from "@/lib/supabase";
import { filterJournalLinesByOrganizationId } from "@/lib/supabaseOrgFilter";
import { computeRangeInTimezone, toBusinessDateString, type DateRangeKey } from "@/lib/timezone";

type PostingLine = {
  debit: number | null;
  credit: number | null;
  gl_accounts: { id: string; account_code: string | null; account_name: string | null } | null;
  journal_entries: { reference_type: string | null } | null;
};

type ComparisonRow = { id: string; code: string; account: string; expenses: number; purchases: number; total: number };
const PAGE_SIZE = 1000;

function money(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ExpensePostingComparisonReportPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rows, setRows] = useState<ComparisonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
      const fromDate = toBusinessDateString(from);
      const toExclusive = toBusinessDateString(to);
      const lines: PostingLine[] = [];
      for (let page = 0; ; page += PAGE_SIZE) {
        const query = filterJournalLinesByOrganizationId(
          supabase
            .from("journal_entry_lines")
            .select("debit,credit,gl_accounts!inner(id,account_code,account_name),journal_entries!inner(reference_type,organization_id,entry_date,is_posted,is_deleted)")
            .in("journal_entries.reference_type", ["expense", "bill"])
            .eq("journal_entries.is_posted", true)
            .eq("journal_entries.is_deleted", false)
            .gte("journal_entries.entry_date", fromDate)
            .lt("journal_entries.entry_date", toExclusive)
            .order("id", { ascending: true })
            .range(page, page + PAGE_SIZE - 1),
          orgId,
          !!user?.isSuperAdmin
        );
        const result = await query;
        if (result.error) throw result.error;
        const batch = (result.data || []) as unknown as PostingLine[];
        lines.push(...batch);
        if (batch.length < PAGE_SIZE) break;
      }

      const grouped = new Map<string, ComparisonRow>();
      for (const line of lines) {
        const account = line.gl_accounts;
        if (!account) continue;
        const netDebit = Number(line.debit || 0) - Number(line.credit || 0);
        const current = grouped.get(account.id) || {
          id: account.id,
          code: String(account.account_code || ""),
          account: String(account.account_name || "Unlabelled account"),
          expenses: 0,
          purchases: 0,
          total: 0,
        };
        if (line.journal_entries?.reference_type === "expense") current.expenses += netDebit;
        if (line.journal_entries?.reference_type === "bill") current.purchases += netDebit;
        current.total = current.expenses + current.purchases;
        grouped.set(account.id, current);
      }
      setRows([...grouped.values()].filter((row) => row.expenses > 0.005 || row.purchases > 0.005).sort((a, b) => b.total - a.total || a.code.localeCompare(b.code)));
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : "Could not load expense posting comparison.");
    } finally {
      setLoading(false);
    }
  }, [orgId, user?.isSuperAdmin, dateRange, customFrom, customTo]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => rows.reduce((sum, row) => ({ expenses: sum.expenses + row.expenses, purchases: sum.purchases + row.purchases, total: sum.total + row.total }), { expenses: 0, purchases: 0, total: 0 }), [rows]);

  const exportCsv = () => {
    const body = ["Account code,Account,Expenses,Purchases,Total", ...rows.map((row) => [row.code, row.account, row.expenses.toFixed(2), row.purchases.toFixed(2), row.total.toFixed(2)].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")), `"","Grand total","${totals.expenses.toFixed(2)}","${totals.purchases.toFixed(2)}","${totals.total.toFixed(2)}"`].join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `expense_posting_comparison_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-3xl font-bold text-slate-900">Expense posting comparison</h1><PageNotes ariaLabel="Expense posting comparison help"><p>Compares posted Spend money journals with posted supplier-bill journals by the account debited. Purchase orders that have not become posted bills are not included.</p></PageNotes></div>
          <p className="mt-1 text-sm text-slate-600">Account / Expenses / Purchases / Total</p>
        </div>
        <button type="button" onClick={exportCsv} disabled={!rows.length} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"><Download className="h-4 w-4" />Export CSV</button>
      </div>
      <div className="mb-6 flex flex-wrap gap-3">
        <select value={dateRange} onChange={(event) => setDateRange(event.target.value as DateRangeKey)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="this_week">This week</option><option value="this_month">This month</option><option value="this_quarter">This quarter</option><option value="this_year">This year</option><option value="last_month">Last month</option><option value="last_year">Last year</option><option value="custom">Custom</option>
        </select>
        {dateRange === "custom" && <><input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></>}
      </div>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="p-3 text-left">Account</th><th className="p-3 text-right">Expenses</th><th className="p-3 text-right">Purchases</th><th className="p-3 text-right">Total</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={4} className="p-8 text-center text-slate-500">Loading postings…</td></tr> : !rows.length ? <tr><td colSpan={4} className="p-8 text-center text-slate-500">No posted expenses or purchases in this period.</td></tr> : rows.map((row) => <tr key={row.id} className="border-b border-slate-100"><td className="p-3"><span className="font-mono text-xs text-slate-500">{row.code || "—"}</span> <span className="font-medium text-slate-800">{row.account}</span></td><td className="p-3 text-right">{money(row.expenses)}</td><td className="p-3 text-right">{money(row.purchases)}</td><td className="p-3 text-right font-semibold">{money(row.total)}</td></tr>)}
          </tbody>
          {!loading && rows.length > 0 && <tfoot className="bg-slate-900 text-white"><tr><th className="p-3 text-left">Grand total</th><th className="p-3 text-right">{money(totals.expenses)}</th><th className="p-3 text-right">{money(totals.purchases)}</th><th className="p-3 text-right">{money(totals.total)}</th></tr></tfoot>}
        </table>
      </div>
    </div>
  );
}
