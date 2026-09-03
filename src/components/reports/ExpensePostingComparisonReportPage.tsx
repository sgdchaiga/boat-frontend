import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { supabase } from "@/lib/supabase";
import { filterJournalLinesByOrganizationId } from "@/lib/supabaseOrgFilter";
import { computeRangeInTimezone, toBusinessDateString, type DateRangeKey } from "@/lib/timezone";
import { parseBillAllocationsJson } from "@/lib/billStatus";

type PostingLine = {
  debit: number | null;
  credit: number | null;
  gl_accounts: { id: string; account_code: string | null; account_name: string | null } | null;
  journal_entries: { reference_type: string | null; reference_id?: string | null } | null;
};

type ComparisonRow = { id: string; code: string; account: string; expenses: number; purchases: number; total: number };
const PAGE_SIZE = 1000;
type Basis = "accrual" | "cash";
type SortKey = "code" | "account" | "expenses" | "purchases" | "total";

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
  const [basis, setBasis] = useState<Basis>("accrual");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "total", direction: "desc" });
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
            .in("journal_entries.reference_type", basis === "cash" ? ["expense"] : ["expense", "bill"])
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

      if (basis === "cash") {
        let paymentQuery = supabase
          .from("vendor_payments")
          .select("id,bill_id,bill_allocations,amount,status")
          .eq("organization_id", orgId)
          .gte("payment_date", fromDate)
          .lt("payment_date", toExclusive);
        const paymentResult = await paymentQuery;
        if (paymentResult.error) throw paymentResult.error;
        const payments = ((paymentResult.data || []) as Array<{ id: string; bill_id: string | null; bill_allocations: unknown; amount: number; status?: string | null }>).filter((payment) => payment.status !== "reversed");
        const paymentIds = payments.map((payment) => payment.id);
        const allocationRows: Array<{ vendor_payment_id: string; bill_id: string; amount: number }> = [];
        for (let start = 0; start < paymentIds.length; start += 200) {
          const ids = paymentIds.slice(start, start + 200);
          if (!ids.length) continue;
          const result = await supabase.from("vendor_payment_bill_allocations").select("vendor_payment_id,bill_id,amount").in("vendor_payment_id", ids);
          if (!result.error) allocationRows.push(...((result.data || []) as typeof allocationRows));
        }
        const tableAllocations = new Map<string, Array<{ bill_id: string; amount: number }>>();
        allocationRows.forEach((row) => tableAllocations.set(row.vendor_payment_id, [...(tableAllocations.get(row.vendor_payment_id) || []), { bill_id: row.bill_id, amount: Number(row.amount || 0) }]));
        const paymentAllocations = payments.flatMap((payment) => {
          const json = parseBillAllocationsJson(payment.bill_allocations);
          const table = tableAllocations.get(payment.id) || [];
          const allocations = json.length ? json : table.length ? table : payment.bill_id ? [{ bill_id: payment.bill_id, amount: Number(payment.amount || 0) }] : [];
          return allocations.map((allocation) => ({ ...allocation, payment_id: payment.id }));
        });
        const billIds = [...new Set(paymentAllocations.map((allocation) => allocation.bill_id))];
        const billLines: PostingLine[] = [];
        for (let start = 0; start < billIds.length; start += 150) {
          const ids = billIds.slice(start, start + 150);
          if (!ids.length) continue;
          const result = await filterJournalLinesByOrganizationId(
            supabase.from("journal_entry_lines").select("debit,credit,gl_accounts!inner(id,account_code,account_name),journal_entries!inner(reference_type,reference_id,organization_id,is_posted,is_deleted)").eq("journal_entries.reference_type", "bill").eq("journal_entries.is_posted", true).eq("journal_entries.is_deleted", false).in("journal_entries.reference_id", ids),
            orgId,
            !!user?.isSuperAdmin
          );
          if (result.error) throw result.error;
          billLines.push(...((result.data || []) as unknown as PostingLine[]));
        }
        const positiveBillLines = new Map<string, PostingLine[]>();
        billLines.forEach((line) => {
          const billId = line.journal_entries?.reference_id;
          if (!billId || Number(line.debit || 0) - Number(line.credit || 0) <= 0) return;
          positiveBillLines.set(billId, [...(positiveBillLines.get(billId) || []), line]);
        });
        paymentAllocations.forEach((allocation) => {
          const sourceLines = positiveBillLines.get(allocation.bill_id) || [];
          const billDebitTotal = sourceLines.reduce((sum, line) => sum + Number(line.debit || 0) - Number(line.credit || 0), 0);
          if (billDebitTotal <= 0) return;
          sourceLines.forEach((line) => lines.push({ ...line, debit: Number(allocation.amount || 0) * (Number(line.debit || 0) - Number(line.credit || 0)) / billDebitTotal, credit: 0, journal_entries: { reference_type: "bill", reference_id: allocation.bill_id } }));
        });
        const allocatedByPayment = new Map<string, number>();
        paymentAllocations.forEach((allocation) => allocatedByPayment.set(allocation.payment_id, (allocatedByPayment.get(allocation.payment_id) || 0) + Number(allocation.amount || 0)));
        const unallocated = payments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount || 0) - (allocatedByPayment.get(payment.id) || 0)), 0);
        if (unallocated > 0.005) lines.push({ debit: unallocated, credit: 0, gl_accounts: { id: "unallocated-supplier-payments", account_code: "—", account_name: "Unallocated supplier payments" }, journal_entries: { reference_type: "bill" } });
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
  }, [orgId, user?.isSuperAdmin, dateRange, customFrom, customTo, basis]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => rows.reduce((sum, row) => ({ expenses: sum.expenses + row.expenses, purchases: sum.purchases + row.purchases, total: sum.total + row.total }), { expenses: 0, purchases: 0, total: 0 }), [rows]);
  const sortedRows = useMemo(() => [...rows].sort((a, b) => {
    const left = a[sort.key];
    const right = b[sort.key];
    const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
    return comparison * (sort.direction === "asc" ? 1 : -1);
  }), [rows, sort]);
  const toggleSort = (key: SortKey) => setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  const sortIcon = (key: SortKey) => sort.key !== key ? <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" /> : sort.direction === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
  const sortHeading = (key: SortKey, label: string, right = false) => <th className={`p-3 ${right ? "text-right" : "text-left"}`}><button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 font-semibold">{label}{sortIcon(key)}</button></th>;

  const exportCsv = () => {
    const body = ["Account code,Account,Expenses,Purchases,Total", ...sortedRows.map((row) => [row.code, row.account, row.expenses.toFixed(2), row.purchases.toFixed(2), row.total.toFixed(2)].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")), `"","Grand total","${totals.expenses.toFixed(2)}","${totals.purchases.toFixed(2)}","${totals.total.toFixed(2)}"`].join("\n");
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
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1" aria-label="Accounting basis">
          {(["accrual", "cash"] as Basis[]).map((value) => <button key={value} type="button" onClick={() => setBasis(value)} className={`rounded-md px-3 py-1.5 text-sm capitalize ${basis === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{value} basis</button>)}
        </div>
        <select value={dateRange} onChange={(event) => setDateRange(event.target.value as DateRangeKey)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="this_week">This week</option><option value="this_month">This month</option><option value="this_quarter">This quarter</option><option value="this_year">This year</option><option value="last_month">Last month</option><option value="last_year">Last year</option><option value="custom">Custom</option>
        </select>
        {dateRange === "custom" && <><input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></>}
      </div>
      <p className="mb-4 text-xs text-slate-500">{basis === "accrual" ? "Accrual basis uses the expense or supplier-bill posting date." : "Cash basis uses direct expense dates and supplier payment dates. Paid bill amounts are traced back proportionately to the original expense, inventory and input-tax accounts."}</p>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50"><tr>{sortHeading("code", "Account number")}{sortHeading("account", "Account name")}{sortHeading("expenses", "Expenses", true)}{sortHeading("purchases", "Purchases", true)}{sortHeading("total", "Total", true)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="p-8 text-center text-slate-500">Loading postings…</td></tr> : !rows.length ? <tr><td colSpan={5} className="p-8 text-center text-slate-500">No posted expenses or purchases in this period.</td></tr> : sortedRows.map((row) => <tr key={row.id} className="border-b border-slate-100"><td className="p-3 font-mono text-xs text-slate-600">{row.code || "—"}</td><td className="p-3 font-medium text-slate-800">{row.account}</td><td className="p-3 text-right">{money(row.expenses)}</td><td className="p-3 text-right">{money(row.purchases)}</td><td className="p-3 text-right font-semibold">{money(row.total)}</td></tr>)}
          </tbody>
          {!loading && rows.length > 0 && <tfoot className="bg-slate-900 text-white"><tr><th colSpan={2} className="p-3 text-left">Grand total</th><th className="p-3 text-right">{money(totals.expenses)}</th><th className="p-3 text-right">{money(totals.purchases)}</th><th className="p-3 text-right">{money(totals.total)}</th></tr></tfoot>}
        </table>
      </div>
    </div>
  );
}
