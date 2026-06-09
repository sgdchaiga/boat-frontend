import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
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
  quantity: number | null;
};

type DetailRow = {
  expenseId: string;
  expenseDate: string;
  category: string;
  item: string;
  department: string;
  description: string;
  vendor: string;
  glLabel: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

type DetailSortKey = "expenseDate" | "category" | "item" | "department" | "vendor" | "glLabel" | "quantity" | "unitPrice" | "amount";
type SortDirection = "asc" | "desc";

function normalizeItemName(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

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
  const [itemFilter, setItemFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [sort, setSort] = useState<{ key: DetailSortKey; direction: SortDirection }>({ key: "expenseDate", direction: "desc" });

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
        .select("expense_id, expense_gl_account_id, amount, vat_amount, comment, quantity")
        .in("expense_id", expenseIds);
      if (lineErr) throw lineErr;

      const lines = (lineData || []) as ExpenseLineRow[];
      const glIds = [...new Set(lines.map((l) => l.expense_gl_account_id).filter(Boolean))];
      const [productsRes, departmentsRes, departmentGlRes] = await Promise.all([
        filterByOrganizationId(supabase.from("products").select("name, department_id, purchasable"), orgId, superAdmin),
        filterByOrganizationId(supabase.from("departments").select("id, name"), orgId, superAdmin),
        filterByOrganizationId(
          supabase.from("journal_gl_department_settings").select("department_id, purchases_gl_account_id"),
          orgId,
          superAdmin
        ),
      ]);
      const products = (productsRes.data || []) as Array<{ name: string; department_id: string | null; purchasable: boolean | null }>;
      const departments = (departmentsRes.data || []) as Array<{ id: string; name: string }>;
      const departmentGlRows = (departmentGlRes.data || []) as Array<{ department_id: string; purchases_gl_account_id: string | null }>;
      const departmentById = new Map(departments.map((department) => [department.id, department.name]));
      const departmentByPurchasesGl = new Map(
        departmentGlRows
          .filter((row) => !!row.purchases_gl_account_id)
          .map((row) => [String(row.purchases_gl_account_id), departmentById.get(row.department_id) || "Unassigned"])
      );
      const purchasableProducts = products.filter((product) => product.purchasable !== false);
      const productByName = new Map(purchasableProducts.map((product) => [normalizeItemName(product.name), product]));
      const productsByLongestName = [...purchasableProducts].sort(
        (a, b) => normalizeItemName(b.name).length - normalizeItemName(a.name).length
      );
      const findProduct = (value: string) => {
        const normalized = normalizeItemName(value);
        if (!normalized) return null;
        return productByName.get(normalized) || productsByLongestName.find((product) => {
          const productName = normalizeItemName(product.name);
          return productName.length >= 3 && normalized.includes(productName);
        }) || null;
      };
      let glById = new Map<string, NormalizedGlAccount>();
      if (glIds.length > 0) {
        const { data: glRows } = await supabase.from("gl_accounts").select("*").in("id", glIds);
        glById = new Map(normalizeGlAccountRows((glRows || []) as unknown[]).map((g) => [g.id, g]));
      }
      const departmentForPurchasesGl = (glAccountId: string) => {
        const configured = departmentByPurchasesGl.get(glAccountId);
        if (configured) return configured;
        const gl = glById.get(glAccountId);
        const code = String(gl?.account_code || "").trim();
        const name = String(gl?.account_name || "").toLowerCase();
        if (code === "5001" || /\bbar\b.*\b(purchases?|cogs|cost)/i.test(name)) return "Bar";
        if (code === "5002" || /\bkitchen\b.*\b(purchases?|cogs|cost)/i.test(name)) return "Kitchen";
        return null;
      };

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
        const product = findProduct(desc);
        const quantity = Math.max(0, Number(line.quantity ?? 1)) || 1;
        built.push({
          expenseId: exp.id,
          expenseDate: exp.expense_date || fromDate,
          category,
          item: product?.name || desc,
          department: product?.department_id
            ? departmentById.get(product.department_id) || "Unassigned"
            : departmentForPurchasesGl(line.expense_gl_account_id) || "Unassigned",
          description: desc,
          vendor: exp.vendors?.name?.trim() || "—",
          glLabel: gl ? `${gl.account_code} ${gl.account_name}`.trim() : "—",
          quantity,
          unitPrice: amt / quantity,
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
          item: (exp.description || "").trim() || "Expense",
          department: "Unassigned",
          description: (exp.description || "").trim() || "Expense",
          vendor: exp.vendors?.name?.trim() || "—",
          glLabel: "—",
          quantity: 1,
          unitPrice: amt,
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
    return details.filter((detail) => {
      if (categoryFilter !== "all" && detail.category !== categoryFilter) return false;
      if (itemFilter !== "all" && detail.item !== itemFilter) return false;
      if (departmentFilter !== "all" && detail.department !== departmentFilter) return false;
      return true;
    });
  }, [details, categoryFilter, itemFilter, departmentFilter]);

  const sortedFiltered = useMemo(() => {
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = a[sort.key];
      const right = b[sort.key];
      if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
      return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" }) * direction;
    });
  }, [filtered, sort]);

  const itemOptions = useMemo(
    () => Array.from(new Set(details.map((detail) => detail.item))).sort((a, b) => a.localeCompare(b)),
    [details]
  );
  const departmentOptions = useMemo(
    () => Array.from(new Set(details.map((detail) => detail.department))).sort((a, b) => a.localeCompare(b)),
    [details]
  );
  const toggleSort = (key: DetailSortKey) => {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  };
  const sortIcon = (key: DetailSortKey) => {
    if (sort.key !== key) return <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" aria-hidden />;
    return sort.direction === "asc"
      ? <ArrowUp className="h-3.5 w-3.5 text-brand-700" aria-hidden />
      : <ArrowDown className="h-3.5 w-3.5 text-brand-700" aria-hidden />;
  };
  const sortHeader = (key: DetailSortKey, label: string, align: "left" | "right" = "left") => (
    <th className={`${align === "right" ? "text-right" : "text-left"} p-3 whitespace-nowrap`}>
      <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 font-semibold">
        {label}{sortIcon(key)}
      </button>
    </th>
  );

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
  const filteredAmount = useMemo(() => filtered.reduce((sum, row) => sum + row.amount, 0), [filtered]);
  const filteredQuantity = useMemo(() => filtered.reduce((sum, row) => sum + row.quantity, 0), [filtered]);

  const exportCsv = () => {
    const header = ["Date", "Category", "Item", "Department", "Vendor", "GL account", "Quantity", "Unit price", "Amount spent"].join(",");
    const rows = sortedFiltered.map((r) =>
      [r.expenseDate, r.category, r.item, r.department, r.vendor, r.glLabel, r.quantity, r.unitPrice, r.amount]
        .map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`)
        .join(",")
    );
    const summary = ["", "", "", "", "", "Filtered totals", filteredQuantity, "", filteredAmount.toFixed(2)].join(",");
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
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All departments</option>
          {departmentOptions.map((department) => (
            <option key={department} value={department}>{department}</option>
          ))}
        </select>
        <select
          value={itemFilter}
          onChange={(e) => setItemFilter(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm min-w-[220px]"
        >
          <option value="all">All items</option>
          {itemOptions.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-slate-500 py-4">Loading expenses…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Total expenses</p>
              <p className="text-2xl font-bold text-slate-900">{formatMoney(grandTotal)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Filtered amount spent</p>
              <p className="text-2xl font-bold text-slate-900">{formatMoney(filteredAmount)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Filtered quantity</p>
              <p className="text-2xl font-bold text-slate-900">{filteredQuantity.toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Filtered lines</p>
              <p className="text-2xl font-bold text-slate-900">{filtered.length}</p>
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
          <div className="app-card overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {sortHeader("expenseDate", "Date")}
                  {sortHeader("category", "Category")}
                  {sortHeader("item", "Item")}
                  {sortHeader("department", "Department")}
                  {sortHeader("vendor", "Vendor")}
                  {sortHeader("glLabel", "GL account")}
                  {sortHeader("quantity", "Quantity", "right")}
                  {sortHeader("unitPrice", "Unit price", "right")}
                  {sortHeader("amount", "Amount spent", "right")}
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-500">
                      No matching expenses.
                    </td>
                  </tr>
                ) : (
                  sortedFiltered.map((row) => (
                    <tr key={`${row.expenseId}-${row.description}-${row.amount}`} className="border-t border-slate-100">
                      <td className="p-3 whitespace-nowrap">{row.expenseDate}</td>
                      <td className="p-3">{row.category}</td>
                      <td className="p-3 max-w-[240px] truncate" title={row.item}>
                        {row.item}
                      </td>
                      <td className="p-3">{row.department}</td>
                      <td className="p-3 max-w-[140px] truncate">{row.vendor}</td>
                      <td className="p-3 max-w-[180px] truncate text-slate-600" title={row.glLabel}>
                        {row.glLabel}
                      </td>
                      <td className="p-3 text-right tabular-nums">{row.quantity.toLocaleString()}</td>
                      <td className="p-3 text-right tabular-nums">{formatMoney(row.unitPrice)}</td>
                      <td className="p-3 text-right tabular-nums font-medium">{formatMoney(row.amount)}</td>
                    </tr>
                  ))
                )}
                {sortedFiltered.length > 0 ? (
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                    <td colSpan={6} className="p-3 text-right">Filtered totals</td>
                    <td className="p-3 text-right tabular-nums">{filteredQuantity.toLocaleString()}</td>
                    <td className="p-3" />
                    <td className="p-3 text-right tabular-nums">{formatMoney(filteredAmount)}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
