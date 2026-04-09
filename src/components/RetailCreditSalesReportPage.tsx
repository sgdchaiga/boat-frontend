import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileText, Filter, RotateCcw } from "lucide-react";
import { supabase } from "../lib/supabase";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import {
  buildInvoiceSettlementMap,
  invoiceBalanceDue,
  type InvoiceSettlementMap,
} from "../lib/invoicePaymentAllocations";
import { useAuth } from "../contexts/AuthContext";
import { SearchableCombobox } from "./common/SearchableCombobox";
import { PageNotes } from "./common/PageNotes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type InvoiceStatus = "draft" | "sent" | "paid" | "void";

/** Derived for reporting: balance + due date + void — not stored on the row. */
type DisplayInvoiceStatus = "paid" | "overdue" | "draft" | "sent" | "void";

type StatusFilterValue = "all" | DisplayInvoiceStatus;

type InvoiceRow = {
  id: string;
  invoice_number: string;
  customer_name: string;
  issue_date: string;
  due_date: string | null;
  status: InvoiceStatus;
  total: number;
};

const STATUS_CARD_ORDER: DisplayInvoiceStatus[] = ["paid", "overdue", "draft", "sent", "void"];

function formatMoney(amount: number) {
  return Number.isFinite(amount)
    ? amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
}

/** issue_date is YYYY-MM-DD or ISO string — normalize to YYYY-MM-DD for range compare */
function issueDateKey(issueDate: string): string {
  const s = String(issueDate || "").trim();
  if (s.length >= 10) return s.slice(0, 10);
  return s;
}

/** Paid = settled in full; overdue = unpaid with due date before today; else draft/sent/void from DB rules. */
function displayInvoiceStatus(row: InvoiceRow, settlement: InvoiceSettlementMap): DisplayInvoiceStatus {
  if (row.status === "void") return "void";
  const bal = invoiceBalanceDue(row, settlement);
  if (bal <= 0.001) return "paid";
  const due = row.due_date ? issueDateKey(row.due_date) : "";
  const today = new Date().toISOString().slice(0, 10);
  if (due && due < today) return "overdue";
  if (row.status === "draft") return "draft";
  if (row.status === "sent") return "sent";
  if (row.status === "paid") return "sent";
  return "draft";
}

function applyInvoiceFilters(
  rows: InvoiceRow[],
  settlement: InvoiceSettlementMap,
  filters: {
    dateFrom: string;
    dateTo: string;
    customer: string;
    invoiceNumber: string;
    status: StatusFilterValue;
  }
): InvoiceRow[] {
  const cust = filters.customer.trim().toLowerCase();
  const inv = filters.invoiceNumber.trim().toLowerCase();
  const from = filters.dateFrom.trim();
  const to = filters.dateTo.trim();

  return rows.filter((r) => {
    const disp = displayInvoiceStatus(r, settlement);
    if (filters.status !== "all" && disp !== filters.status) return false;
    const d = issueDateKey(r.issue_date);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (cust && (r.customer_name || "").trim().toLowerCase() !== cust) return false;
    if (inv && (r.invoice_number || "").trim().toLowerCase() !== inv) return false;
    return true;
  });
}

export function RetailCreditSalesReportPage({
  readOnly = false,
  onNavigate,
}: {
  readOnly?: boolean;
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
}) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allInvoices, setAllInvoices] = useState<InvoiceRow[]>([]);
  const [invoiceSettlement, setInvoiceSettlement] = useState<InvoiceSettlementMap>({});

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [invoiceNumberFilter, setInvoiceNumberFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!orgId && !superAdmin) {
        setAllInvoices([]);
        setInvoiceSettlement({});
        setLoading(false);
        return;
      }

      let q = sb
        .from("retail_invoices")
        .select("id, invoice_number, customer_name, issue_date, due_date, status, total")
        .order("issue_date", { ascending: false });

      q = filterByOrganizationId(q, orgId, superAdmin);

      const { data, error: qErr } = await q;

      if (qErr) throw qErr;

      setAllInvoices((data || []) as InvoiceRow[]);

      const payQ = filterByOrganizationId(
        supabase.from("payments").select("id, paid_at, payment_status, invoice_allocations").order("paid_at", { ascending: false }),
        orgId ?? undefined,
        superAdmin
      );
      const { data: payData, error: payErr } = await payQ;
      if (payErr) {
        console.warn("[CreditSalesReport] payments for settlement:", payErr.message);
        setInvoiceSettlement({});
      } else {
        setInvoiceSettlement(buildInvoiceSettlementMap(payData || []));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load invoices.");
      setAllInvoices([]);
      setInvoiceSettlement({});
    } finally {
      setLoading(false);
    }
  }, [orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredInvoices = useMemo(
    () =>
      applyInvoiceFilters(allInvoices, invoiceSettlement, {
        dateFrom,
        dateTo,
        customer: customerFilter,
        invoiceNumber: invoiceNumberFilter,
        status: statusFilter,
      }),
    [allInvoices, invoiceSettlement, dateFrom, dateTo, customerFilter, invoiceNumberFilter, statusFilter]
  );

  const hasActiveFilters =
    !!dateFrom.trim() ||
    !!dateTo.trim() ||
    !!customerFilter.trim() ||
    !!invoiceNumberFilter.trim() ||
    statusFilter !== "all";

  const totals = useMemo(() => {
    const totalAmount = filteredInvoices.reduce((sum, i) => sum + Number(i.total ?? 0), 0);
    const totalPaid = filteredInvoices.reduce((sum, i) => sum + (invoiceSettlement[i.id]?.paid ?? 0), 0);
    const totalBalance = filteredInvoices.reduce((sum, i) => sum + invoiceBalanceDue(i, invoiceSettlement), 0);
    const byStatus: Record<string, { total: number; count: number }> = {};
    filteredInvoices.forEach((i) => {
      const key = displayInvoiceStatus(i, invoiceSettlement);
      if (!byStatus[key]) byStatus[key] = { total: 0, count: 0 };
      byStatus[key].total += Number(i.total ?? 0);
      byStatus[key].count += 1;
    });
    return { totalAmount, totalPaid, totalBalance, invoiceCount: filteredInvoices.length, byStatus };
  }, [filteredInvoices, invoiceSettlement]);

  const customerOptions = useMemo(() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const row of allInvoices) {
      const name = (row.customer_name || "").trim();
      if (!name) continue;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      labels.push(name);
    }
    return labels.sort((a, b) => a.localeCompare(b)).map((label) => ({ id: label, label }));
  }, [allInvoices]);

  const invoiceNumberOptions = useMemo(() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const row of allInvoices) {
      const num = (row.invoice_number || "").trim();
      if (!num) continue;
      if (seen.has(num)) continue;
      seen.add(num);
      labels.push(num);
    }
    return labels.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((label) => ({
      id: label,
      label,
    }));
  }, [allInvoices]);

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setCustomerFilter("");
    setInvoiceNumberFilter("");
    setStatusFilter("all");
  };

  const downloadCsv = () => {
    const header = ["Invoice #", "Customer", "Issue date", "Status", "Invoice amount", "Payment so far", "Balance"].join(",");
    const lines = filteredInvoices.map((i) => {
      const paid = invoiceSettlement[i.id]?.paid ?? 0;
      const balance = invoiceBalanceDue(i, invoiceSettlement);
      const statusLabel = displayInvoiceStatus(i, invoiceSettlement);
      return [i.invoice_number, i.customer_name, i.issue_date, statusLabel, i.total, paid, balance]
        .map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`)
        .join(",");
    });
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `credit_sales_invoices_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="p-6 md:p-8">
        <p className="text-slate-500">Loading credit sales report…</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">Credit Sales Report</h1>
            <PageNotes ariaLabel="Credit sales report help">
              <p>
                {hasActiveFilters
                  ? "Filtered sales invoices."
                  : "Status includes paid (settled), overdue (past due with balance), and draft/sent/void."}
              </p>
            </PageNotes>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 min-w-[6.5rem]">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 leading-tight">Total invoiced</p>
            <p className="text-base font-semibold tabular-nums text-slate-900 leading-tight">{formatMoney(totals.totalAmount)}</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 min-w-[6.5rem]">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 leading-tight">Payment so far</p>
            <p className="text-base font-semibold tabular-nums text-slate-900 leading-tight">{formatMoney(totals.totalPaid)}</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 min-w-[6.5rem]">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 leading-tight">Balance</p>
            <p className="text-base font-semibold tabular-nums text-slate-900 leading-tight">{formatMoney(totals.totalBalance)}</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 min-w-[4rem]">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 leading-tight">Count</p>
            <p className="text-base font-semibold tabular-nums text-slate-900 leading-tight">{totals.invoiceCount}</p>
          </div>
          <button
            type="button"
            onClick={downloadCsv}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-brand-700 text-white text-xs rounded-lg hover:bg-brand-800 transition disabled:opacity-50"
            disabled={readOnly || filteredInvoices.length === 0}
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {!orgId && !superAdmin ? (
        <p className="text-amber-800 text-sm bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          Link your account to an organization to see invoices.
        </p>
      ) : null}

      {error ? <p className="text-red-600 text-sm">{error}</p> : null}

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-slate-800">
            <Filter className="w-5 h-5 text-slate-500" />
            <span className="font-semibold">Filters</span>
          </div>
          <button
            type="button"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-40 disabled:pointer-events-none"
          >
            <RotateCcw className="w-4 h-4" />
            Clear filters
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          <label className="block text-sm">
            <span className="text-slate-600">Issue from</span>
            <input
              type="date"
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Issue to</span>
            <input
              type="date"
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <div className="block text-sm sm:col-span-2 lg:col-span-1">
            <span className="text-slate-600">Customer</span>
            <div className="mt-1">
              <SearchableCombobox
                value={customerFilter}
                onChange={(id) => setCustomerFilter(id)}
                options={customerOptions}
                placeholder="Search or choose customer…"
                emptyOption={{ label: "All customers" }}
                inputAriaLabel="Filter by customer"
                className="w-full"
              />
            </div>
          </div>
          <div className="block text-sm sm:col-span-2 lg:col-span-1">
            <span className="text-slate-600">Invoice #</span>
            <div className="mt-1">
              <SearchableCombobox
                value={invoiceNumberFilter}
                onChange={(id) => setInvoiceNumberFilter(id)}
                options={invoiceNumberOptions}
                placeholder="Search or choose invoice…"
                emptyOption={{ label: "All invoices" }}
                inputAriaLabel="Filter by invoice number"
                className="w-full"
              />
            </div>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">Status</span>
            <select
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilterValue)}
            >
              <option value="all">All statuses</option>
              <option value="paid">Paid (settled in full)</option>
              <option value="overdue">Overdue (unpaid, past due date)</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="void">Void</option>
            </select>
          </label>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-3">
        <p className="text-sm font-semibold text-slate-900 mb-2">By status</p>
        {Object.keys(totals.byStatus).length === 0 ? (
          <p className="text-slate-500 text-xs">
            {allInvoices.length === 0 ? "No invoices yet." : "No invoices match the current filters."}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {STATUS_CARD_ORDER.filter((s) => totals.byStatus[s])
              .map((status) => {
                const v = totals.byStatus[status];
                return (
                  <div key={status} className="rounded-md border border-slate-100 bg-slate-50 px-2 py-1.5">
                    <p className="text-[10px] text-slate-500 capitalize leading-tight">{status}</p>
                    <p className="text-xs font-semibold tabular-nums text-slate-900">{formatMoney(v.total)}</p>
                    <p className="text-[10px] text-slate-500">{v.count} inv.</p>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left p-3">Invoice #</th>
              <th className="text-left p-3">Customer</th>
              <th className="text-left p-3">Issue</th>
              <th className="text-left p-3">Status</th>
              <th className="text-right p-3">Invoice amount</th>
              <th className="text-right p-3">Payment so far</th>
              <th className="text-right p-3">Balance</th>
            </tr>
          </thead>
          <tbody>
            {allInvoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  No invoices loaded.
                </td>
              </tr>
            ) : filteredInvoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  No invoices match the current filters.
                </td>
              </tr>
            ) : (
              filteredInvoices.map((inv) => {
                const paid = invoiceSettlement[inv.id]?.paid ?? 0;
                const balance = invoiceBalanceDue(inv, invoiceSettlement);
                const disp = displayInvoiceStatus(inv, invoiceSettlement);
                const statusClass =
                  disp === "paid"
                    ? "text-emerald-700 font-medium"
                    : disp === "overdue"
                      ? "text-amber-800 font-semibold"
                      : disp === "void"
                        ? "text-slate-400"
                        : "text-slate-800";
                return (
                <tr key={inv.id} className="border-t border-slate-100">
                  <td className="p-3 font-mono text-xs font-medium">{inv.invoice_number}</td>
                  <td className="p-3 max-w-[220px] truncate">{inv.customer_name || "—"}</td>
                  <td className="p-3">{inv.issue_date}</td>
                  <td className={`p-3 capitalize ${statusClass}`}>{disp}</td>
                  <td className="p-3 text-right">
                    {onNavigate ? (
                      <button
                        type="button"
                        className="font-semibold text-brand-700 hover:underline tabular-nums inline-flex items-center gap-1"
                        onClick={() =>
                          onNavigate("retail_credit_invoices", {
                            invoiceTab: "invoices",
                          })
                        }
                      >
                        <FileText className="w-4 h-4" />
                        {formatMoney(inv.total)}
                      </button>
                    ) : (
                      <span className="font-semibold text-slate-900">{formatMoney(inv.total)}</span>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums text-slate-700">{formatMoney(paid)}</td>
                  <td className="p-3 text-right tabular-nums font-semibold text-slate-900">{formatMoney(balance)}</td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
