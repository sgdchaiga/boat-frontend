import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { PageNotes } from "../common/PageNotes";

type Row = {
  id: string;
  posted_at: string;
  product_name: string;
  produced_qty: number;
  employee_name: string;
};

export function ManufacturingDailyProductionReportPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, [dateRange, customFrom, customTo, orgId, superAdmin]);

  const load = async () => {
    setLoading(true);
    try {
      const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
      const fromIso = from.toISOString();
      const toIso = to.toISOString();

      const { data, error } = await filterByOrganizationId(
        supabase
          .from("manufacturing_production_entries")
          .select("id,posted_at,product_name,produced_qty,posted_by_staff_id,work_order_id")
          .gte("posted_at", fromIso)
          .lt("posted_at", toIso)
          .order("posted_at", { ascending: false }),
        orgId,
        superAdmin
      );
      if (error) throw error;

      const list = (data || []) as Array<{
        id: string;
        posted_at: string;
        product_name: string | null;
        produced_qty: number | null;
        posted_by_staff_id: string | null;
        work_order_id: string | null;
      }>;

      const staffIds = [...new Set(list.map((r) => r.posted_by_staff_id).filter(Boolean))] as string[];
      const woIds = [...new Set(list.map((r) => r.work_order_id).filter(Boolean))] as string[];

      const [staffRes, woRes] = await Promise.all([
        staffIds.length
          ? filterByOrganizationId(supabase.from("staff").select("id,full_name").in("id", staffIds), orgId, superAdmin)
          : Promise.resolve({ data: [] as { id: string; full_name: string }[], error: null }),
        woIds.length
          ? filterByOrganizationId(
              supabase.from("manufacturing_work_orders").select("id,product_name").in("id", woIds),
              orgId,
              superAdmin
            )
          : Promise.resolve({ data: [] as { id: string; product_name: string }[], error: null }),
      ]);

      const staffById = new Map((staffRes.data || []).map((s: { id: string; full_name: string }) => [s.id, s.full_name]));
      const woById = new Map(
        (woRes.data || []).map((w: { id: string; product_name: string }) => [w.id, w.product_name])
      );

      setRows(
        list.map((r) => ({
          id: r.id,
          posted_at: r.posted_at,
          product_name: (r.product_name || (r.work_order_id ? woById.get(r.work_order_id) : null) || "—").trim() || "—",
          produced_qty: Number(r.produced_qty ?? 0),
          employee_name: (() => {
            const n = r.posted_by_staff_id ? staffById.get(r.posted_by_staff_id) : undefined;
            return (n != null && String(n).trim()) ? String(n).trim() : "—";
          })(),
        }))
      );
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    const lines = [
      ["Date", "Product", "Quantity produced", "Employee in charge"],
      ...rows.map((r) => [
        new Date(r.posted_at).toISOString(),
        r.product_name.replaceAll(",", " "),
        String(r.produced_qty),
        r.employee_name.replaceAll(",", " "),
      ]),
    ];
    const blob = new Blob([lines.map((l) => l.join(",")).join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `daily_production_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Daily production report</h1>
            <PageNotes ariaLabel="Daily production report help">
              <p>Production entries in the selected period: date, product, quantity produced, and staff in charge.</p>
            </PageNotes>
          </div>
        </div>
        <button type="button" onClick={exportCsv} className="border border-slate-300 rounded-lg px-4 py-2 text-sm hover:bg-slate-50">
          Export CSV
        </button>
      </div>

      <div className="flex flex-wrap gap-4 mb-6">
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="this_week">This week</option>
          <option value="this_month">This month</option>
          <option value="last_30_days">Last 30 days</option>
          <option value="custom">Custom</option>
        </select>
        {dateRange === "custom" && (
          <>
            <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        )}
      </div>

      {loading ? (
        <p className="text-slate-500 py-4">Loading…</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Product</th>
                <th className="text-right p-3">Quantity produced</th>
                <th className="text-left p-3">Employee in charge</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3 whitespace-nowrap">{new Date(r.posted_at).toLocaleString()}</td>
                  <td className="p-3">{r.product_name}</td>
                  <td className="p-3 text-right tabular-nums">{r.produced_qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="p-3">{r.employee_name}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-slate-500">
                    No production entries for this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
