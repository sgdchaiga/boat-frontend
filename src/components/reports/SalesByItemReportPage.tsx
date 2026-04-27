import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

type Row = {
  itemName: string;
  department: string;
  customer: string;
  vendor: string;
  quantity: number;
  amount: number;
};

export function SalesByItemReportPage() {
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
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
        const [salesRes, departmentsRes, kitchenRes, productsRes, billingRes, retailInvoicesRes] = await Promise.all([
          filterByOrganizationId(
            supabase
              .from("retail_sales")
              .select("id, sale_at, customer_name")
              .gte("sale_at", from.toISOString())
              .lt("sale_at", to.toISOString()),
            orgId,
            superAdmin
          ),
          filterByOrganizationId(supabase.from("departments").select("id, name"), orgId, superAdmin),
          filterByOrganizationId(
            supabase
              .from("kitchen_orders")
              .select("id, customer_name, created_at, kitchen_order_items(quantity, product_id, notes)")
              .gte("created_at", from.toISOString())
              .lt("created_at", to.toISOString()),
            orgId,
            superAdmin
          ),
          filterByOrganizationId(
            supabase.from("products").select("id, name, department_id, sales_price"),
            orgId,
            superAdmin
          ),
          filterByOrganizationId(
            supabase
              .from("billing")
              .select("id, amount, description, charge_type, charged_at")
              .gte("charged_at", from.toISOString())
              .lt("charged_at", to.toISOString()),
            orgId,
            superAdmin
          ),
          filterByOrganizationId(
            supabase
              .from("retail_invoices")
              .select("id, customer_name, issue_date")
              .gte("issue_date", from.toISOString().slice(0, 10))
              .lt("issue_date", to.toISOString().slice(0, 10)),
            orgId,
            superAdmin
          ),
        ]);
        const sales = (salesRes.data || []) as Array<{ id: string; customer_name: string | null }>;
        const saleIds = sales.map((s) => s.id);
        const linesRes = saleIds.length
          ? await supabase
              .from("retail_sale_lines")
              .select("sale_id, description, quantity, line_total, department_id")
              .in("sale_id", saleIds)
          : { data: [] };
        const lines = (linesRes.data || []) as Array<{
          sale_id: string | null;
          description: string | null;
          quantity: number | null;
          line_total: number | null;
          department_id: string | null;
        }>;
        const departments = (departmentsRes.data || []) as Array<{ id: string; name: string }>;
        const products = (productsRes.data || []) as Array<{ id: string; name: string; department_id: string | null; sales_price: number | null }>;
        const kitchenOrders = (kitchenRes.data || []) as Array<{
          id: string;
          customer_name: string | null;
          kitchen_order_items: Array<{ quantity: number | null; product_id: string | null; notes: string | null }>;
        }>;
        const billings = (billingRes.data || []) as Array<{
          amount: number | null;
          description: string | null;
          charge_type: string | null;
        }>;
        const retailInvoices = (retailInvoicesRes.data || []) as Array<{
          id: string;
          customer_name: string | null;
        }>;
        const retailInvoiceIds = retailInvoices.map((inv) => inv.id);
        const invoiceLinesRes = retailInvoiceIds.length
          ? await supabase
              .from("retail_invoice_lines")
              .select("invoice_id, description, product_id, quantity, line_total")
              .in("invoice_id", retailInvoiceIds)
          : { data: [] };
        const retailInvoiceLines = (invoiceLinesRes.data || []) as Array<{
          invoice_id: string;
          description: string | null;
          product_id: string | null;
          quantity: number | null;
          line_total: number | null;
        }>;
        const saleById = new Map(sales.map((s) => [s.id, s]));
        const deptById = new Map(departments.map((d) => [d.id, d.name]));
        const productById = new Map(products.map((p) => [p.id, p]));
        const retailInvoiceById = new Map(retailInvoices.map((inv) => [inv.id, inv]));

        const grouped = new Map<string, Row>();
        const addRow = (row: Row) => {
          const key = `${row.itemName}::${row.department}::${row.customer}`;
          const prev = grouped.get(key) || { ...row, quantity: 0, amount: 0 };
          prev.quantity += row.quantity;
          prev.amount += row.amount;
          grouped.set(key, prev);
        };
        for (const line of lines) {
          if (!line.sale_id) continue;
          const sale = saleById.get(line.sale_id);
          if (!sale) continue;
          const itemName = String(line.description || "Item").trim() || "Item";
          const department = line.department_id ? deptById.get(line.department_id) || "Unassigned" : "Unassigned";
          const customer = sale.customer_name || "Walk-in";
          const qty = Number(line.quantity || 0);
          const amount = Number(line.line_total || 0);
          addRow({
            itemName,
            department,
            customer,
            vendor: "N/A",
            quantity: qty,
            amount,
          });
        }
        for (const order of kitchenOrders) {
          for (const it of order.kitchen_order_items || []) {
            const p = it.product_id ? productById.get(it.product_id) : null;
            const itemName = p?.name || "POS item";
            const department = p?.department_id ? deptById.get(p.department_id) || "Unassigned" : "POS";
            const qty = Number(it.quantity || 0);
            const amount = qty * Number(p?.sales_price || 0);
            addRow({
              itemName,
              department,
              customer: order.customer_name || "Walk-in",
              vendor: "N/A",
              quantity: qty,
              amount,
            });
          }
        }
        for (const b of billings) {
          addRow({
            itemName: (b.charge_type || b.description || "Room charge").toString(),
            department: "Room Sales",
            customer: "Guest",
            vendor: "N/A",
            quantity: 1,
            amount: Number(b.amount || 0),
          });
        }
        for (const line of retailInvoiceLines) {
          const inv = retailInvoiceById.get(line.invoice_id);
          const p = line.product_id ? productById.get(line.product_id) : null;
          addRow({
            itemName: (line.description || p?.name || "Invoice item").toString(),
            department: p?.department_id ? deptById.get(p.department_id) || "Unassigned" : "Invoicing",
            customer: inv?.customer_name || "Customer",
            vendor: "N/A",
            quantity: Number(line.quantity || 0),
            amount: Number(line.line_total || 0),
          });
        }
        setRows(Array.from(grouped.values()).sort((a, b) => b.amount - a.amount));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [dateRange, customFrom, customTo, orgId, superAdmin]);

  const departments = useMemo(() => ["all", ...Array.from(new Set(rows.map((r) => r.department)))], [rows]);
  const customers = useMemo(() => ["all", ...Array.from(new Set(rows.map((r) => r.customer)))], [rows]);
  const items = useMemo(() => Array.from(new Set(rows.map((r) => r.itemName))), [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (departmentFilter !== "all" && r.department !== departmentFilter) return false;
        if (customerFilter !== "all" && r.customer !== customerFilter) return false;
        if (itemFilters.length > 0 && !itemFilters.includes(r.itemName)) return false;
        if (vendorFilter !== "all") return false; // Sales don't have vendor dimension; keep option available.
        return true;
      }),
    [rows, departmentFilter, customerFilter, vendorFilter, itemFilters]
  );

  const exportCsv = () => {
    const rowsOut = [
      ["Item", "Department", "Customer", "Vendor", "Quantity", "Amount"],
      ...filtered.map((r) => [r.itemName, r.department, r.customer, r.vendor, r.quantity.toFixed(2), r.amount.toFixed(2)]),
    ];
    const csv = rowsOut.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales_by_item_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(
      filtered.map((r) => ({
        Item: r.itemName,
        Department: r.department,
        Customer: r.customer,
        Vendor: r.vendor,
        Quantity: Number(r.quantity.toFixed(2)),
        Amount: Number(r.amount.toFixed(2)),
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SalesByItem");
    XLSX.writeFile(wb, `sales_by_item_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportPdf = () => {
    const doc = new jsPDF("landscape");
    doc.setFontSize(14);
    doc.text("Sales by Item Report", 14, 14);
    doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 20);
    autoTable(doc, {
      startY: 26,
      head: [["Item", "Department", "Customer", "Vendor", "Quantity", "Amount"]],
      body: filtered.map((r) => [r.itemName, r.department, r.customer, r.vendor, r.quantity.toFixed(2), r.amount.toFixed(2)]),
      theme: "grid",
      headStyles: { fillColor: [15, 23, 42] },
      styles: { fontSize: 8 },
    });
    doc.save(`sales_by_item_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Sales by Item</h1>
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
        <select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} className="border rounded px-3 py-2 text-sm">
          {customers.map((c) => (
            <option key={c} value={c}>
              {c === "all" ? "All customers" : c}
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
          {items.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="border rounded px-3 py-2 text-sm">
          <option value="all">All vendors</option>
          <option value="none">N/A for sales</option>
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
                <th className="p-3 text-left">Customer</th>
                <th className="p-3 text-right">Qty</th>
                <th className="p-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.itemName}-${i}`} className="border-t">
                  <td className="p-3">{r.itemName}</td>
                  <td className="p-3">{r.department}</td>
                  <td className="p-3">{r.customer}</td>
                  <td className="p-3 text-right">{r.quantity.toFixed(2)}</td>
                  <td className="p-3 text-right">{r.amount.toFixed(2)}</td>
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
    </div>
  );
}
