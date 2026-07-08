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

type PosCreditRow = {
  id: string;
  reference: string;
  customer_name: string | null;
  recorded_at: string | null;
  status: string;
  amount_due: number;
};

type DebtorSource = "invoice" | "pos_credit";

type DebtorReportRow = {
  id: string;
  source: DebtorSource;
  reference: string;
  customer_name: string;
  date: string;
  status: DisplayInvoiceStatus | "pos_credit";
  total: number;
  paid: number;
  balance: number;
  invoice?: InvoiceRow;
};

const STATUS_CARD_ORDER: Array<DisplayInvoiceStatus | "pos_credit"> = ["pos_credit", "paid", "overdue", "draft", "sent", "void"];

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

function parseSaleId(transactionId: string | null | undefined): string | null {
  if (!transactionId) return null;
  const reasonTag = "[REFUND_REASON:";
  const rawRef = String(transactionId);
  const base = rawRef.includes(reasonTag) ? rawRef.slice(0, rawRef.indexOf(reasonTag)).trim() : rawRef.trim();
  return base || null;
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
  const [allPosCredits, setAllPosCredits] = useState<PosCreditRow[]>([]);
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
        setAllPosCredits([]);
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

      const posCreditMap = new Map<string, PosCreditRow>();

      const pendingPaymentQ = filterByOrganizationId(
        supabase
          .from("payments")
          .select("id, transaction_id, paid_at, amount, payment_status, payment_source")
          .is("stay_id", null)
          .eq("payment_status", "pending")
          .order("paid_at", { ascending: false }),
        orgId ?? undefined,
        superAdmin
      );
      const { data: pendingPayments, error: pendingErr } = await pendingPaymentQ;
      if (pendingErr) {
        console.warn("[CreditSalesReport] pending POS payments:", pendingErr.message);
      } else {
        for (const raw of pendingPayments || []) {
          const payment = raw as {
            id: string;
            transaction_id: string | null;
            paid_at: string | null;
            amount: number | null;
            payment_status: string | null;
            payment_source?: string | null;
          };
          const saleId = parseSaleId(payment.transaction_id) || payment.id;
          const existing = posCreditMap.get(saleId);
          const amount = Number(payment.amount ?? 0);
          if (!existing) {
            posCreditMap.set(saleId, {
              id: saleId,
              reference: saleId,
              customer_name: null,
              recorded_at: payment.paid_at,
              status: payment.payment_source === "pos_hotel" ? "hotel POS credit" : "POS credit",
              amount_due: amount,
            });
          } else {
            existing.amount_due += amount;
            if (payment.paid_at && (!existing.recorded_at || payment.paid_at > existing.recorded_at)) {
              existing.recorded_at = payment.paid_at;
            }
          }
        }
      }

      const retailSalesQ = filterByOrganizationId(
        supabase
          .from("retail_sales")
          .select("id, amount_due, sale_at, payment_status, customer_name")
          .gt("amount_due", 0)
          .in("payment_status", ["pending", "partial"])
          .order("sale_at", { ascending: false })
          .limit(1000),
        orgId ?? undefined,
        superAdmin
      );
      const { data: salesData, error: salesErr } = await retailSalesQ;
      if (salesErr) {
        console.warn("[CreditSalesReport] retail_sales credit:", salesErr.message);
      } else {
        for (const raw of salesData || []) {
          const sale = raw as {
            id: string;
            amount_due: number | null;
            sale_at: string | null;
            payment_status: string | null;
            customer_name: string | null;
          };
          const due = Number(sale.amount_due ?? 0);
          if (due <= 0) continue;
          const existing = posCreditMap.get(sale.id);
          if (!existing) {
            posCreditMap.set(sale.id, {
              id: sale.id,
              reference: sale.id,
              customer_name: sale.customer_name,
              recorded_at: sale.sale_at,
              status: sale.payment_status || "credit",
              amount_due: due,
            });
          } else {
            existing.amount_due = Math.max(existing.amount_due, due);
            if (sale.customer_name) existing.customer_name = sale.customer_name;
            if (sale.sale_at && (!existing.recorded_at || sale.sale_at > existing.recorded_at)) {
              existing.recorded_at = sale.sale_at;
            }
          }
        }
      }
      setAllPosCredits(Array.from(posCreditMap.values()).sort((a, b) => (b.recorded_at || "").localeCompare(a.recorded_at || "")));

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
      setAllPosCredits([]);
      setInvoiceSettlement({});
    } finally {
      setLoading(false);
    }
  }, [orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const allDebtors = useMemo<DebtorReportRow[]>(() => {
    const invoiceRows = allInvoices.map((inv) => {
      const paid = invoiceSettlement[inv.id]?.paid ?? 0;
      const balance = invoiceBalanceDue(inv, invoiceSettlement);
      return {
        id: `invoice:${inv.id}`,
        source: "invoice" as const,
        reference: inv.invoice_number,
        customer_name: inv.customer_name || "",
        date: issueDateKey(inv.issue_date),
        status: displayInvoiceStatus(inv, invoiceSettlement),
        total: Number(inv.total ?? 0),
        paid,
        balance,
        invoice: inv,
      };
    });
    const posRows = allPosCredits.map((row) => ({
      id: `pos:${row.id}`,
      source: "pos_credit" as const,
      reference: row.reference,
      customer_name: row.customer_name || "",
      date: row.recorded_at ? issueDateKey(row.recorded_at) : "",
      status: "pos_credit" as const,
      total: Number(row.amount_due ?? 0),
      paid: 0,
      balance: Number(row.amount_due ?? 0),
    }));
    return [...invoiceRows, ...posRows].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [allInvoices, allPosCredits, invoiceSettlement]);

  const filteredDebtors = useMemo(() => {
    const invoices = applyInvoiceFilters(allInvoices, invoiceSettlement, {
      dateFrom,
      dateTo,
      customer: customerFilter,
      invoiceNumber: invoiceNumberFilter,
      status: statusFilter,
    });
    const visibleInvoiceIds = new Set(invoices.map((i) => `invoice:${i.id}`));
    const cust = customerFilter.trim().toLowerCase();
    const ref = invoiceNumberFilter.trim().toLowerCase();
    const from = dateFrom.trim();
    const to = dateTo.trim();
    return allDebtors.filter((row) => {
      if (row.source === "invoice") return visibleInvoiceIds.has(row.id);
      if (statusFilter !== "all") return false;
      if (from && row.date < from) return false;
      if (to && row.date > to) return false;
      if (cust && (row.customer_name || "").trim().toLowerCase() !== cust) return false;
      if (ref && (row.reference || "").trim().toLowerCase() !== ref) return false;
      return true;
    });
  }, [allDebtors, allInvoices, invoiceSettlement, dateFrom, dateTo, customerFilter, invoiceNumberFilter, statusFilter]);

  const hasActiveFilters =
    !!dateFrom.trim() ||
    !!dateTo.trim() ||
    !!customerFilter.trim() ||
    !!invoiceNumberFilter.trim() ||
    statusFilter !== "all";

  const totals = useMemo(() => {
    const totalAmount = filteredDebtors.reduce((sum, i) => sum + Number(i.total ?? 0), 0);
    const totalPaid = filteredDebtors.reduce((sum, i) => sum + Number(i.paid ?? 0), 0);
    const totalBalance = filteredDebtors.reduce((sum, i) => sum + Number(i.balance ?? 0), 0);
    const byStatus: Record<string, { total: number; count: number }> = {};
    filteredDebtors.forEach((i) => {
      const key = i.status;
      if (!byStatus[key]) byStatus[key] = { total: 0, count: 0 };
      byStatus[key].total += Number(i.total ?? 0);
      byStatus[key].count += 1;
    });
    return { totalAmount, totalPaid, totalBalance, invoiceCount: filteredDebtors.length, byStatus };
  }, [filteredDebtors]);

  const customerOptions = useMemo(() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const row of allDebtors) {
      const name = (row.customer_name || "").trim();
      if (!name) continue;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      labels.push(name);
    }
    return labels.sort((a, b) => a.localeCompare(b)).map((label) => ({ id: label, label }));
  }, [allDebtors]);

  const invoiceNumberOptions = useMemo(() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const row of allDebtors) {
      const num = (row.reference || "").trim();
      if (!num) continue;
      if (seen.has(num)) continue;
      seen.add(num);
      labels.push(num);
    }
    return labels.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((label) => ({
      id: label,
      label,
    }));
  }, [allDebtors]);

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setCustomerFilter("");
    setInvoiceNumberFilter("");
    setStatusFilter("all");
  };

  const downloadCsv = () => {
    const header = ["Source", "Reference", "Customer", "Date", "Status", "Amount", "Payment so far", "Balance"].join(",");
    const lines = filteredDebtors.map((i) => {
      const statusLabel = i.status === "pos_credit" ? "POS credit" : i.status;
      return [i.source === "invoice" ? "Invoice" : "POS credit", i.reference, i.customer_name, i.date, statusLabel, i.total, i.paid, i.balance]
        .map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`)
        .join(",");
    });
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `debtors_report_${new Date().toISOString().slice(0, 10)}.csv`;
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
            <h1 className="text-2xl font-bold text-slate-900">Debtors Report</h1>
            <PageNotes ariaLabel="Credit sales report help">
              <p>
                {hasActiveFilters
                  ? "Filtered debtor balances."
                  : "Includes sales invoices and POS credit sales, with the source shown on each row."}
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
            disabled={readOnly || filteredDebtors.length === 0}
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {!orgId && !superAdmin ? (
        <p className="text-amber-800 text-sm bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          Link your account to an organization to see debtor balances.
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
            <span className="text-slate-600">Reference</span>
            <div className="mt-1">
              <SearchableCombobox
                value={invoiceNumberFilter}
                onChange={(id) => setInvoiceNumberFilter(id)}
                options={invoiceNumberOptions}
                placeholder="Search or choose reference..."
                emptyOption={{ label: "All references" }}
                inputAriaLabel="Filter by debtor reference"
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
            {allDebtors.length === 0 ? "No debtor balances yet." : "No debtor balances match the current filters."}
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
                    <p className="text-[10px] text-slate-500">{v.count} row(s)</p>
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
              <th className="text-left p-3">Source</th>
              <th className="text-left p-3">Reference</th>
              <th className="text-left p-3">Customer</th>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Status</th>
              <th className="text-right p-3">Amount</th>
              <th className="text-right p-3">Payment so far</th>
              <th className="text-right p-3">Balance</th>
            </tr>
          </thead>
          <tbody>
            {allDebtors.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-500">
                  No debtor balances loaded.
                </td>
              </tr>
            ) : filteredDebtors.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-500">
                  No debtor balances match the current filters.
                </td>
              </tr>
            ) : (
              filteredDebtors.map((row) => {
                const disp = row.status;
                const statusClass =
                  disp === "paid"
                    ? "text-emerald-700 font-medium"
                    : disp === "overdue"
                      ? "text-amber-800 font-semibold"
                      : disp === "void"
                        ? "text-slate-400"
                        : "text-slate-800";
                return (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      row.source === "invoice" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
                    }`}>
                      {row.source === "invoice" ? "Invoice" : "POS credit"}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-xs font-medium">{row.reference}</td>
                  <td className="p-3 max-w-[220px] truncate">{row.customer_name || "—"}</td>
                  <td className="p-3">{row.date || "—"}</td>
                  <td className={`p-3 capitalize ${statusClass}`}>{disp === "pos_credit" ? "POS credit" : disp}</td>
                  <td className="p-3 text-right">
                    {onNavigate && row.source === "invoice" ? (
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
                        {formatMoney(row.total)}
                      </button>
                    ) : (
                      <span className="font-semibold text-slate-900">{formatMoney(row.total)}</span>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums text-slate-700">{formatMoney(row.paid)}</td>
                  <td className="p-3 text-right tabular-nums font-semibold text-slate-900">{formatMoney(row.balance)}</td>
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
