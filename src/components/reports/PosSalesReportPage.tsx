import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { formatPaymentMethodLabel } from "../../lib/paymentMethod";
import { PageNotes } from "../common/PageNotes";

type Basis = "accrual" | "cash";
type Department = { id: string; name: string };
type SalesRow = {
  id: string;
  occurredAt: string;
  reference: string;
  customer: string;
  departmentId: string | null;
  department: string;
  basisDetail: string;
  amount: number;
};
type SalesSortKey = "occurredAt" | "reference" | "customer" | "department" | "basisDetail" | "amount";

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

export function PosSalesReportPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [basis, setBasis] = useState<Basis>("accrual");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [rows, setRows] = useState<SalesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SalesSortKey; dir: "asc" | "desc" }>({ key: "occurredAt", dir: "desc" });

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

      const [departmentsRes, productsRes, paymentsRes] = await Promise.all([
        filterByOrganizationId(supabase.from("departments").select("id,name").order("name"), orgId, superAdmin),
        filterByOrganizationId(supabase.from("products").select("id,department_id,sales_price"), orgId, superAdmin),
        basis === "cash"
          ? filterByOrganizationId(
              supabase
                .from("payments")
                .select("id,transaction_id,paid_at,amount,payment_method,payment_source,payment_status")
                .eq("payment_status", "completed")
                .in("payment_source", ["pos_hotel", "pos_retail"])
                .not("transaction_id", "is", null)
                .gte("paid_at", fromIso)
                .lt("paid_at", toIso)
                .order("paid_at", { ascending: false }),
              orgId,
              superAdmin
            )
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (departmentsRes.error) throw departmentsRes.error;
      if (productsRes.error) throw productsRes.error;
      if (paymentsRes.error) throw paymentsRes.error;

      const departmentRows = (departmentsRes.data || []) as Department[];
      setDepartments(departmentRows);
      const departmentNameById = new Map(departmentRows.map((department) => [department.id, department.name]));
      const productById = new Map(
        ((productsRes.data || []) as Array<{ id: string; department_id: string | null; sales_price: number | null }>).map(
          (product) => [product.id, product]
        )
      );
      const payments = (paymentsRes.data || []) as Array<{
        id: string;
        transaction_id: string | null;
        paid_at: string;
        amount: number | null;
        payment_method: string | null;
        payment_source: string | null;
      }>;
      const cashTransactionIds = [...new Set(payments.map((payment) => baseTransactionId(payment.transaction_id)).filter(Boolean))];

      let retailQuery = filterByOrganizationId(
        supabase
          .from("retail_sales")
          .select("id,sale_at,customer_name,sale_status,retail_sale_lines(department_id,line_total)")
          .not("sale_status", "in", '("draft","void","queued_offline","refunded")'),
        orgId,
        superAdmin
      );
      let hotelQuery = filterByOrganizationId(
        supabase
          .from("kitchen_orders")
          .select("id,created_at,customer_name,table_number,order_status,kitchen_order_items(quantity,product_id)")
          .not("order_status", "in", '("cancelled","canceled","reversed","void","voided")'),
        orgId,
        superAdmin
      );
      if (basis === "cash") {
        if (cashTransactionIds.length === 0) {
          setRows([]);
          return;
        }
        retailQuery = retailQuery.in("id", cashTransactionIds);
        hotelQuery = hotelQuery.in("id", cashTransactionIds);
      } else {
        retailQuery = retailQuery.gte("sale_at", fromIso).lt("sale_at", toIso);
        hotelQuery = hotelQuery.gte("created_at", fromIso).lt("created_at", toIso);
      }

      const [retailRes, hotelRes] = await Promise.all([retailQuery, hotelQuery]);
      if (retailRes.error) throw retailRes.error;
      if (hotelRes.error) throw hotelRes.error;

      type TransactionSummary = {
        occurredAt: string;
        customer: string;
        departments: Map<string, { departmentId: string | null; department: string; amount: number }>;
      };
      const transactions = new Map<string, TransactionSummary>();
      const addDepartmentAmount = (
        transaction: TransactionSummary,
        departmentId: string | null,
        amount: number
      ) => {
        const key = departmentId || "unassigned";
        const current = transaction.departments.get(key) || {
          departmentId,
          department: departmentId ? departmentNameById.get(departmentId) || "Unassigned" : "Unassigned",
          amount: 0,
        };
        current.amount += amount;
        transaction.departments.set(key, current);
      };

      for (const sale of (retailRes.data || []) as Array<{
        id: string;
        sale_at: string;
        customer_name: string | null;
        retail_sale_lines: Array<{ department_id: string | null; line_total: number | null }> | null;
      }>) {
        const transaction: TransactionSummary = {
          occurredAt: sale.sale_at,
          customer: sale.customer_name || "Walk-in",
          departments: new Map(),
        };
        for (const line of sale.retail_sale_lines || []) {
          addDepartmentAmount(transaction, line.department_id, Number(line.line_total || 0));
        }
        transactions.set(sale.id, transaction);
      }

      for (const order of (hotelRes.data || []) as Array<{
        id: string;
        created_at: string;
        customer_name: string | null;
        table_number: string | null;
        kitchen_order_items: Array<{ quantity: number | null; product_id: string | null }> | null;
      }>) {
        const transaction: TransactionSummary = {
          occurredAt: order.created_at,
          customer: order.customer_name || (order.table_number ? `Table ${order.table_number}` : "Walk-in"),
          departments: new Map(),
        };
        for (const item of order.kitchen_order_items || []) {
          const product = item.product_id ? productById.get(item.product_id) : null;
          addDepartmentAmount(
            transaction,
            product?.department_id || null,
            Number(item.quantity || 0) * Number(product?.sales_price || 0)
          );
        }
        transactions.set(order.id, transaction);
      }

      const built: SalesRow[] = [];
      if (basis === "accrual") {
        for (const [transactionId, transaction] of transactions) {
          for (const department of transaction.departments.values()) {
            built.push({
              id: `${transactionId}-${department.departmentId || "unassigned"}`,
              occurredAt: transaction.occurredAt,
              reference: transactionId.slice(0, 8),
              customer: transaction.customer,
              departmentId: department.departmentId,
              department: department.department,
              basisDetail: "POS sale",
              amount: department.amount,
            });
          }
        }
      } else {
        for (const payment of payments) {
          const transactionId = baseTransactionId(payment.transaction_id);
          const transaction = transactions.get(transactionId);
          if (!transaction) continue;
          const transactionTotal = [...transaction.departments.values()].reduce((sum, department) => sum + department.amount, 0);
          if (transactionTotal <= 0) continue;
          for (const department of transaction.departments.values()) {
            built.push({
              id: `${payment.id}-${department.departmentId || "unassigned"}`,
              occurredAt: payment.paid_at,
              reference: transactionId.slice(0, 8),
              customer: transaction.customer,
              departmentId: department.departmentId,
              department: department.department,
              basisDetail: formatPaymentMethodLabel(payment.payment_method || "other"),
              amount: Number(payment.amount || 0) * (department.amount / transactionTotal),
            });
          }
        }
      }
      built.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
      setRows(built);
    } catch (e) {
      console.error("[POS sales report]", e);
      setRows([]);
      setError(e instanceof Error ? e.message : "Failed to load POS sales report.");
    } finally {
      setLoading(false);
    }
  }, [orgId, superAdmin, dateRange, customFrom, customTo, basis]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => (departmentFilter === "all" ? rows : rows.filter((row) => (row.departmentId || "unassigned") === departmentFilter)),
    [rows, departmentFilter]
  );
  const sorted = useMemo(() => {
    const direction = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === "amount") return (a.amount - b.amount) * direction;
      return String(a[sort.key] || "").localeCompare(String(b[sort.key] || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      }) * direction;
    });
  }, [filtered, sort]);
  const total = useMemo(() => filtered.reduce((sum, row) => sum + row.amount, 0), [filtered]);
  const transactionCount = useMemo(() => new Set(filtered.map((row) => row.reference)).size, [filtered]);

  const exportCsv = () => {
    const header = ["Date/time", "Reference", "Customer", "Department", basis === "cash" ? "Payment method" : "Basis", "Amount"];
    const detail = sorted.map((row) => [
      formatDateTime(row.occurredAt),
      row.reference,
      row.customer,
      row.department,
      row.basisDetail,
      row.amount.toFixed(2),
    ]);
    const csv = [header, ...detail, ["", "", "", "", "Total", total.toFixed(2)]]
      .map((line) => line.map(csvCell).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pos_sales_${basis}_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const toggleSort = (key: SalesSortKey) => {
    setSort((current) => current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  };
  const SortIcon = ({ column }: { column: SalesSortKey }) => {
    if (sort.key !== column) return <ArrowUpDown className="h-4 w-4 text-slate-400" aria-hidden />;
    return sort.dir === "asc"
      ? <ArrowUp className="h-4 w-4 text-slate-700" aria-hidden />
      : <ArrowDown className="h-4 w-4 text-slate-700" aria-hidden />;
  };
  const sortHeader = (key: SalesSortKey, label: string, align: "left" | "right" = "left") => (
    <th className={`p-3 text-${align}`} aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => toggleSort(key)} className={`inline-flex w-full items-center gap-1 hover:text-slate-950 ${align === "right" ? "justify-end" : ""}`}>
        {label}<SortIcon column={key} />
      </button>
    </th>
  );

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Sales report</h1>
          <PageNotes ariaLabel="Sales report help">
            <p>Accrual uses the POS sale date and full sale value. Cash uses completed POS payments and payment dates.</p>
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
        <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="accrual">Accrual basis</option>
          <option value="cash">Cash basis</option>
        </select>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading ? (
        <p className="py-4 text-slate-500">Loading POS sales...</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="app-card p-4"><p className="text-xs text-slate-500">Sales total</p><p className="text-2xl font-bold text-slate-900">{formatMoney(total)}</p></div>
            <div className="app-card p-4"><p className="text-xs text-slate-500">POS transactions</p><p className="text-2xl font-bold text-slate-900">{transactionCount}</p></div>
            <div className="app-card p-4"><p className="text-xs text-slate-500">Basis</p><p className="text-2xl font-bold capitalize text-slate-900">{basis}</p></div>
          </div>
          <div className="app-card overflow-x-auto">
            <table className="w-full min-w-[850px] text-sm">
              <thead className="bg-slate-50"><tr>{sortHeader("occurredAt", "Date/time")}{sortHeader("reference", "Reference")}{sortHeader("customer", "Customer")}{sortHeader("department", "Department")}{sortHeader("basisDetail", basis === "cash" ? "Payment method" : "Basis")}{sortHeader("amount", "Amount", "right")}</tr></thead>
              <tbody>
                {sorted.length === 0 ? <tr><td colSpan={6} className="p-8 text-center text-slate-500">No matching POS sales.</td></tr> : sorted.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap p-3">{formatDateTime(row.occurredAt)}</td><td className="p-3 font-mono">{row.reference}</td><td className="p-3">{row.customer}</td><td className="p-3">{row.department}</td><td className="p-3">{row.basisDetail}</td><td className="p-3 text-right font-medium tabular-nums">{formatMoney(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
