import { useEffect, useState } from "react";
import { Receipt, Download, RefreshCw } from "lucide-react";
import { supabase } from "../lib/supabase";
import { computeRangeInTimezone, toBusinessDateString, type DateRangeKey } from "../lib/timezone";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { formatPaymentMethodLabel, normalizePaymentMethod } from "../lib/paymentMethod";
import {
  buildInvoiceSettlementMap,
    invoiceBalanceDue,
    parseInvoiceAllocationsJson,
    type InvoiceSettlementMap,
} from "../lib/invoicePaymentAllocations";
import { PageNotes } from "./common/PageNotes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

interface TransactionRow {
  date: string;
  customer: string;
  department: string;
  source: "Hotel POS" | "Retail POS" | "Billing" | "Invoice";
  orderId: string;
  sourceId: string;
  description: string;
  quantity: number;
  amount: number;
  paymentMethod: string;
  /** Retail customer id when source is Invoice (for customer filter). */
  retailCustomerId?: string | null;
  /** Present for Invoice rows — used for payment-method filter. */
  invoiceId?: string;
}

type PaymentRow = {
  id: string;
  transaction_id: string | null;
  payment_method: string;
  amount: number;
  payment_status?: string | null;
  invoice_allocations?: unknown;
};

function invoicePaymentMethodLabels(invoiceId: string, payments: PaymentRow[]): string {
  const labels = new Set<string>();
  for (const p of payments) {
    if (p.payment_status && p.payment_status !== "completed") continue;
    for (const s of parseInvoiceAllocationsJson(p.invoice_allocations)) {
      if (s.invoice_id === invoiceId) {
        labels.add(formatPaymentMethodLabel(p.payment_method));
        break;
      }
    }
  }
  if (labels.size === 0) return "—";
  return [...labels].join(", ");
}

function invoiceMatchesPaymentFilter(invoiceId: string, payments: PaymentRow[], filterMethod: string): boolean {
  if (!filterMethod) return true;
  for (const p of payments) {
    if (p.payment_status && p.payment_status !== "completed") continue;
    if (normalizePaymentMethod(p.payment_method) !== filterMethod) continue;
    for (const s of parseInvoiceAllocationsJson(p.invoice_allocations)) {
      if (s.invoice_id === invoiceId) return true;
    }
  }
  return false;
}

/** Match POS/billing display label (e.g. "Cash") to filter code (e.g. cash). */
function displayPaymentMatchesFilter(displayLabel: string, filterCode: string): boolean {
  if (!filterCode) return true;
  const d = displayLabel.toLowerCase();
  switch (filterCode) {
    case "cash":
      return d.includes("cash") && !d.includes("mobile") && !d.includes("airtel");
    case "card":
      return d.includes("card");
    case "bank_transfer":
      return d.includes("bank");
    case "mtn_mobile_money":
      return d.includes("mtn");
    case "airtel_money":
      return d.includes("airtel");
    default:
      return normalizePaymentMethod(displayLabel) === filterCode;
  }
}

export function TransactionsPage({ highlightTransactionId }: { highlightTransactionId?: string }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [dateRange, setDateRange] = useState<DateRangeKey>("last_24_hours");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetchTransactions();
  }, [dateRange, customFrom, customTo, customerId, departmentId, paymentMethod, orgId, superAdmin]);

  useEffect(() => {
    const interval = setInterval(fetchTransactions, 30000);
    return () => clearInterval(interval);
  }, [dateRange, customFrom, customTo, customerId, departmentId, paymentMethod, orgId, superAdmin]);

  const fetchTransactions = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
      const fromStr = from.toISOString();
      const toStr = to.toISOString();
      const issueFromKey = toBusinessDateString(from);
      const issueToKey = toBusinessDateString(new Date(to.getTime() - 1));

      const [
        ordersRes,
        billingRes,
        paymentsRes,
        customersRes,
        retailCustomersRes,
        deptRes,
        productsRes,
        retailMovesRes,
        invoicesRes,
      ] = await Promise.all([
        filterByOrganizationId(
          supabase
            .from("kitchen_orders")
            .select(
              `
            id,
            customer_name,
            created_at,
            kitchen_order_items(quantity, notes, product_id)
          `
            )
            .gte("created_at", fromStr)
            .lt("created_at", toStr)
            .order("created_at", { ascending: true }),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(
          supabase
            .from("billing")
            .select("id, description, amount, charge_type, charged_at, stays(hotel_customers(first_name, last_name))")
            .gte("charged_at", fromStr)
            .lt("charged_at", toStr)
            .order("charged_at", { ascending: true }),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(
          supabase
            .from("payments")
            .select("id, transaction_id, payment_method, amount, payment_status, invoice_allocations")
            .eq("payment_status", "completed"),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(supabase.from("hotel_customers").select("id, first_name, last_name").order("first_name"), orgId, superAdmin),
        filterByOrganizationId(supabase.from("retail_customers").select("id, name").order("name"), orgId, superAdmin),
        filterByOrganizationId(supabase.from("departments").select("id, name").order("name"), orgId, superAdmin),
        filterByOrganizationId(supabase.from("products").select("id, name, department_id, sales_price"), orgId, superAdmin),
        filterByOrganizationId(
          supabase
            .from("product_stock_movements")
            .select("product_id, source_id, quantity_out, movement_date, source_type")
            .eq("source_type", "sale")
            .gt("quantity_out", 0)
            .gte("movement_date", fromStr)
            .lt("movement_date", toStr)
            .order("movement_date", { ascending: true }),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(
          sb
            .from("retail_invoices")
            .select(
              `
            id,
            invoice_number,
            customer_name,
            customer_id,
            issue_date,
            status,
            total,
            retail_invoice_lines (
              id,
              line_no,
              description,
              product_id,
              quantity,
              unit_price,
              line_total
            )
          `
            )
            .gte("issue_date", issueFromKey)
            .lte("issue_date", issueToKey)
            .neq("status", "void")
            .order("issue_date", { ascending: true }),
          orgId,
          superAdmin
        ),
      ]);

      if (ordersRes.error) {
        setFetchError(ordersRes.error.message || "Failed to load POS orders");
      }
      if (invoicesRes.error) {
        console.warn("[Transactions] retail_invoices:", invoicesRes.error.message);
      }

      const orders = (ordersRes.data || []) as any[];
      const billings = (billingRes.data || []) as any[];
      const payments = (paymentsRes.data || []) as PaymentRow[];
      const customersList = (customersRes.data || []) as { id: string; first_name: string; last_name: string }[];
      const retailCustomersList = (retailCustomersRes.data || []) as { id: string; name: string }[];
      const deptList = (deptRes.data || []) as { id: string; name: string }[];
      const productsList = (productsRes?.data || []) as { id: string; name: string; department_id: string | null; sales_price: number | null }[];
      const retailMoves = (retailMovesRes.data || []) as Array<{
        product_id: string;
        source_id: string | null;
        quantity_out: number | null;
        movement_date: string;
        source_type: string | null;
      }>;
      const productMap = Object.fromEntries(productsList.map((p) => [p.id, p]));

      const chargeTypeOptions = [
        { id: "charge_room", name: "Room" },
        { id: "charge_service", name: "Service" },
        { id: "charge_food", name: "Food" },
        { id: "charge_other", name: "Other" },
      ];
      const deptListWithChargeTypes = [...deptList];
      chargeTypeOptions.forEach((ct) => {
        if (!deptListWithChargeTypes.some((d) => d.name === ct.name)) {
          deptListWithChargeTypes.push(ct);
        }
      });
      if (!deptListWithChargeTypes.some((d) => d.name === "Invoice")) {
        deptListWithChargeTypes.push({ id: "__invoice_source__", name: "Invoice" });
      }
      setCustomers([
        ...customersList,
        ...retailCustomersList.map((r) => ({
          id: `retail:${r.id}`,
          first_name: r.name,
          last_name: "",
        })),
      ]);
      setDepartments(deptListWithChargeTypes);

      const invoiceSettlement: InvoiceSettlementMap = buildInvoiceSettlementMap(payments);

      const paymentByTransactionId: Record<string, string> = {};
      const paymentAmountByTransactionId: Record<string, number> = {};
      payments.forEach((p) => {
        if (p.transaction_id) {
          if (!paymentByTransactionId[p.transaction_id]) {
            paymentByTransactionId[p.transaction_id] = formatPaymentMethodLabel(p.payment_method);
          }
          paymentAmountByTransactionId[p.transaction_id] = (paymentAmountByTransactionId[p.transaction_id] || 0) + Number(p.amount || 0);
        }
      });

      const depMap = Object.fromEntries(deptList.map((d) => [d.id, d.name]));
      const transactionRows: TransactionRow[] = [];
      const kitchenOrderIdSet = new Set<string>(orders.map((o: any) => String(o.id)));

      orders.forEach((order) => {
        const customer = order.customer_name || "Walk-in";
        const orderIdShort = order.id.slice(0, 8);
        const method = paymentByTransactionId[order.id] || "—";
        const items = order.kitchen_order_items || [];
        items.forEach((item: any) => {
          const product = item.product_id ? productMap[item.product_id] : null;
          const depId = product?.department_id ?? null;
          const departmentName = depId ? depMap[depId] || "Unassigned" : "Unassigned";
          const price = Number(product?.sales_price ?? 0);
          const qty = Number(item.quantity ?? 0);
          transactionRows.push({
            date: new Date(order.created_at).toLocaleDateString(),
            customer,
            department: departmentName,
            source: "Hotel POS",
            orderId: orderIdShort,
            sourceId: order.id,
            description: product?.name ?? "Item",
            quantity: qty,
            amount: qty * price,
            paymentMethod: method,
          });
        });
        if (items.length === 0) {
          const paidAmount = paymentAmountByTransactionId[order.id] ?? 0;
          transactionRows.push({
            date: new Date(order.created_at).toLocaleDateString(),
            customer,
            department: "POS",
            source: "Hotel POS",
            orderId: orderIdShort,
            sourceId: order.id,
            description: paidAmount > 0 ? "POS Order" : "POS Order (no line items)",
            quantity: 1,
            amount: paidAmount,
            paymentMethod: method,
          });
        }
      });

      // Retail sales are sale movements whose source_id does not exist in kitchen_orders.
      // (Hotel POS uses kitchen_orders; retail POS writes sale movements directly.)
      retailMoves.forEach((mv, index) => {
        const sourceIdRaw = mv.source_id ? String(mv.source_id) : "";
        // Keep rows even when source_id is missing so report quantity matches stock movements.
        const sourceId = sourceIdRaw || `retail-move-${mv.product_id || "unknown"}-${mv.movement_date}-${index}`;
        if (sourceIdRaw && kitchenOrderIdSet.has(sourceIdRaw)) return;
        const qty = Number(mv.quantity_out ?? 0);
        if (qty <= 0) return;
        const product = mv.product_id ? productMap[mv.product_id] : null;
        const depId = product?.department_id ?? null;
        const departmentName = depId ? depMap[depId] || "Unassigned" : "Unassigned";
        const unitPrice = Number(product?.sales_price ?? 0);
        transactionRows.push({
          date: new Date(mv.movement_date).toLocaleDateString(),
          customer: "Walk-in",
          department: departmentName,
          source: "Retail POS",
          orderId: sourceId.slice(0, 8),
          sourceId,
          description: product?.name || "Unknown product",
          quantity: qty,
          amount: qty * unitPrice,
          paymentMethod: paymentByTransactionId[sourceIdRaw || sourceId] || "—",
        });
      });

      billings.forEach((b: any) => {
        const customer = b.stays?.hotel_customers
          ? `${b.stays.hotel_customers.first_name || ""} ${b.stays.hotel_customers.last_name || ""}`.trim()
          : b.stay_id ? "—" : "Walk-in / No stay";
        const departmentName =
          typeof b.charge_type === "string"
            ? b.charge_type.charAt(0).toUpperCase() + b.charge_type.slice(1)
            : "Other";
        transactionRows.push({
          date: new Date(b.charged_at).toLocaleDateString(),
          customer,
          department: departmentName,
          source: "Billing",
          orderId: b.id.slice(0, 8),
          sourceId: b.id,
          description: b.description || "Charge",
          quantity: 1,
          amount: Number(b.amount ?? 0),
          paymentMethod: paymentByTransactionId[b.id] || "—",
        });
      });

      const invoicesData = (invoicesRes.data || []) as Array<{
        id: string;
        invoice_number: string;
        customer_name: string;
        customer_id: string | null;
        issue_date: string;
        total: number;
        retail_invoice_lines: Array<{
          id: string;
          line_no: number;
          description: string;
          product_id: string | null;
          quantity: number;
          unit_price: number;
          line_total: number;
        }>;
      }>;

      for (const inv of invoicesData) {
        const lines = inv.retail_invoice_lines || [];
        const invBal = invoiceBalanceDue(
          { id: inv.id, total: Number(inv.total ?? 0) },
          invoiceSettlement
        );
        const methodLabels = invoicePaymentMethodLabels(inv.id, payments);
        let paymentStr = methodLabels;
        if (invBal > 0.01) {
          paymentStr =
            methodLabels === "—" ? `Unpaid (${invBal.toFixed(2)})` : `${methodLabels} · ${invBal.toFixed(2)} due`;
        } else if (methodLabels === "—") {
          paymentStr = "Paid";
        }

        const invDate = new Date(
          String(inv.issue_date).includes("T") ? inv.issue_date : `${inv.issue_date}T12:00:00`
        ).toLocaleDateString();

        if (lines.length === 0) {
          transactionRows.push({
            date: invDate,
            customer: inv.customer_name || "—",
            department: "Invoice",
            source: "Invoice",
            orderId: inv.invoice_number || inv.id.slice(0, 8),
            sourceId: `${inv.id}:no-lines`,
            description: "Invoice (no line items)",
            quantity: 1,
            amount: Number(inv.total ?? 0),
            paymentMethod: paymentStr,
            retailCustomerId: inv.customer_id,
            invoiceId: inv.id,
          });
          continue;
        }

        for (const line of lines) {
          const product = line.product_id ? productMap[line.product_id] : null;
          const depId = product?.department_id ?? null;
          const departmentName = depId ? depMap[depId] || "Unassigned" : "Unassigned";
          const qty = Number(line.quantity ?? 0);
          const total = Number(line.line_total ?? 0);
          transactionRows.push({
            date: invDate,
            customer: inv.customer_name || "—",
            department: departmentName,
            source: "Invoice",
            orderId: inv.invoice_number || inv.id.slice(0, 8),
            sourceId: `${inv.id}:${line.id}`,
            description: line.description || product?.name || "Line",
            quantity: qty,
            amount: total,
            paymentMethod: paymentStr,
            retailCustomerId: inv.customer_id,
            invoiceId: inv.id,
          });
        }
      }

      transactionRows.sort((a, b) => {
        const d = new Date(a.date).getTime() - new Date(b.date).getTime();
        return d !== 0 ? d : a.orderId.localeCompare(b.orderId);
      });

      let filtered = transactionRows;
      if (customerId) {
        if (customerId.startsWith("retail:")) {
          const rid = customerId.slice(7);
          filtered = filtered.filter((r) => r.retailCustomerId === rid);
        } else {
          const g = customersList.find((x) => x.id === customerId);
          const name = g ? `${g.first_name} ${g.last_name}`.trim() : "";
          filtered = filtered.filter((r) => r.customer === name);
        }
      }
      if (departmentId) {
        const depName = deptListWithChargeTypes.find((d) => d.id === departmentId)?.name ?? "";
        filtered = filtered.filter((r) => r.department === depName);
      }
      if (paymentMethod) {
        filtered = filtered.filter((r) => {
          if (r.invoiceId) {
            return invoiceMatchesPaymentFilter(r.invoiceId, payments, paymentMethod);
          }
          return displayPaymentMatchesFilter(r.paymentMethod, paymentMethod);
        });
      }

      setRows(filtered);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load transactions";
      setFetchError(msg);
      setRows([]);
      console.error("Error fetching transactions:", e);
    } finally {
      setLoading(false);
    }
  };

  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);

  const runningBalance = (() => {
    let bal = 0;
    return rows.map((r) => {
      bal += r.amount;
      return bal;
    });
  })();

  const exportDailySalesReport = () => {
    const headers = ["Date", "Customer", "Department", "Source", "Order #", "Description", "Qty", "Amount", "Balance", "Payment method"];
    const csv = [
      headers.join(","),
      ...rows.map((r, i) =>
        [r.date, r.customer, r.department, r.source, r.orderId, `"${r.description}"`, r.quantity, r.amount.toFixed(2), runningBalance[i].toFixed(2), r.paymentMethod].join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "daily_sales_report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Transactions</h1>
            <PageNotes ariaLabel="Transactions help">
              <p>POS, billing, and retail invoice lines (Uganda GMT+3) — use filters for daily sales export.</p>
            </PageNotes>
          </div>
        </div>
        <button
          onClick={() => fetchTransactions()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 text-sm font-medium"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {fetchError && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
          {fetchError}
        </div>
      )}

      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Date</span>
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="last_24_hours">Last 24 hours</option>
            <option value="last_7_days">Last 7 days</option>
            <option value="last_30_days">Last 30 days</option>
            <option value="today">Today (Uganda)</option>
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
        </div>
        {dateRange === "custom" && (
          <div className="flex gap-2 items-center">
            <input
              type="date"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <span className="text-slate-500 text-sm">to</span>
            <input
              type="date"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Customer</span>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm min-w-[160px]"
          >
            <option value="">All</option>
            {customers.map((g) => (
              <option key={g.id} value={g.id}>
                {g.first_name} {g.last_name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Department</span>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm min-w-[140px]"
          >
            <option value="">All</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Payment method</span>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="bank_transfer">Bank transfer</option>
          </select>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white p-6 rounded-xl border">
          <div className="flex items-center gap-2 mb-2">
            <Receipt className="w-5 h-5 text-blue-600" />
            <p>Total (filtered)</p>
          </div>
          <p className="text-2xl font-bold">{totalAmount.toFixed(2)}</p>
        </div>
        <div className="bg-white p-6 rounded-xl border flex items-center justify-between">
          <div>
            <p className="text-slate-600 mb-1">Export report</p>
            <p className="text-sm text-slate-500">Generate daily sales report CSV</p>
          </div>
          <button
            onClick={exportDailySalesReport}
            disabled={rows.length === 0}
            className="flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-5 h-5" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Customer</th>
              <th className="text-left p-3">Department</th>
              <th className="text-left p-3">Source</th>
              <th className="text-left p-3">Order #</th>
              <th className="text-left p-3">Description</th>
              <th className="text-right p-3">Qty</th>
              <th className="text-right p-3">Amount</th>
              <th className="text-right p-3">Balance</th>
              <th className="text-left p-3">Payment</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="p-6 text-slate-500 text-center">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-6 text-slate-500 text-center">
                  No transactions for the selected filters.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr
                  key={`${r.sourceId}-${i}`}
                  className={`border-t hover:bg-slate-50 ${
                    highlightTransactionId && r.sourceId === highlightTransactionId
                      ? "bg-amber-50 ring-1 ring-amber-300"
                      : ""
                  }`}
                >
                  <td className="p-3">{r.date}</td>
                  <td className="p-3">{r.customer}</td>
                  <td className="p-3">{r.department}</td>
                  <td className="p-3">{r.source}</td>
                  <td className="p-3 font-mono">{r.orderId}</td>
                  <td className="p-3">{r.description}</td>
                  <td className="p-3 text-right">{r.quantity}</td>
                  <td className="p-3 text-right">{r.amount.toFixed(2)}</td>
                  <td className="p-3 text-right">{runningBalance[i].toFixed(2)}</td>
                  <td className="p-3">{r.paymentMethod}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && rows.length > 0 && (
        <p className="text-slate-600 text-sm mt-3">
          {rows.length} line(s) · Total: {totalAmount.toFixed(2)}
        </p>
      )}
    </div>
  );
}
