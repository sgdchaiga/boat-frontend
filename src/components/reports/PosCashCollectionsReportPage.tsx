import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { PageNotes } from "../common/PageNotes";

type Department = { id: string; name: string };
type CollectionRow = {
  id: string;
  occurredAt: string;
  reference: string;
  customer: string;
  departmentId: string | null;
  department: string;
  totalSales: number;
  paid: number;
  notPaid: number;
  recoveredDebt: number;
};

function baseTransactionId(value: string | null) {
  return String(value || "").split("[", 1)[0].trim();
}

function formatMoney(amount: number) {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-UG", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function PosCashCollectionsReportPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!orgId && !superAdmin) {
        setRows([]);
        setError("Missing organization on your staff profile. Contact admin to link your account.");
        return;
      }
      const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
      const fromIso = from.toISOString();
      const toIso = to.toISOString();

      const [departmentsRes, salesRes, paymentsRes] = await Promise.all([
        filterByOrganizationId(supabase.from("departments").select("id,name").order("name"), orgId, superAdmin),
        filterByOrganizationId(
          supabase
            .from("retail_sales")
            .select("id,sale_at,customer_name,total_amount,amount_due,sale_status,retail_sale_lines(department_id,line_total)")
            .gte("sale_at", fromIso)
            .lt("sale_at", toIso)
            .not("sale_status", "in", '("draft","void","queued_offline","refunded")'),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(
          supabase
            .from("payments")
            .select("id,transaction_id,paid_at,amount,payment_source,payment_status")
            .eq("payment_status", "completed")
            .in("payment_source", ["pos_retail", "pos_clinic"])
            .not("transaction_id", "is", null)
            .gte("paid_at", fromIso)
            .lt("paid_at", toIso),
          orgId,
          superAdmin
        ),
      ]);
      if (departmentsRes.error) throw departmentsRes.error;
      if (salesRes.error) throw salesRes.error;
      if (paymentsRes.error) throw paymentsRes.error;

      const departmentRows = (departmentsRes.data || []) as Department[];
      setDepartments(departmentRows);
      const departmentNameById = new Map(departmentRows.map((department) => [department.id, department.name]));
      const sales = (salesRes.data || []) as Array<{
        id: string;
        sale_at: string;
        customer_name: string | null;
        total_amount: number | null;
        amount_due: number | null;
        retail_sale_lines: Array<{ department_id: string | null; line_total: number | null }> | null;
      }>;
      const payments = (paymentsRes.data || []) as Array<{
        id: string;
        transaction_id: string | null;
        paid_at: string;
        amount: number | null;
      }>;

      const saleById = new Map(sales.map((sale) => [sale.id, sale]));
      const paymentSaleIds = [...new Set(payments.map((payment) => baseTransactionId(payment.transaction_id)).filter(Boolean))];
      const recoverySaleIds = paymentSaleIds.filter((saleId) => !saleById.has(saleId));
      const recoverySalesRes = recoverySaleIds.length
        ? await filterByOrganizationId(
            supabase
              .from("retail_sales")
              .select("id,sale_at,customer_name,total_amount,retail_sale_lines(department_id,line_total)")
              .in("id", recoverySaleIds),
            orgId,
            superAdmin
          )
        : { data: [], error: null };
      if (recoverySalesRes.error) throw recoverySalesRes.error;

      const recoverySaleById = new Map(
        ((recoverySalesRes.data || []) as Array<{
          id: string;
          sale_at: string;
          customer_name: string | null;
          total_amount: number | null;
          retail_sale_lines: Array<{ department_id: string | null; line_total: number | null }> | null;
        }>).map((sale) => [sale.id, sale])
      );
      const paymentsBySaleId = new Map<string, Array<{ id: string; paidAt: string; amount: number }>>();
      payments.forEach((payment) => {
        const saleId = baseTransactionId(payment.transaction_id);
        if (!saleId) return;
        const list = paymentsBySaleId.get(saleId) || [];
        list.push({ id: payment.id, paidAt: payment.paid_at, amount: Number(payment.amount || 0) });
        paymentsBySaleId.set(saleId, list);
      });
      const buildDepartmentShares = (
        lines: Array<{ department_id: string | null; line_total: number | null }> | null,
        fallbackTotal: number
      ) => {
        const totals = new Map<string, { departmentId: string | null; department: string; amount: number }>();
        for (const line of lines || []) {
          const departmentId = line.department_id || null;
          const key = departmentId || "unassigned";
          const current = totals.get(key) || {
            departmentId,
            department: departmentId ? departmentNameById.get(departmentId) || "Unassigned" : "Unassigned",
            amount: 0,
          };
          current.amount += Number(line.line_total || 0);
          totals.set(key, current);
        }
        const lineTotal = [...totals.values()].reduce((sum, row) => sum + row.amount, 0);
        if (lineTotal > 0) return [...totals.values()].map((row) => ({ ...row, share: row.amount / lineTotal }));
        return [{ departmentId: null, department: "Unassigned", amount: fallbackTotal, share: 1 }];
      };

      const built: CollectionRow[] = [];
      for (const sale of sales) {
        const saleTotal = Number(sale.total_amount || 0);
        const paidInPeriod = (paymentsBySaleId.get(sale.id) || []).reduce((sum, payment) => sum + payment.amount, 0);
        const notPaid = Math.max(0, Number(sale.amount_due || 0));
        for (const department of buildDepartmentShares(sale.retail_sale_lines, saleTotal)) {
          built.push({
            id: `${sale.id}-${department.departmentId || "unassigned"}`,
            occurredAt: sale.sale_at,
            reference: sale.id.slice(0, 8),
            customer: sale.customer_name || "Walk-in",
            departmentId: department.departmentId,
            department: department.department,
            totalSales: saleTotal * department.share,
            paid: paidInPeriod * department.share,
            notPaid: notPaid * department.share,
            recoveredDebt: 0,
          });
        }
      }
      for (const payment of payments) {
        const saleId = baseTransactionId(payment.transaction_id);
        const sale = recoverySaleById.get(saleId);
        if (!sale || sale.sale_at >= fromIso) continue;
        const amount = Number(payment.amount || 0);
        for (const department of buildDepartmentShares(sale.retail_sale_lines, Number(sale.total_amount || amount))) {
          built.push({
            id: `${payment.id}-${department.departmentId || "unassigned"}`,
            occurredAt: payment.paid_at,
            reference: sale.id.slice(0, 8),
            customer: sale.customer_name || "Walk-in",
            departmentId: department.departmentId,
            department: department.department,
            totalSales: 0,
            paid: 0,
            notPaid: 0,
            recoveredDebt: amount * department.share,
          });
        }
      }
      built.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
      setRows(built);
    } catch (e) {
      console.error("[POS cash collections report]", e);
      setRows([]);
      setError(e instanceof Error ? e.message : "Failed to load POS cash collections report.");
    } finally {
      setLoading(false);
    }
  }, [orgId, superAdmin, dateRange, customFrom, customTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => (departmentFilter === "all" ? rows : rows.filter((row) => (row.departmentId || "unassigned") === departmentFilter)),
    [rows, departmentFilter]
  );
  const totals = useMemo(
    () =>
      filtered.reduce(
        (sum, row) => ({
          totalSales: sum.totalSales + row.totalSales,
          paid: sum.paid + row.paid,
          notPaid: sum.notPaid + row.notPaid,
          recoveredDebt: sum.recoveredDebt + row.recoveredDebt,
        }),
        { totalSales: 0, paid: 0, notPaid: 0, recoveredDebt: 0 }
      ),
    [filtered]
  );
  const cashCollected = totals.paid + totals.recoveredDebt;

  const exportCsv = () => {
    const header = ["Date/time", "Reference", "Customer", "Department", "Total sales", "Paid", "Not paid", "Recovered debts", "Cash collected"];
    const detail = filtered.map((row) => [
      formatDateTime(row.occurredAt),
      row.reference,
      row.customer,
      row.department,
      row.totalSales.toFixed(2),
      row.paid.toFixed(2),
      row.notPaid.toFixed(2),
      row.recoveredDebt.toFixed(2),
      (row.paid + row.recoveredDebt).toFixed(2),
    ]);
    const totalLine = [
      "",
      "",
      "",
      "Total",
      totals.totalSales.toFixed(2),
      totals.paid.toFixed(2),
      totals.notPaid.toFixed(2),
      totals.recoveredDebt.toFixed(2),
      cashCollected.toFixed(2),
    ];
    const csv = [header, ...detail, totalLine].map((line) => line.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pos_cash_collections_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">POS cash collections</h1>
          <PageNotes ariaLabel="POS cash collections help">
            <p>Shows sale-period paid amounts, unpaid balances, and recovered debts by payment date.</p>
          </PageNotes>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <div className="mb-6 flex flex-wrap gap-4">
        <select value={dateRange} onChange={(e) => setDateRange(e.target.value as DateRangeKey)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="this_week">This week</option>
          <option value="this_month">This month</option>
          <option value="this_quarter">This quarter</option>
          <option value="this_year">This year</option>
          <option value="last_week">Last week</option>
          <option value="last_month">Last month</option>
          <option value="last_quarter">Last quarter</option>
          <option value="last_year">Last year</option>
          <option value="custom">Custom</option>
        </select>
        {dateRange === "custom" && (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </>
        )}
        <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="all">All departments</option>
          {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          <option value="unassigned">Unassigned</option>
        </select>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading ? (
        <p className="py-4 text-slate-500">Loading POS cash collections...</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <div className="app-card p-4">
              <p className="text-xs text-slate-500">Total sales</p>
              <p className="text-2xl font-bold text-slate-900">{formatMoney(totals.totalSales)}</p>
            </div>
            <div className="app-card p-4">
              <p className="text-xs text-slate-500">Paid</p>
              <p className="text-2xl font-bold text-emerald-700">{formatMoney(totals.paid)}</p>
            </div>
            <div className="app-card p-4">
              <p className="text-xs text-slate-500">Not paid</p>
              <p className="text-2xl font-bold text-amber-700">{formatMoney(totals.notPaid)}</p>
            </div>
            <div className="app-card p-4">
              <p className="text-xs text-slate-500">Recovered debts</p>
              <p className="text-2xl font-bold text-sky-700">{formatMoney(totals.recoveredDebt)}</p>
            </div>
            <div className="app-card p-4">
              <p className="text-xs text-slate-500">Cash collected</p>
              <p className="text-2xl font-bold text-slate-900">{formatMoney(cashCollected)}</p>
            </div>
          </div>

          <div className="app-card overflow-x-auto">
            <table className="w-full min-w-[1050px] text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-3 text-left">Date/time</th>
                  <th className="p-3 text-left">Reference</th>
                  <th className="p-3 text-left">Customer</th>
                  <th className="p-3 text-left">Department</th>
                  <th className="p-3 text-right">Total sales</th>
                  <th className="p-3 text-right">Paid</th>
                  <th className="p-3 text-right">Not paid</th>
                  <th className="p-3 text-right">Recovered debts</th>
                  <th className="p-3 text-right">Cash collected</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-500">No POS cash collections for this period.</td>
                  </tr>
                ) : (
                  filtered.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="whitespace-nowrap p-3">{formatDateTime(row.occurredAt)}</td>
                      <td className="p-3 font-mono">{row.reference}</td>
                      <td className="p-3">{row.customer}</td>
                      <td className="p-3">{row.department}</td>
                      <td className="p-3 text-right tabular-nums">{formatMoney(row.totalSales)}</td>
                      <td className="p-3 text-right tabular-nums">{formatMoney(row.paid)}</td>
                      <td className="p-3 text-right tabular-nums">{formatMoney(row.notPaid)}</td>
                      <td className="p-3 text-right tabular-nums">{formatMoney(row.recoveredDebt)}</td>
                      <td className="p-3 text-right font-medium tabular-nums">{formatMoney(row.paid + row.recoveredDebt)}</td>
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
