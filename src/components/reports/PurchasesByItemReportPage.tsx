import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId, filterJournalLinesByOrganizationId } from "../../lib/supabaseOrgFilter";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
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
type SortKey = "itemName" | "department" | "vendor" | "source" | "quantity" | "amount";
type SortDirection = "asc" | "desc";

function normalizeItemName(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
  const [ledgerByDepartment, setLedgerByDepartment] = useState<Record<string, number>>({});
  const [posCogsByDepartment, setPosCogsByDepartment] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [breakdownItem, setBreakdownItem] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: "amount",
    direction: "desc",
  });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        setExpenseSourceWarning(null);
        const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
        const [
          billsRes,
          poItemsRes,
          productsRes,
          departmentsRes,
          paymentsRes,
          expensesRes,
          expenseLinesRes,
          glAccountsRes,
          vendorsRes,
          departmentGlRes,
          journalLinesRes,
        ] = await Promise.all([
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
          filterByOrganizationId(supabase.from("products").select("id, name, department_id, purchasable"), orgId, superAdmin),
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
          supabase.from("expense_lines").select("expense_id,vendor_id,expense_gl_account_id,amount,comment,quantity"),
          // GL accounts can be legacy rows with organization_id NULL; rely on GL RLS.
          supabase.from("gl_accounts").select("id,account_code,account_name"),
          filterByOrganizationId(supabase.from("vendors").select("id,name"), orgId, superAdmin),
          filterByOrganizationId(
            supabase.from("journal_gl_department_settings").select("department_id,purchases_gl_account_id"),
            orgId,
            superAdmin
          ),
          filterJournalLinesByOrganizationId(
            supabase
              .from("journal_entry_lines")
              .select("debit,credit,gl_account_id,journal_entries!inner(entry_date,reference_type,is_posted)")
              .gte("journal_entries.entry_date", from.toISOString().slice(0, 10))
              .lt("journal_entries.entry_date", to.toISOString().slice(0, 10))
              .eq("journal_entries.is_posted", true)
              .eq("journal_entries.is_deleted", false),
            orgId,
            superAdmin
          ),
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
        const products = (productsRes.data || []) as Array<{
          name: string;
          department_id: string | null;
          purchasable: boolean | null;
        }>;
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
          quantity: number | null;
        }>;
        const glAccounts = (glAccountsRes.data || []) as Array<{ id: string; account_code: string; account_name: string }>;
        const vendorRows = (vendorsRes.data || []) as Array<{ id: string; name: string }>;
        const departmentGlRows = (departmentGlRes.data || []) as Array<{
          department_id: string;
          purchases_gl_account_id: string | null;
        }>;
        const journalLines = (journalLinesRes.data || []) as Array<{
          debit: number | null;
          credit: number | null;
          gl_account_id: string;
          journal_entries?: { reference_type?: string | null } | null;
        }>;
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
        const departmentByPurchasesGl = new Map(
          departmentGlRows
            .filter((row) => !!row.purchases_gl_account_id)
            .map((row) => [String(row.purchases_gl_account_id), deptById.get(row.department_id) || "Unassigned"])
        );
        const glById = new Map(glAccounts.map((account) => [account.id, account]));
        const departmentForPurchasesGl = (glAccountId: string) => {
          const configured = departmentByPurchasesGl.get(glAccountId);
          if (configured) return configured;
          const account = glById.get(glAccountId);
          const code = String(account?.account_code || "").trim();
          const name = String(account?.account_name || "").toLowerCase();
          if (code === "5001" || /\bbar\b.*\b(purchases?|cogs|cost)/i.test(name)) return "Bar";
          if (code === "5002" || /\bkitchen\b.*\b(purchases?|cogs|cost)/i.test(name)) return "Kitchen";
          return null;
        };
        const ledgerTotals: Record<string, number> = {};
        const posCogsTotals: Record<string, number> = {};
        journalLines.forEach((line) => {
          const department = departmentForPurchasesGl(String(line.gl_account_id || ""));
          if (!department) return;
          const netDebit = Number(line.debit || 0) - Number(line.credit || 0);
          ledgerTotals[department] = (ledgerTotals[department] || 0) + netDebit;
          if (line.journal_entries?.reference_type === "pos") {
            posCogsTotals[department] = (posCogsTotals[department] || 0) + netDebit;
          }
        });
        setLedgerByDepartment(ledgerTotals);
        setPosCogsByDepartment(posCogsTotals);
        const purchasableProducts = products.filter((product) => product.purchasable !== false);
        const productByName = new Map(purchasableProducts.map((product) => [normalizeItemName(product.name), product]));
        const purchasableProductsByLongestName = [...purchasableProducts].sort(
          (a, b) => normalizeItemName(b.name).length - normalizeItemName(a.name).length
        );
        const findPurchasableProduct = (description: string | null | undefined) => {
          const normalized = normalizeItemName(description);
          if (!normalized) return null;
          const exact = productByName.get(normalized);
          if (exact) return exact;
          return (
            purchasableProductsByLongestName.find((product) => {
                const productName = normalizeItemName(product.name);
                return productName.length >= 3 && normalized.includes(productName);
              }) ?? null
          );
        };
        const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
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
          const product = findPurchasableProduct(itemName);
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
          const narration = String(expenseLine.comment || "").trim();
          const product = findPurchasableProduct(narration);
          const usesPurchasesLedger = !!gl && !!departmentForPurchasesGl(gl.id);
          if (!product && !usesPurchasesLedger) continue;
          const department = product?.department_id
            ? deptById.get(product.department_id) || "Unassigned"
            : (gl ? departmentForPurchasesGl(gl.id) : null) ||
              gl?.account_name.replace(/\s+(purchases?|cogs|cost).*/i, "").trim() ||
              "Unassigned";
          const itemName = product?.name || narration || "Expense purchase";
          const vendor = vendorById.get(expenseLine.vendor_id || expense.vendor_id || "") || "Unknown vendor";
          const amount = Number(expenseLine.amount || 0);
          const quantity = Math.max(0, Number(expenseLine.quantity ?? 1)) || 1;
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
          prev.quantity += quantity;
          prev.amount += amount;
          byItem.set(key, prev);
          lines.push({ itemName, department, vendor, source: "Expense page", quantity, amount, purchaseDate: expenseDate || "" });
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
  const sortedFiltered = useMemo(() => {
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = a[sort.key];
      const right = b[sort.key];
      if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
      return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" }) * direction;
    });
  }, [filtered, sort]);
  const toggleSort = (key: SortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };
  const sortIcon = (key: SortKey) => {
    if (sort.key !== key) return <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" aria-hidden />;
    return sort.direction === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-brand-700" aria-hidden />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-brand-700" aria-hidden />
    );
  };

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
  const departmentPurchaseTotal = useMemo(
    () =>
      rows
        .filter((row) => departmentFilter === "all" || row.department === departmentFilter)
        .reduce((sum, row) => sum + row.amount, 0),
    [rows, departmentFilter]
  );
  const departmentLedgerTotal = useMemo(
    () =>
      departmentFilter === "all"
        ? Object.values(ledgerByDepartment).reduce((sum, amount) => sum + amount, 0)
        : ledgerByDepartment[departmentFilter] || 0,
    [ledgerByDepartment, departmentFilter]
  );
  const departmentPosCogsTotal = useMemo(
    () =>
      departmentFilter === "all"
        ? Object.values(posCogsByDepartment).reduce((sum, amount) => sum + amount, 0)
        : posCogsByDepartment[departmentFilter] || 0,
    [posCogsByDepartment, departmentFilter]
  );
  const departmentLedgerVariance = departmentLedgerTotal - departmentPurchaseTotal - departmentPosCogsTotal;

  const exportCsv = () => {
    const rowsOut = [
      ["Item", "Department", "Vendor", "Source", "Quantity", "Amount"],
      ...sortedFiltered.map((r) => [r.itemName, r.department, r.vendor, r.source, r.quantity.toFixed(2), r.amount.toFixed(2)]),
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
      sortedFiltered.map((r) => ({
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
      body: sortedFiltered.map((r) => [r.itemName, r.department, r.vendor, r.source, r.quantity.toFixed(2), r.amount.toFixed(2)]),
      theme: "grid",
      headStyles: { fillColor: [15, 23, 42] },
      styles: { fontSize: 8 },
    });
    doc.save(`purchases_by_item_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Purchases Report</h1>
          <p className="mt-1 text-sm text-slate-500">Purchased items from Buy Stock and Spend Money, filterable by department.</p>
        </div>
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
          <p className="text-xs text-slate-500">Spend Money / purchasable items</p>
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
          <option value="Expense page">Spend Money / purchasable items</option>
        </select>
        <span className="text-sm text-slate-500">
          Department: {departmentFilter === "all" ? "All departments" : departmentFilter}
        </span>
        <span className="text-sm text-slate-500">Filtered quantity: {totalQuantity.toFixed(2)}</span>
      </div>
      <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-blue-950">
              {departmentFilter === "all" ? "Department purchases ledger reconciliation" : `${departmentFilter} purchases ledger reconciliation`}
            </p>
            <p className="mt-1 text-xs text-blue-800">
              The purchases GL can include POS cost of goods sold and other journal entries in addition to supplier purchases.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <span className="text-blue-700">Supplier purchases</span>
            <span className="text-right font-semibold tabular-nums text-blue-950">{departmentPurchaseTotal.toFixed(2)}</span>
            <span className="text-blue-700">Purchases GL balance</span>
            <span className="text-right font-semibold tabular-nums text-blue-950">{departmentLedgerTotal.toFixed(2)}</span>
            <span className="text-blue-700">POS COGS in GL</span>
            <span className="text-right font-semibold tabular-nums text-blue-950">{departmentPosCogsTotal.toFixed(2)}</span>
            <span className="text-blue-700">Other / variance</span>
            <span className="text-right font-semibold tabular-nums text-blue-950">{departmentLedgerVariance.toFixed(2)}</span>
          </div>
        </div>
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
                {([
                  ["itemName", "Item", "text-left"],
                  ["department", "Department", "text-left"],
                  ["vendor", "Vendor", "text-left"],
                  ["source", "Source", "text-left"],
                  ["quantity", "Qty", "text-right"],
                  ["amount", "Amount", "text-right"],
                ] as Array<[SortKey, string, string]>).map(([key, label, alignment]) => (
                  <th key={key} className={`p-3 ${alignment}`}>
                    <button
                      type="button"
                      onClick={() => toggleSort(key)}
                      className={`inline-flex items-center gap-1 font-semibold hover:text-brand-700 ${
                        alignment === "text-right" ? "ml-auto" : ""
                      }`}
                      title={`Sort by ${label}`}
                    >
                      {label}
                      {sortIcon(key)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map((r, i) => (
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
