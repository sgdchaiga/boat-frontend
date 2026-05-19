import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { normalizeGlAccountRows, type NormalizedGlAccount } from "../../lib/glAccountNormalize";
import {
  resolveExpenseCategoryLabel,
  SIMPLE_EXPENSE_CATEGORIES,
  SIMPLE_EXPENSE_CATEGORY_LABELS,
  type SimpleExpenseCategory,
} from "../../lib/expenseCategories";
import { useAuth } from "../../contexts/AuthContext";
import { PageNotes } from "../common/PageNotes";

type ExpenseHeader = {
  id: string;
  expense_date: string | null;
  description: string | null;
  amount: number;
  vendor_id: string | null;
  vendors?: { name?: string | null } | null;
};

type ExpenseLineRow = {
  expense_id: string;
  expense_gl_account_id: string;
  amount: number;
  vat_amount: number;
  comment: string | null;
};

type DetailRow = {
  expenseId: string;
  expenseDate: string;
  category: string;
  description: string;
  vendor: string;
  glLabel: string;
  amount: number;
};

function formatMoney(amount: number) {
  return Number.isFinite(amount)
    ? amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
}

function lineTotal(amount: number, vat: number) {
  return Math.round((Number(amount || 0) + Number(vat || 0)) * 100) / 100;
}

export function ExpensesReportPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<DetailRow[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!orgId && !superAdmin) {
        setDetails([]);
        return;
      }

      const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
      const fromDate = from.toISOString().slice(0, 10);
      const toExclusiveDate = to.toISOString().slice(0, 10);

      let expQ = filterByOrganizationId(
        supabase
          .from("expenses")
          .select("id, expense_date, description, amount, vendor_id, vendors(name)")
          .gte("expense_date", fromDate)
          .lt("expense_date", toExclusiveDate)
          .order("expense_date", { ascending: false }),
        orgId,
        superAdmin
      );
      const { data: expData, error: expErr } = await expQ;
      if (expErr) throw expErr;

      const expenses = (expData || []) as ExpenseHeader[];
      const expenseIds = expenses.map((e) => e.id);
      if (expenseIds.length === 0) {
        setDetails([]);
        return;
      }

      const { data: lineData, error: lineErr } = await supabase
        .from("expense_lines")
        .select("expense_id, expense_gl_account_id, amount, vat_amount, comment")
        .in("expense_id", expenseIds);
      if (lineErr) throw lineErr;

      const lines = (lineData || []) as ExpenseLineRow[];
      const glIds = [...new Set(lines.map((l) => l.expense_gl_account_id).filter(Boolean))];
      let glById = new Map<string, NormalizedGlAccount>();
      if (glIds.length > 0) {
        const { data: glRows } = await supabase.from("gl_accounts").select("*").in("id", glIds);
        glById = new Map(normalizeGlAccountRows((glRows || []) as unknown[]).map((g) => [g.id, g]));
      }

      const expById = new Map(expenses.map((e) => [e.id, e]));
      const built: DetailRow[] = [];

      for (const line of lines) {
        const exp = expById.get(line.expense_id);
        if (!exp) continue;
        const gl = glById.get(line.expense_gl_account_id);
        const category = resolveExpenseCategoryLabel(gl);
        const amt = lineTotal(line.amount, line.vat_amount);
        const desc =
          (line.comment || "").trim() ||
          (exp.description || "").trim() ||
          gl?.account_name ||
          "Expense";
        built.push({
          expenseId: exp.id,
          expenseDate: exp.expense_date || fromDate,
          category,
          description: desc,
          vendor: exp.vendors?.name?.trim() || "—",
          glLabel: gl ? `${gl.account_code} ${gl.account_name}`.trim() : "—",
          amount: amt,
        });
      }

      // Expenses with no lines: show header amount as Other
      const withLines = new Set(lines.map((l) => l.expense_id));
      for (const exp of expenses) {
        if (withLines.has(exp.id)) continue;
        const amt = Number(exp.amount ?? 0);
        if (amt <= 0) continue;
        built.push({
          expenseId: exp.id,
          expenseDate: exp.expense_date || fromDate,
          category: SIMPLE_EXPENSE_CATEGORY_LABELS.Other,
          description: (exp.description || "").trim() || "Expense",
          vendor: exp.vendors?.name?.trim() || "—",
          glLabel: "—",
          amount: amt,
        });
      }

      built.sort((a, b) => {
        const d = b.expenseDate.localeCompare(a.expenseDate);
        if (d !== 0) return d;
        return b.amount - a.amount;
      });
      setDetails(built);
    } catch (e) {
      console.error("[Expenses report]", e);
      setDetails([]);
    } finally {
      setLoading(false);
    }
  }, [orgId, superAdmin, dateRange, customFrom, customTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryOptions = useMemo(() => {
    const set = new Set(details.map((d) => d.category));
    const ordered: string[] = [];
    for (const cat of SIMPLE_EXPENSE_CATEGORIES) {
      const label = SIMPLE_EXPENSE_CATEGORY_LABELS[cat as SimpleExpenseCategory];
      if (set.has(label)) ordered.push(label);
    }
    for (const c of set) {
      if (!ordered.includes(c)) ordered.push(c);
    }
    return ordered;
  }, [details]);

  const filtered = useMemo(() => {
    if (categoryFilter === "all") return details;
    return details.filter((d) => d.category === categoryFilter);
  }, [details, categoryFilter]);

  const categoryTotals = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const row of details) {
      const cur = map.get(row.category) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += row.amount;
      map.set(row.category, cur);
    }
    return [...map.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [details]);

  const grandTotal = useMemo(() => details.reduce((s, r) => s + r.amount, 0), [details]);

  const exportCsv = () => {
    const header = ["Date", "Category", "Description", "Vendor", "GL account", "Amount"].join(",");
    const rows = filtered.map((r) =>
      [r.expenseDate, r.category, r.description, r.vendor, r.glLabel, r.amount]
        .map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`)
        .join(",")
    );
    const summary = ["", "", "", "", "Total", grandTotal.toFixed(2)].join(",");
    const csv = [header, ...rows, "", summary].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses_report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Expense report</h1>
            <PageNotes ariaLabel="Expense report help">
              <p>
                All spend recorded under <strong>Spend money</strong> (operating expenses), grouped by category. Supplier
                bills and stock purchases are on the purchases reports.
              </p>
            </PageNotes>
          </div>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="border border-slate-300 rounded-lg px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      <div className="flex flex-wrap gap-4 mb-6">
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="this_week">This Week</option>
          <option value="this_month">This Month</option>
          <option value="this_quarter">This Quarter</option>
          <option value="this_year">This Year</option>
          <option value="last_week">Last Week</option>
          <option value="last_month">Last Month</option>
          <option value="last_quarter">Last Quarter</option>
          <option value="last_year">Last Year</option>
          <option value="custom">Custom</option>
        </select>
        {dateRange === "custom" && (
          <>
            <input
              type="date"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <input
              type="date"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </>
        )}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All categories</option>
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-slate-500 py-4">Loading expenses…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Total expenses</p>
              <p className="text-2xl font-bold text-slate-900">{formatMoney(grandTotal)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Line items</p>
              <p className="text-2xl font-bold text-slate-900">{details.length}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Categories</p>
              <p className="text-2xl font-bold text-slate-900">{categoryTotals.length}</p>
            </div>
          </div>

          <h2 className="text-sm font-semibold text-slate-800 mb-2">By category</h2>
          <div className="app-card overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left p-3">Category</th>
                  <th className="text-right p-3">Items</th>
                  <th className="text-right p-3">Amount</th>
                  <th className="text-right p-3">Share</th>
                </tr>
              </thead>
              <tbody>
                {categoryTotals.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500">
                      No expenses in this period. Record spend under Spend money.
                    </td>
                  </tr>
                ) : (
                  categoryTotals.map((row) => (
                    <tr key={row.category} className="border-t border-slate-100">
                      <td className="p-3 font-medium text-slate-900">{row.category}</td>
                      <td className="p-3 text-right tabular-nums">{row.count}</td>
                      <td className="p-3 text-right tabular-nums font-semibold">{formatMoney(row.total)}</td>
                      <td className="p-3 text-right tabular-nums text-slate-600">
                        {grandTotal > 0 ? `${((row.total / grandTotal) * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h2 className="text-sm font-semibold text-slate-800 mb-2">Detail</h2>
          <div className="app-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left p-3">Date</th>
                  <th className="text-left p-3">Category</th>
                  <th className="text-left p-3">Description</th>
                  <th className="text-left p-3">Vendor</th>
                  <th className="text-left p-3">GL account</th>
                  <th className="text-right p-3">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">
                      No matching expenses.
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => (
                    <tr key={`${row.expenseId}-${row.description}-${row.amount}`} className="border-t border-slate-100">
                      <td className="p-3 whitespace-nowrap">{row.expenseDate}</td>
                      <td className="p-3">{row.category}</td>
                      <td className="p-3 max-w-[240px] truncate" title={row.description}>
                        {row.description}
                      </td>
                      <td className="p-3 max-w-[140px] truncate">{row.vendor}</td>
                      <td className="p-3 max-w-[180px] truncate text-slate-600" title={row.glLabel}>
                        {row.glLabel}
                      </td>
                      <td className="p-3 text-right tabular-nums font-medium">{formatMoney(row.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
