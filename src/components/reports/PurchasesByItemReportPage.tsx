import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

type ItemRow = {
  itemName: string;
  department: string;
  vendor: string;
  customer: string;
  quantity: number;
  amount: number;
};
type PurchaseLine = {
  itemName: string;
  department: string;
  vendor: string;
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
  const [customerFilter, setCustomerFilter] = useState("all");
  const [itemFilters, setItemFilters] = useState<string[]>([]);
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [purchaseLines, setPurchaseLines] = useState<PurchaseLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [breakdownItem, setBreakdownItem] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
        const [billsRes, poItemsRes, productsRes, departmentsRes] = await Promise.all([
          filterByOrganizationId(
            supabase
              .from("bills")
              .select("id, purchase_order_id, vendor_id, amount, bill_date, created_at, vendors(name)")
              .gte("created_at", from.toISOString())
              .lt("created_at", to.toISOString()),
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
        ]);

        const bills = (billsRes.data || []) as Array<{
          purchase_order_id: string | null;
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

        const deptById = new Map(departments.map((d) => [d.id, d.name]));
        const productByName = new Map(products.map((p) => [String(p.name || "").trim().toLowerCase(), p]));
        const vendorByPo = new Map<string, string>();
        const dateByPo = new Map<string, string>();
        bills.forEach((b) => {
          if (b.purchase_order_id) vendorByPo.set(b.purchase_order_id, b.vendors?.name || "Unknown vendor");
          if (b.purchase_order_id) {
            const d = b.bill_date || b.created_at || new Date().toISOString();
            dateByPo.set(b.purchase_order_id, d);
          }
        });

        const byItem = new Map<string, ItemRow>();
        const lines: PurchaseLine[] = [];
        for (const it of poItems) {
          const itemName = String(it.description || "Item").trim() || "Item";
          const product = productByName.get(itemName.toLowerCase());
          const department = product?.department_id ? deptById.get(product.department_id) || "Unassigned" : "Unassigned";
          const vendor = it.purchase_order_id ? vendorByPo.get(it.purchase_order_id) || "Unknown vendor" : "Unknown vendor";
          const qty = Number(it.quantity || 0);
          const amount = qty * Number(it.cost_price || 0);
          const purchaseDate = it.purchase_order_id ? dateByPo.get(it.purchase_order_id) || new Date().toISOString() : new Date().toISOString();
          const key = `${itemName}::${department}::${vendor}`;
          const prev = byItem.get(key) || {
            itemName,
            department,
            vendor,
            customer: "N/A",
            quantity: 0,
            amount: 0,
          };
          prev.quantity += qty;
          prev.amount += amount;
          byItem.set(key, prev);
          lines.push({ itemName, department, vendor, quantity: qty, amount, purchaseDate });
        }
        setRows(Array.from(byItem.values()).sort((a, b) => b.amount - a.amount));
        setPurchaseLines(lines);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [dateRange, customFrom, customTo, orgId, superAdmin]);

  const departments = useMemo(() => ["all", ...Array.from(new Set(rows.map((r) => r.department)))], [rows]);
  const vendors = useMemo(() => ["all", ...Array.from(new Set(rows.map((r) => r.vendor)))], [rows]);
  const items = useMemo(() => ["all", ...Array.from(new Set(rows.map((r) => r.itemName)))], [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (departmentFilter !== "all" && r.department !== departmentFilter) return false;
        if (vendorFilter !== "all" && r.vendor !== vendorFilter) return false;
        if (itemFilters.length > 0 && !itemFilters.includes(r.itemName)) return false;
        if (customerFilter !== "all") return false; // Purchases don't have customer dimension; keep option available.
        return true;
      }),
    [rows, departmentFilter, vendorFilter, customerFilter, itemFilters]
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

  const exportCsv = () => {
    const rowsOut = [
      ["Item", "Department", "Vendor", "Customer", "Quantity", "Amount"],
      ...filtered.map((r) => [r.itemName, r.department, r.vendor, r.customer, r.quantity.toFixed(2), r.amount.toFixed(2)]),
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
        Customer: r.customer,
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
      head: [["Item", "Department", "Vendor", "Customer", "Quantity", "Amount"]],
      body: filtered.map((r) => [r.itemName, r.department, r.vendor, r.customer, r.quantity.toFixed(2), r.amount.toFixed(2)]),
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
      <div className="flex flex-wrap gap-2 mb-4">
        <select value={dateRange} onChange={(e) => setDateRange(e.target.value as DateRangeKey)} className="border rounded px-3 py-2 text-sm">
          <option value="today">Today</option>
          <option value="this_week">This week</option>
          <option value="this_month">This month</option>
          <option value="last_month">Last month</option>
          <option value="custom">Custom</option>
        </select>
        {dateRange === "custom" ? (
          <>
            <input type="date" className="border rounded px-3 py-2 text-sm" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <input type="date" className="border rounded px-3 py-2 text-sm" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        ) : null}
        <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="border rounded px-3 py-2 text-sm">
          {departments.map((d) => (
            <option key={d} value={d}>
              {d === "all" ? "All departments" : d}
            </option>
          ))}
        </select>
        <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="border rounded px-3 py-2 text-sm">
          {vendors.map((v) => (
            <option key={v} value={v}>
              {v === "all" ? "All vendors" : v}
            </option>
          ))}
        </select>
        <select
          multiple
          value={itemFilters}
          onChange={(e) =>
            setItemFilters(Array.from(e.target.selectedOptions).map((o) => o.value))
          }
          className="border rounded px-3 py-2 text-sm min-w-[220px]"
          title="Select one or more items"
        >
          {items
            .filter((v) => v !== "all")
            .map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
        </select>
        <select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} className="border rounded px-3 py-2 text-sm">
          <option value="all">All customers</option>
          <option value="none">N/A for purchases</option>
        </select>
      </div>
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
                  <td colSpan={5} className="p-6 text-center text-slate-500">
                    No data for selected filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
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
