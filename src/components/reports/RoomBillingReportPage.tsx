import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { filterByOrganizationId, filterJournalLinesByOrganizationId } from "../../lib/supabaseOrgFilter";
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
type ReconciliationStay = {
  id: string;
  actual_check_in: string | null;
  actual_check_out: string | null;
  rooms: { room_number: string } | null;
  hotel_customers: { first_name: string; last_name: string } | null;
};
type FolioAmount = { stay_id: string | null; amount: number; charge_type?: string; stay_night_date?: string | null; charged_at?: string };

type RoomChargeJournalLine = {
  debit: number | null;
  credit: number | null;
  journal_entries?: {
    id: string;
    entry_date: string;
    description: string | null;
    reference_id: string | null;
  } | null;
};

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
  const [reconciliationStays, setReconciliationStays] = useState<ReconciliationStay[]>([]);
  const [folioBillings, setFolioBillings] = useState<FolioAmount[]>([]);
  const [folioPayments, setFolioPayments] = useState<FolioAmount[]>([]);
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
      const journalLinesQuery = supabase
        .from("journal_entry_lines")
        .select(
          "debit, credit, gl_accounts!inner(account_type), journal_entries!inner(id,entry_date,description,reference_id)"
        )
        .eq("gl_accounts.account_type", "income")
        .eq("journal_entries.reference_type", "room_charge")
        .eq("journal_entries.is_posted", true)
        .eq("journal_entries.is_deleted", false)
        .gte("journal_entries.entry_date", fromDate)
        .lte("journal_entries.entry_date", toInclusiveDate);
      const scopedJournalLines = superAdmin
        ? filterJournalLinesByOrganizationId(journalLinesQuery, orgId, true)
        : journalLinesQuery;
      const staysQuery = filterByOrganizationId(supabase.from("stays").select("id,actual_check_in,actual_check_out,rooms(room_number),hotel_customers(first_name,last_name)").order("actual_check_in", { ascending: false }).limit(1000), orgId, superAdmin);
      const allBillingsQuery = filterByOrganizationId(supabase.from("billing").select("stay_id,amount,charge_type,stay_night_date,charged_at").not("stay_id", "is", null).limit(10000), orgId, superAdmin);
      const paymentsQuery = filterByOrganizationId(supabase.from("payments").select("stay_id,amount").eq("payment_status", "completed").not("stay_id", "is", null).limit(10000), orgId, superAdmin);
      const [byChargeDate, byFolioNight, journalLines, staysResult, allBillingsResult, paymentsResult] = await Promise.all([
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
        scopedJournalLines,
        staysQuery,
        allBillingsQuery,
        paymentsQuery,
      ]);
      if (byChargeDate.error && byFolioNight.error) throw byChargeDate.error;
      const rowMap = new Map<string, RoomBillingRow>();
      ([...(byChargeDate.data || []), ...(byFolioNight.data || [])] as unknown as RoomBillingRow[]).forEach((row) => {
        rowMap.set(row.id, row);
      });
      if (!journalLines.error) {
        const journalFallbacks = new Map<
          string,
          { entry: NonNullable<RoomChargeJournalLine["journal_entries"]>; amount: number }
        >();
        ((journalLines.data || []) as unknown as RoomChargeJournalLine[]).forEach((line) => {
          const entry = line.journal_entries;
          if (!entry) return;
          const current = journalFallbacks.get(entry.id);
          journalFallbacks.set(entry.id, {
            entry,
            amount: (current?.amount || 0) + Number(line.credit || 0) - Number(line.debit || 0),
          });
        });
        journalFallbacks.forEach(({ entry, amount }) => {
          if (entry.reference_id && rowMap.has(entry.reference_id)) return;
          if (Math.abs(amount) < 0.005) return;
          rowMap.set(`journal:${entry.id}`, {
            id: `journal:${entry.id}`,
            stay_id: null,
            description: entry.description || "Room charge",
            amount,
            charged_at: `${entry.entry_date}T12:00:00+03:00`,
            stay_night_date: entry.entry_date,
            auto_charge_source: "general ledger",
            stays: null,
          });
        });
      }
      setRows(Array.from(rowMap.values()));
      if (staysResult.error) throw staysResult.error;
      if (allBillingsResult.error) throw allBillingsResult.error;
      if (paymentsResult.error) throw paymentsResult.error;
      setReconciliationStays((staysResult.data || []) as unknown as ReconciliationStay[]);
      setFolioBillings((allBillingsResult.data || []) as unknown as FolioAmount[]);
      setFolioPayments((paymentsResult.data || []) as unknown as FolioAmount[]);
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
  const reconciliations = useMemo(() => reconciliationStays.map((stay) => {
    const stayBillings = folioBillings.filter((row) => row.stay_id === stay.id);
    const roomCharges = stayBillings.filter((row) => row.charge_type === "room");
    const start = stay.actual_check_in ? new Date(stay.actual_check_in) : null;
    const end = stay.actual_check_out ? new Date(stay.actual_check_out) : new Date();
    const expectedNights = start ? Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000)) : 0;
    const chargedNights = new Set(roomCharges.map((row) => row.stay_night_date || row.charged_at?.slice(0, 10))).size;
    const billed = stayBillings.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const paid = folioPayments.filter((row) => row.stay_id === stay.id).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return { stay, expectedNights, chargedNights, nightDifference: chargedNights - expectedNights, billed, paid, balance: billed - paid };
  }).filter((row) => row.billed !== 0 || row.paid !== 0 || row.nightDifference !== 0), [reconciliationStays, folioBillings, folioPayments]);
  const exceptionCount = reconciliations.filter((row) => row.nightDifference !== 0 || Math.abs(row.balance) > 0.01).length;
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
          <h1 className="text-3xl font-bold text-slate-900">Room billing &amp; cash-in reconciliation</h1>
          <PageNotes ariaLabel="Room billing report help">
            <p>One review page for expected room nights, posted charges, payments received and outstanding guest balances.</p>
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

          <div className="app-card mb-6 overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
              <div>
                <h2 className="font-semibold text-slate-900">Combined reconciliation</h2>
                <p className="text-xs text-slate-500">Check room nights and cash received on the same row. Investigate only rows marked Review.</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${exceptionCount ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{exceptionCount} to review</span>
            </div>
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-slate-50"><tr><th className="p-3 text-left">Guest / room</th><th className="p-3 text-right">Expected nights</th><th className="p-3 text-right">Charged nights</th><th className="p-3 text-right">Billed</th><th className="p-3 text-right">Paid</th><th className="p-3 text-right">Balance</th><th className="p-3 text-left">Result</th></tr></thead>
              <tbody>{reconciliations.length === 0 ? <tr><td colSpan={7} className="p-8 text-center text-emerald-700">All room stays are reconciled.</td></tr> : reconciliations.map(({stay,expectedNights,chargedNights,nightDifference,billed,paid,balance}) => {
                const needsReview = nightDifference !== 0 || Math.abs(balance) > 0.01;
                const guest = stay.hotel_customers ? `${stay.hotel_customers.first_name} ${stay.hotel_customers.last_name}`.trim() : "Guest";
                return <tr key={stay.id} className="border-t border-slate-100"><td className="p-3 font-medium">{guest} · Room {stay.rooms?.room_number || "—"}{stay.actual_check_out ? " · checked out" : ""}</td><td className="p-3 text-right">{expectedNights}</td><td className={`p-3 text-right ${nightDifference ? "font-semibold text-amber-700" : ""}`}>{chargedNights}{nightDifference ? ` (${nightDifference > 0 ? "+" : ""}${nightDifference})` : ""}</td><td className="p-3 text-right tabular-nums">{formatMoney(billed)}</td><td className="p-3 text-right tabular-nums">{formatMoney(paid)}</td><td className={`p-3 text-right font-semibold tabular-nums ${balance > 0.01 ? "text-amber-700" : balance < -0.01 ? "text-blue-700" : "text-emerald-700"}`}>{formatMoney(balance)}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${needsReview ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{needsReview ? "Review" : "Reconciled"}</span></td></tr>;
              })}</tbody>
            </table>
          </div>

          <h2 className="mb-3 text-lg font-semibold text-slate-900">Room charge detail</h2>

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
