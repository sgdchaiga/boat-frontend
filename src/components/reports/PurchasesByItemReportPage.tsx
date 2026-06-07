import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { ItemReportFiltersPanel } from "./ItemReportFiltersPanel";
import { parseBillAllocationsJson } from "../../lib/billStatus";

type ItemRow = {
  itemName: string;
  department: string;
  vendor: string;
  customer: string;
  source: "Bills / purchase orders" | "Expense page";
  quantity: number;
  amount: number;
};
type PurchaseLine = {
  itemName: string;
  department: string;
  vendor: string;
  source: "Bills / purchase orders" | "Expense page";
  quantity: number;
  amount: number;
  purchaseDate: string;
};

export function PurchasesByItemReportPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [itemFilters, setItemFilters] = useState<string[]>([]);
  const [basis, setBasis] = useState<"accrual" | "cash">("accrual");
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [purchaseLines, setPurchaseLines] = useState<PurchaseLine[]>([]);
  const [unallocatedCash, setUnallocatedCash] = useState(0);
  const [expenseSourceWarning, setExpenseSourceWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [breakdownItem, setBreakdownItem] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        setExpenseSourceWarning(null);
        const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
        const [billsRes, poItemsRes, productsRes, departmentsRes, paymentsRes, expensesRes, expenseLinesRes, glAccountsRes, vendorsRes] = await Promise.all([
          filterByOrganizationId(
            supabase
              .from("bills")
              .select("id, purchase_order_id, vendor_id, amount, bill_date, created_at, vendors(name)"),
            orgId,
            superAdmin
          ),
          filterByOrganizationId(
            // Keep query schema-safe for older DBs (no product_id on legacy rows).
            supabase.from("purchase_order_items").select("purchase_order_id, description, quantity, cost_price"),
            orgId,
            superAdmin
          ),
          filterByOrganizationId(supabase.from("products").select("id, name, department_id"), orgId, superAdmin),
          filterByOrganizationId(supabase.from("departments").select("id, name"), orgId, superAdmin),
          filterByOrganizationId(
            supabase.from("vendor_payments").select("id, bill_id, bill_allocations, amount, payment_date, created_at"),
            orgId,
            superAdmin
          ),
          filterByOrganizationId(
            supabase.from("expenses").select("id,vendor_id,expense_date,created_at"),
            orgId,
            superAdmin
          ),
          supabase.from("expense_lines").select("expense_id,vendor_id,expense_gl_account_id,amount,comment"),
          // GL accounts can be legacy rows with organization_id NULL; rely on GL RLS.
          supabase.from("gl_accounts").select("id,account_code,account_name"),
          filterByOrganizationId(supabase.from("vendors").select("id,name"), orgId, superAdmin),
        ]);

        const bills = (billsRes.data || []) as Array<{
          id: string;
          purchase_order_id: string | null;
          amount: number | null;
          bill_date: string | null;
          created_at: string | null;
          vendors?: { name?: string | null } | null;
        }>;
        const poItems = (poItemsRes.data || []) as Array<{
          purchase_order_id: string | null;
          description: string | null;
          quantity: number | null;
          cost_price: number | null;
        }>;
        const products = (productsRes.data || []) as Array<{ name: string; department_id: string | null }>;
        const departments = (departmentsRes.data || []) as Array<{ id: string; name: string }>;
        const payments = (paymentsRes.data || []) as Array<{
          id: string;
          bill_id: string | null;
          bill_allocations?: unknown;
          amount: number | null;
          payment_date: string | null;
          created_at: string | null;
        }>;
        const expenses = (expensesRes.data || []) as Array<{ id: string; vendor_id: string | null; expense_date: string | null; created_at: string | null }>;
        const expenseLines = (expenseLinesRes.data || []) as Array<{
          expense_id: string;
          vendor_id: string | null;
          expense_gl_account_id: string;
          amount: number | null;
          comment: string | null;
        }>;
        const glAccounts = (glAccountsRes.data || []) as Array<{ id: string; account_code: string; account_name: string }>;
        const vendorRows = (vendorsRes.data || []) as Array<{ id: string; name: string }>;
        if (expenseLinesRes.error || glAccountsRes.error || expensesRes.error) {
          const message = expenseLinesRes.error?.message || glAccountsRes.error?.message || expensesRes.error?.message || "Unknown error";
          setExpenseSourceWarning(`Expense-page purchases could not be loaded: ${message}`);
        }
        const inRange = (value: string | null | undefined) => {
          if (!value) return false;
          const date = new Date(value);
          return date >= from && date < to;
        };
        const paidByBill = new Map<string, number>();
        const paymentsInRange = payments.filter((payment) => inRange(payment.payment_date) || (!payment.payment_date && inRange(payment.created_at)));
        paymentsInRange.forEach((payment) => {
          const allocations = parseBillAllocationsJson(payment.bill_allocations);
          if (payment.bill_id) {
            paidByBill.set(payment.bill_id, (paidByBill.get(payment.bill_id) || 0) + Number(payment.amount || 0));
          } else if (allocations.length > 0) {
            allocations.forEach((allocation) => paidByBill.set(allocation.bill_id, (paidByBill.get(allocation.bill_id) || 0) + allocation.amount));
          }
        });
        if (basis === "cash" && paymentsInRange.length > 0) {
          const { data: allocationRows } = await supabase
            .from("vendor_payment_bill_allocations")
            .select("vendor_payment_id,bill_id,amount")
            .in("vendor_payment_id", paymentsInRange.map((payment) => payment.id));
          (allocationRows || []).forEach((allocation: { vendor_payment_id: string; bill_id: string; amount: number }) => {
            paidByBill.set(allocation.bill_id, (paidByBill.get(allocation.bill_id) || 0) + Number(allocation.amount || 0));
          });
        }
        const deptById = new Map(departments.map((d) => [d.id, d.name]));
        const productByName = new Map(products.map((p) => [String(p.name || "").trim().toLowerCase(), p]));
        const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
        const glById = new Map(glAccounts.map((account) => [account.id, account]));
        const vendorById = new Map(vendorRows.map((vendor) => [vendor.id, vendor.name]));
        const vendorByPo = new Map<string, string>();
        const dateByPo = new Map<string, string>();
        const factorByPo = new Map<string, number>();
        bills.forEach((b) => {
          if (b.purchase_order_id) vendorByPo.set(b.purchase_order_id, b.vendors?.name || "Unknown vendor");
          if (b.purchase_order_id) {
            const d = b.bill_date || b.created_at || new Date().toISOString();
            dateByPo.set(b.purchase_order_id, d);
            const accrualIncluded = inRange(b.bill_date) || (!b.bill_date && inRange(b.created_at));
            const billAmount = Number(b.amount || 0);
            const paidAmount = paidByBill.get(b.id) || 0;
            factorByPo.set(
              b.purchase_order_id,
              basis === "cash"
                ? billAmount > 0
                  ? Math.min(1, paidAmount / billAmount)
                  : 0
                : accrualIncluded ? 1 : 0
            );
          }
        });
        const byItem = new Map<string, ItemRow>();
        const lines: PurchaseLine[] = [];
        for (const it of poItems) {
          const itemName = String(it.description || "Item").trim() || "Item";
          const product = productByName.get(itemName.toLowerCase());
          const department = product?.department_id ? deptById.get(product.department_id) || "Unassigned" : "Unassigned";
          const vendor = it.purchase_order_id ? vendorByPo.get(it.purchase_order_id) || "Unknown vendor" : "Unknown vendor";
          const factor = it.purchase_order_id ? factorByPo.get(it.purchase_order_id) || 0 : 0;
          if (factor <= 0) continue;
          const qty = Number(it.quantity || 0) * factor;
          const amount = qty * Number(it.cost_price || 0);
          const purchaseDate = it.purchase_order_id ? dateByPo.get(it.purchase_order_id) || new Date().toISOString() : new Date().toISOString();
          const key = `${itemName}::${department}::${vendor}`;
          const prev = byItem.get(key) || {
            itemName,
            department,
            vendor,
            customer: "N/A",
            source: "Bills / purchase orders",
            quantity: 0,
            amount: 0,
          };
          prev.quantity += qty;
          prev.amount += amount;
          byItem.set(key, prev);
          lines.push({ itemName, department, vendor, source: "Bills / purchase orders", quantity: qty, amount, purchaseDate });
        }
        for (const expenseLine of expenseLines) {
          const expense = expenseById.get(expenseLine.expense_id);
          const expenseDate = expense?.expense_date || expense?.created_at;
          if (!expense || !inRange(expenseDate)) continue;
          const gl = glById.get(expenseLine.expense_gl_account_id);
          if (!gl || !(/\bpurchases?\b/i.test(gl.account_name) || /^5001\b/.test(gl.account_code))) continue;
          const department = gl.account_name.replace(/\s+purchases?\b.*$/i, "").trim() || "Unassigned";
          const itemName = String(expenseLine.comment || "Expense purchase").trim() || "Expense purchase";
          const vendor = vendorById.get(expenseLine.vendor_id || expense.vendor_id || "") || "Unknown vendor";
          const amount = Number(expenseLine.amount || 0);
          if (amount <= 0) continue;
          const key = `${itemName}::${department}::${vendor}::Expense page`;
          const prev = byItem.get(key) || {
            itemName,
            department,
            vendor,
            customer: "N/A",
            source: "Expense page" as const,
            quantity: 0,
            amount: 0,
          };
          prev.quantity += 1;
          prev.amount += amount;
          byItem.set(key, prev);
          lines.push({ itemName, department, vendor, source: "Expense page", quantity: 1, amount, purchaseDate: expenseDate || "" });
        }
        const itemRows = Array.from(byItem.values()).sort((a, b) => b.amount - a.amount);
        const itemizedAmount = itemRows
          .filter((row) => row.source === "Bills / purchase orders")
          .reduce((sum, row) => sum + row.amount, 0);
        const paymentAmount = paymentsInRange.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        setUnallocatedCash(basis === "cash" ? Math.max(0, paymentAmount - itemizedAmount) : 0);
        setRows(itemRows);
        setPurchaseLines(lines);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [dateRange, customFrom, customTo, basis, orgId, superAdmin]);

  const departments = useMemo(() => ["all", ...Array.from(new Set(rows.map((r) => r.department)))], [rows]);
  const vendors = useMemo(() => ["all", ...Array.from(new Set(rows.map((r) => r.vendor)))], [rows]);
  const customers = useMemo(() => ["all"], []);
  const items = useMemo(
    () => Array.from(new Set(rows.map((r) => r.itemName))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (departmentFilter !== "all" && r.department !== departmentFilter) return false;
        if (vendorFilter !== "all" && r.vendor !== vendorFilter) return false;
        if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
        if (itemFilters.length > 0 && !itemFilters.includes(r.itemName)) return false;
        if (customerFilter !== "all") return false; // Purchases don't have customer dimension; keep option available.
        return true;
      }),
    [rows, departmentFilter, vendorFilter, sourceFilter, customerFilter, itemFilters]
  );

  const breakdownRows = useMemo(() => {
    if (!breakdownItem) return [];
    const grouped = new Map<string, { date: string; quantity: number; amount: number }>();
    purchaseLines
      .filter((l) => l.itemName === breakdownItem)
      .forEach((l) => {
        const dateKey = new Date(l.purchaseDate).toISOString().slice(0, 10);
        const prev = grouped.get(dateKey) || { date: dateKey, quantity: 0, amount: 0 };
        prev.quantity += l.quantity;
        prev.amount += l.amount;
        grouped.set(dateKey, prev);
      });
    return Array.from(grouped.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [breakdownItem, purchaseLines]);
  const totalAmount = useMemo(() => filtered.reduce((sum, row) => sum + row.amount, 0), [filtered]);
  const totalQuantity = useMemo(() => filtered.reduce((sum, row) => sum + row.quantity, 0), [filtered]);
  const billsTotal = useMemo(() => filtered.filter((row) => row.source === "Bills / purchase orders").reduce((sum, row) => sum + row.amount, 0), [filtered]);
  const expensePageTotal = useMemo(() => filtered.filter((row) => row.source === "Expense page").reduce((sum, row) => sum + row.amount, 0), [filtered]);

  const exportCsv = () => {
    const rowsOut = [
      ["Item", "Department", "Vendor", "Source", "Quantity", "Amount"],
      ...filtered.map((r) => [r.itemName, r.department, r.vendor, r.source, r.quantity.toFixed(2), r.amount.toFixed(2)]),
    ];
    const csv = rowsOut.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchases_by_item_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(
      filtered.map((r) => ({
        Item: r.itemName,
        Department: r.department,
        Vendor: r.vendor,
        Source: r.source,
        Quantity: Number(r.quantity.toFixed(2)),
        Amount: Number(r.amount.toFixed(2)),
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PurchasesByItem");
    XLSX.writeFile(wb, `purchases_by_item_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportPdf = () => {
    const doc = new jsPDF("landscape");
    doc.setFontSize(14);
    doc.text("Purchases by Item Report", 14, 14);
    doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 20);
    autoTable(doc, {
      startY: 26,
      head: [["Item", "Department", "Vendor", "Source", "Quantity", "Amount"]],
      body: filtered.map((r) => [r.itemName, r.department, r.vendor, r.source, r.quantity.toFixed(2), r.amount.toFixed(2)]),
      theme: "grid",
      headStyles: { fillColor: [15, 23, 42] },
      styles: { fontSize: 8 },
    });
    doc.save(`purchases_by_item_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Purchases by Item</h1>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportCsv} className="border rounded px-3 py-2 text-sm hover:bg-slate-50">CSV</button>
          <button type="button" onClick={exportExcel} className="border rounded px-3 py-2 text-sm hover:bg-slate-50">Excel</button>
          <button type="button" onClick={exportPdf} className="border rounded px-3 py-2 text-sm hover:bg-slate-50">PDF</button>
        </div>
      </div>
      <ItemReportFiltersPanel
        compact
        hideCustomer
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        departmentFilter={departmentFilter}
        onDepartmentFilterChange={setDepartmentFilter}
        departments={departments}
        customerFilter={customerFilter}
        onCustomerFilterChange={setCustomerFilter}
        customers={customers}
        customerDisabled
        customerDisabledHint="N/A for purchases"
        vendorFilter={vendorFilter}
        onVendorFilterChange={setVendorFilter}
        vendors={vendors}
        itemFilters={itemFilters}
        onItemFiltersChange={setItemFilters}
        items={items}
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Purchases total</p>
          <p className="text-2xl font-bold text-slate-900">{totalAmount.toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Bills / purchase orders</p>
          <p className="text-2xl font-bold text-slate-900">{billsTotal.toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Expense page / purchases ledger</p>
          <p className="text-2xl font-bold text-slate-900">{expensePageTotal.toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <label className="mb-1 block text-xs text-slate-500">Accounting basis</label>
          <select value={basis} onChange={(event) => setBasis(event.target.value as "accrual" | "cash")} className="w-full rounded-lg border border-slate-300 px-3 py-2">
            <option value="accrual">Accrual basis (bills)</option>
            <option value="cash">Cash basis (vendor payments)</option>
          </select>
          {basis === "cash" && unallocatedCash > 0 ? (
            <p className="mt-1 text-xs text-amber-700">{unallocatedCash.toFixed(2)} of unallocated payments cannot be assigned to items.</p>
          ) : null}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-slate-700">Source</label>
        <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="all">All purchase sources</option>
          <option value="Bills / purchase orders">Bills / purchase orders</option>
          <option value="Expense page">Expense page / purchases ledger</option>
        </select>
        <span className="text-sm text-slate-500">Filtered quantity: {totalQuantity.toFixed(2)}</span>
      </div>
      {expenseSourceWarning ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {expenseSourceWarning}
        </div>
      ) : null}
      {loading ? (
        <p className="text-slate-500">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-3 text-left">Item</th>
                <th className="p-3 text-left">Department</th>
                <th className="p-3 text-left">Vendor</th>
                <th className="p-3 text-left">Source</th>
                <th className="p-3 text-right">Qty</th>
                <th className="p-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.itemName}-${i}`} className="border-t">
                  <td className="p-3">{r.itemName}</td>
                  <td className="p-3">{r.department}</td>
                  <td className="p-3">{r.vendor}</td>
                  <td className="p-3">{r.source}</td>
                  <td className="p-3 text-right">{r.quantity.toFixed(2)}</td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      onClick={() => setBreakdownItem(r.itemName)}
                      className="text-blue-600 hover:underline"
                    >
                      {r.amount.toFixed(2)}
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">
                    No data for selected filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
            {filtered.length > 0 ? (
              <tfoot className="bg-slate-100 font-semibold">
                <tr>
                  <td colSpan={4} className="p-3 text-right">Total</td>
                  <td className="p-3 text-right">{totalQuantity.toFixed(2)}</td>
                  <td className="p-3 text-right">{totalAmount.toFixed(2)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
      {breakdownItem ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setBreakdownItem(null)}
        >
          <div
            className="w-full max-w-3xl rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-slate-900">Purchase breakdown by date: {breakdownItem}</h2>
              <button
                type="button"
                onClick={() => setBreakdownItem(null)}
                className="border rounded px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <div className="overflow-x-auto max-h-[65vh]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="p-3 text-left">Date</th>
                    <th className="p-3 text-right">Quantity</th>
                    <th className="p-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdownRows.map((r) => (
                    <tr key={r.date} className="border-t">
                      <td className="p-3">{r.date}</td>
                      <td className="p-3 text-right">{r.quantity.toFixed(2)}</td>
                      <td className="p-3 text-right">{r.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                  {breakdownRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-6 text-center text-slate-500">
                        No breakdown rows found for this item.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
