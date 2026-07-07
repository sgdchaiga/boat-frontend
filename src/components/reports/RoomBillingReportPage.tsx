import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { computeRangeInTimezone, toBusinessDateString, type DateRangeKey } from "../../lib/timezone";
import { PageNotes } from "../common/PageNotes";

type RoomBillingRow = {
  id: string;
  stay_id: string | null;
  description: string;
  amount: number;
  charged_at: string;
  stay_night_date: string | null;
  auto_charge_source: string | null;
  stays?: {
    rooms: { room_number: string } | null;
    hotel_customers: { first_name: string; last_name: string } | null;
  } | null;
};
type BillingSortKey = "charged_at" | "stay_night_date" | "room" | "guest" | "description" | "source" | "amount";

function formatMoney(amount: number) {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatChargedAt(value: string) {
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

export function RoomBillingReportPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [dateRange, setDateRange] = useState<DateRangeKey>("this_year");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RoomBillingRow[]>([]);
  const [sort, setSort] = useState<{ key: BillingSortKey; dir: "asc" | "desc" }>({ key: "charged_at", dir: "desc" });

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
      const fromDate = toBusinessDateString(from);
      const toInclusiveDate = toBusinessDateString(new Date(to.getTime() - 1));
      const select =
        "id, stay_id, description, amount, charged_at, stay_night_date, auto_charge_source, stays(rooms(room_number), hotel_customers(first_name, last_name))";
      const [byChargeDate, byFolioNight] = await Promise.all([
        filterByOrganizationId(
          supabase
            .from("billing")
            .select(select)
            .eq("charge_type", "room")
            .gte("charged_at", from.toISOString())
            .lt("charged_at", to.toISOString())
            .order("charged_at", { ascending: false }),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(
          supabase
            .from("billing")
            .select(select)
            .eq("charge_type", "room")
            .gte("stay_night_date", fromDate)
            .lte("stay_night_date", toInclusiveDate)
            .order("stay_night_date", { ascending: false }),
          orgId,
          superAdmin
        ),
      ]);
      if (byChargeDate.error && byFolioNight.error) throw byChargeDate.error;
      const rowMap = new Map<string, RoomBillingRow>();
      ([...(byChargeDate.data || []), ...(byFolioNight.data || [])] as unknown as RoomBillingRow[]).forEach((row) => {
        rowMap.set(row.id, row);
      });
      setRows(Array.from(rowMap.values()));
    } catch (e) {
      console.error("[Room billing report]", e);
      setRows([]);
      setError(e instanceof Error ? e.message : "Failed to load room billing.");
    } finally {
      setLoading(false);
    }
  }, [orgId, superAdmin, dateRange, customFrom, customTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.amount || 0), 0), [rows]);
  const roomCount = useMemo(
    () => new Set(rows.map((row) => row.stays?.rooms?.room_number).filter(Boolean)).size,
    [rows]
  );
  const valueForSort = (row: RoomBillingRow, key: BillingSortKey): string | number => {
    if (key === "room") return row.stays?.rooms?.room_number || "";
    if (key === "guest") return row.stays?.hotel_customers
      ? `${row.stays.hotel_customers.first_name} ${row.stays.hotel_customers.last_name}`.trim()
      : "";
    if (key === "source") return row.auto_charge_source || "manual";
    if (key === "amount") return Number(row.amount || 0);
    return row[key] || "";
  };
  const sortedRows = useMemo(() => {
    const direction = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = valueForSort(a, sort.key);
      const bv = valueForSort(b, sort.key);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * direction;
    });
  }, [rows, sort]);

  const exportCsv = () => {
    const header = ["Charge date/time", "Folio night", "Room", "Guest", "Description", "Source", "Amount"];
    const detail = sortedRows.map((row) => [
      formatChargedAt(row.charged_at),
      row.stay_night_date || "",
      row.stays?.rooms?.room_number || "",
      row.stays?.hotel_customers
        ? `${row.stays.hotel_customers.first_name} ${row.stays.hotel_customers.last_name}`.trim()
        : "",
      row.description,
      row.auto_charge_source || "manual",
      Number(row.amount || 0).toFixed(2),
    ]);
    const csv = [header, ...detail, ["", "", "", "", "", "Total", total.toFixed(2)]]
      .map((line) => line.map(csvCell).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `room_billing_report_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const toggleSort = (key: BillingSortKey) => {
    setSort((current) => current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  };
  const SortIcon = ({ column }: { column: BillingSortKey }) => {
    if (sort.key !== column) return <ArrowUpDown className="h-4 w-4 text-slate-400" aria-hidden />;
    return sort.dir === "asc"
      ? <ArrowUp className="h-4 w-4 text-slate-700" aria-hidden />
      : <ArrowDown className="h-4 w-4 text-slate-700" aria-hidden />;
  };
  const sortHeader = (key: BillingSortKey, label: string, align: "left" | "right" = "left") => (
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
          <h1 className="text-3xl font-bold text-slate-900">Room billing report</h1>
          <PageNotes ariaLabel="Room billing report help">
            <p>Room charges posted to guest billing, filtered by the charge date in the Kampala business timezone.</p>
          </PageNotes>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <div className="mb-6 flex flex-wrap gap-4">
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
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
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </>
        )}
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="py-4 text-slate-500">Loading room billing...</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="app-card p-4">
              <p className="text-xs text-slate-500">Room billing total</p>
              <p className="text-2xl font-bold text-slate-900">{formatMoney(total)}</p>
            </div>
            <div className="app-card p-4">
              <p className="text-xs text-slate-500">Room charges</p>
              <p className="text-2xl font-bold text-slate-900">{rows.length}</p>
            </div>
            <div className="app-card p-4">
              <p className="text-xs text-slate-500">Rooms billed</p>
              <p className="text-2xl font-bold text-slate-900">{roomCount}</p>
            </div>
          </div>

          <div className="app-card overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {sortHeader("charged_at", "Charge date/time")}
                  {sortHeader("stay_night_date", "Folio night")}
                  {sortHeader("room", "Room")}
                  {sortHeader("guest", "Guest")}
                  {sortHeader("description", "Description")}
                  {sortHeader("source", "Source")}
                  {sortHeader("amount", "Amount", "right")}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      No room billing charges in the selected period.
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="whitespace-nowrap p-3">{formatChargedAt(row.charged_at)}</td>
                      <td className="whitespace-nowrap p-3">{row.stay_night_date || "-"}</td>
                      <td className="p-3 font-medium">{row.stays?.rooms?.room_number || "-"}</td>
                      <td className="p-3">
                        {row.stays?.hotel_customers
                          ? `${row.stays.hotel_customers.first_name} ${row.stays.hotel_customers.last_name}`.trim()
                          : "-"}
                      </td>
                      <td className="p-3">{row.description}</td>
                      <td className="p-3 capitalize">{row.auto_charge_source || "manual"}</td>
                      <td className="p-3 text-right font-medium tabular-nums">{formatMoney(Number(row.amount || 0))}</td>
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
