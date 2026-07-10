import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, Download, Factory, Route } from "lucide-react";
import { PageNotes } from "../common/PageNotes";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId, filterJournalLinesByOrganizationId } from "../../lib/supabaseOrgFilter";
import { formatCurrency } from "../../lib/accountingReportExport";

type ReportMode = "wip" | "manufacturing_account";

type CostingRow = {
  id: string;
  period: string;
  product_name: string;
  material_cost: number;
  labor_cost: number;
  overhead_cost: number;
  production_entry_id?: string | null;
};

type WipAccount = {
  id: string;
  account_code: string | null;
  account_name: string | null;
};

type WipLedgerLine = {
  id: string;
  entry_date: string;
  description: string;
  reference_type: string | null;
  transaction_id: string | null;
  line_description: string;
  debit: number;
  credit: number;
};

type DrillKey =
  | "opening_wip"
  | "material"
  | "labor"
  | "overhead"
  | "manufacturing_costs"
  | "closing_wip"
  | "cogm";

type Props = {
  mode: ReportMode;
};

const money = (value: number) => formatCurrency(value, { currency: "UGX", locale: "en-UG" });
const today = () => new Date().toISOString().slice(0, 10);
const firstDayOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const periodKey = (date: string) => date.slice(0, 7);

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function ManufacturingAccountingReportsPage({ mode }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;
  const [fromDate, setFromDate] = useState(firstDayOfMonth());
  const [toDate, setToDate] = useState(today());
  const [rows, setRows] = useState<CostingRow[]>([]);
  const [wipAccount, setWipAccount] = useState<WipAccount | null>(null);
  const [wipLedgerLines, setWipLedgerLines] = useState<WipLedgerLine[]>([]);
  const [openingWip, setOpeningWip] = useState(0);
  const [closingWip, setClosingWip] = useState(0);
  const [activeDrill, setActiveDrill] = useState<DrillKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isWip = mode === "wip";

  useEffect(() => {
    void loadReport();
  }, [orgId, superAdmin, fromDate, toDate, mode]);

  const loadReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const [costingRows, account] = await Promise.all([loadCostingRows(), loadWipAccount()]);
      setRows(costingRows);
      setWipAccount(account);

      if (account?.id) {
        const [opening, closing, ledgerLines] = await Promise.all([
          loadWipBalance(account.id, addDays(fromDate, -1)),
          loadWipBalance(account.id, toDate),
          loadWipLedgerLines(account.id),
        ]);
        setOpeningWip(opening);
        setClosingWip(closing);
        setWipLedgerLines(ledgerLines);
      } else {
        setOpeningWip(0);
        setClosingWip(0);
        setWipLedgerLines([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load manufacturing report.");
      setRows([]);
      setOpeningWip(0);
      setClosingWip(0);
      setWipLedgerLines([]);
    } finally {
      setLoading(false);
    }
  };

  const loadCostingRows = async (): Promise<CostingRow[]> => {
    const fromPeriod = periodKey(fromDate);
    const toPeriod = periodKey(toDate);
    const query = filterByOrganizationId(
      supabase
        .from("manufacturing_costing_entries")
        .select("id,period,product_name,material_cost,labor_cost,overhead_cost,production_entry_id")
        .gte("period", fromPeriod)
        .lte("period", toPeriod),
      orgId,
      superAdmin
    );
    const { data, error: fetchError } = await query.order("period", { ascending: true });
    if (fetchError) {
      if (String(fetchError.message || "").includes("production_entry_id")) {
        const fallbackQuery = filterByOrganizationId(
          supabase
            .from("manufacturing_costing_entries")
            .select("id,period,product_name,material_cost,labor_cost,overhead_cost")
            .gte("period", fromPeriod)
            .lte("period", toPeriod),
          orgId,
          superAdmin
        );
        const fallback = await fallbackQuery.order("period", { ascending: true });
        if (fallback.error) throw fallback.error;
        return ((fallback.data || []) as Array<Record<string, unknown>>).map(mapCostingRow);
      }
      throw fetchError;
    }
    return ((data || []) as Array<Record<string, unknown>>).map(mapCostingRow);
  };

  const loadWipAccount = async (): Promise<WipAccount | null> => {
    let mappedId: string | null = null;
    if (orgId) {
      const { data } = await supabase
        .from("journal_gl_settings")
        .select("manufacturing_wip_gl_account_id")
        .eq("organization_id", orgId)
        .maybeSingle();
      mappedId = (data as { manufacturing_wip_gl_account_id?: string | null } | null)?.manufacturing_wip_gl_account_id ?? null;
    }

    if (mappedId) {
      const { data, error: accountError } = await supabase
        .from("gl_accounts")
        .select("id,account_code,account_name")
        .eq("id", mappedId)
        .maybeSingle();
      if (accountError) throw accountError;
      if (data) return data as WipAccount;
    }

    let fallbackQuery = supabase
      .from("gl_accounts")
      .select("id,account_code,account_name")
      .or("account_name.ilike.%work in progress%,account_name.ilike.%wip%,account_code.eq.1172")
      .limit(1);
    if (orgId) fallbackQuery = fallbackQuery.or(`organization_id.eq.${orgId},organization_id.is.null`);
    const { data: fallback, error: fallbackError } = await fallbackQuery.maybeSingle();
    if (fallbackError) throw fallbackError;
    return (fallback as WipAccount | null) ?? null;
  };

  const loadWipBalance = async (accountId: string, asOfDate: string): Promise<number> => {
    const query = filterJournalLinesByOrganizationId(
      supabase
        .from("journal_entry_lines")
        .select("debit,credit,journal_entries!inner(entry_date,is_posted,is_deleted,organization_id)")
        .eq("gl_account_id", accountId)
        .lte("journal_entries.entry_date", asOfDate)
        .eq("journal_entries.is_posted", true)
        .eq("journal_entries.is_deleted", false),
      orgId,
      superAdmin
    );
    const { data, error: linesError } = await query;
    if (linesError) throw linesError;
    return ((data || []) as Array<Record<string, unknown>>).reduce(
      (sum, line) => sum + toNumber(line.debit) - toNumber(line.credit),
      0
    );
  };

  const loadWipLedgerLines = async (accountId: string): Promise<WipLedgerLine[]> => {
    const query = filterJournalLinesByOrganizationId(
      supabase
        .from("journal_entry_lines")
        .select("id,debit,credit,line_description,journal_entries!inner(id,entry_date,description,transaction_id,reference_type,is_posted,is_deleted,organization_id)")
        .eq("gl_account_id", accountId)
        .gte("journal_entries.entry_date", fromDate)
        .lte("journal_entries.entry_date", toDate)
        .eq("journal_entries.is_posted", true)
        .eq("journal_entries.is_deleted", false)
        .order("entry_date", { ascending: false, referencedTable: "journal_entries" })
        .limit(500),
      orgId,
      superAdmin
    );
    const { data, error: linesError } = await query;
    if (linesError) throw linesError;
    return ((data || []) as Array<Record<string, unknown>>).map((line) => {
      const entry = line.journal_entries as Record<string, unknown> | null;
      return {
        id: String(line.id ?? ""),
        entry_date: String(entry?.entry_date ?? ""),
        description: String(entry?.description ?? ""),
        reference_type: entry?.reference_type == null ? null : String(entry.reference_type),
        transaction_id: entry?.transaction_id == null ? null : String(entry.transaction_id),
        line_description: String(line.line_description ?? ""),
        debit: toNumber(line.debit),
        credit: toNumber(line.credit),
      };
    });
  };

  const totals = useMemo(() => {
    const material = rows.reduce((sum, r) => sum + r.material_cost, 0);
    const labor = rows.reduce((sum, r) => sum + r.labor_cost, 0);
    const overhead = rows.reduce((sum, r) => sum + r.overhead_cost, 0);
    const manufacturingCosts = material + labor + overhead;
    const cogm = openingWip + manufacturingCosts - closingWip;
    return { material, labor, overhead, manufacturingCosts, cogm };
  }, [rows, openingWip, closingWip]);

  const exportCsv = () => {
    const lines = [
      ["Manufacturing report", isWip ? "WIP report" : "Manufacturing account"],
      ["From", fromDate, "To", toDate],
      ["Opening WIP", String(openingWip)],
      ["Direct materials used", String(totals.material)],
      ["Direct labour", String(totals.labor)],
      ["Factory overhead", String(totals.overhead)],
      ["Total manufacturing costs", String(totals.manufacturingCosts)],
      ["Closing WIP", String(closingWip)],
      ["Cost of goods manufactured", String(totals.cogm)],
      [],
      ["Period", "Product", "Material", "Labour", "Overhead", "Total"],
      ...rows.map((r) => [
        r.period,
        r.product_name.replaceAll(",", " "),
        String(r.material_cost),
        String(r.labor_cost),
        String(r.overhead_cost),
        String(r.material_cost + r.labor_cost + r.overhead_cost),
      ]),
    ];
    const blob = new Blob([lines.map((l) => l.join(",")).join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${isWip ? "wip_report" : "manufacturing_account"}_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const title = isWip ? "WIP report" : "Manufacturing account";
  const Icon = isWip ? Route : Factory;
  const setDrill = (key: DrillKey) => setActiveDrill((current) => (current === key ? null : key));

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
              <PageNotes ariaLabel={`${title} help`}>
                <p>
                  {isWip
                    ? "Tracks opening WIP, production costs added, completed production transferred out, and closing WIP from the manufacturing WIP ledger account."
                    : "Calculates cost of goods manufactured as opening WIP plus direct materials, direct labour, and factory overhead, less closing WIP."}
                </p>
              </PageNotes>
            </div>
            <p className="text-sm text-slate-600">
              {wipAccount ? `WIP account: ${wipAccount.account_code ?? ""} ${wipAccount.account_name ?? ""}`.trim() : "WIP account is not mapped."}
            </p>
          </div>
        </div>
        <button type="button" onClick={exportCsv} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50">
          <Download className="h-4 w-4" aria-hidden />
          CSV
        </button>
      </div>

      <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <label className="text-xs font-medium text-slate-600">
          From
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          To
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
        </label>
      </div>

      {!wipAccount && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Map the Manufacturing WIP account in Admin - Journal account settings so opening and closing WIP come from the ledger.
        </div>
      )}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard label="Production costs added" value={totals.manufacturingCosts} />
        <SummaryCard label="Closing WIP" value={closingWip} />
        <SummaryCard label="Cost of goods manufactured" value={totals.cogm} emphasized />
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Manufacturing account schedule</h2>
        <div className="mt-4 divide-y divide-slate-100 text-sm">
          <ScheduleLine label="Opening work in progress" value={openingWip} active={activeDrill === "opening_wip"} onClick={() => setDrill("opening_wip")} />
          <ScheduleLine label="Direct materials used" value={totals.material} active={activeDrill === "material"} onClick={() => setDrill("material")} />
          <ScheduleLine label="Direct labour" value={totals.labor} active={activeDrill === "labor"} onClick={() => setDrill("labor")} />
          <ScheduleLine label="Factory overhead applied" value={totals.overhead} active={activeDrill === "overhead"} onClick={() => setDrill("overhead")} />
          <ScheduleLine label="Total manufacturing costs" value={totals.manufacturingCosts} strong active={activeDrill === "manufacturing_costs"} onClick={() => setDrill("manufacturing_costs")} />
          <ScheduleLine label="Less closing work in progress" value={-closingWip} active={activeDrill === "closing_wip"} onClick={() => setDrill("closing_wip")} />
          <ScheduleLine label="Cost of goods manufactured" value={totals.cogm} strong total active={activeDrill === "cogm"} onClick={() => setDrill("cogm")} />
        </div>
        {activeDrill && (
          <DrillDownPanel
            activeDrill={activeDrill}
            fromDate={fromDate}
            toDate={toDate}
            rows={rows}
            wipLedgerLines={wipLedgerLines}
            openingWip={openingWip}
            closingWip={closingWip}
            totals={totals}
          />
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Costing detail</h2>
          <p className="mt-1 text-sm text-slate-600">Batches included by costing period.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-3 text-left">Period</th>
                <th className="p-3 text-left">Product</th>
                <th className="p-3 text-right">Materials</th>
                <th className="p-3 text-right">Labour</th>
                <th className="p-3 text-right">Overhead</th>
                <th className="p-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">Loading...</td>
                </tr>
              )}
              {!loading && rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="p-3">{row.period}</td>
                  <td className="p-3">{row.product_name}</td>
                  <td className="p-3 text-right tabular-nums">{money(row.material_cost)}</td>
                  <td className="p-3 text-right tabular-nums">{money(row.labor_cost)}</td>
                  <td className="p-3 text-right tabular-nums">{money(row.overhead_cost)}</td>
                  <td className="p-3 text-right font-semibold tabular-nums">{money(row.material_cost + row.labor_cost + row.overhead_cost)}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">No manufacturing costing entries for this period.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function mapCostingRow(row: Record<string, unknown>): CostingRow {
  return {
    id: String(row.id ?? ""),
    period: String(row.period ?? ""),
    product_name: String(row.product_name ?? ""),
    material_cost: toNumber(row.material_cost),
    labor_cost: toNumber(row.labor_cost),
    overhead_cost: toNumber(row.overhead_cost),
    production_entry_id: row.production_entry_id == null ? null : String(row.production_entry_id),
  };
}

function SummaryCard({ label, value, emphasized = false }: { label: string; value: number; emphasized?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${emphasized ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${emphasized ? "text-emerald-800" : "text-slate-900"}`}>{money(value)}</p>
    </div>
  );
}

function ScheduleLine({
  label,
  value,
  strong = false,
  total = false,
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  strong?: boolean;
  total?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-4 py-3 text-left transition hover:bg-slate-50 ${total ? "border-t border-slate-300" : ""} ${active ? "bg-emerald-50" : ""}`}
    >
      <span className={`flex items-center gap-2 pl-2 ${strong ? "font-semibold text-slate-900" : "text-slate-700"}`}>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${active ? "rotate-180 text-emerald-700" : ""}`} aria-hidden />
        {label}
      </span>
      <span className={`pr-2 text-right tabular-nums ${strong ? "font-semibold text-slate-900" : "text-slate-700"}`}>{money(value)}</span>
    </button>
  );
}

function DrillDownPanel({
  activeDrill,
  fromDate,
  toDate,
  rows,
  wipLedgerLines,
  openingWip,
  closingWip,
  totals,
}: {
  activeDrill: DrillKey;
  fromDate: string;
  toDate: string;
  rows: CostingRow[];
  wipLedgerLines: WipLedgerLine[];
  openingWip: number;
  closingWip: number;
  totals: { material: number; labor: number; overhead: number; manufacturingCosts: number; cogm: number };
}) {
  const headingByDrill: Record<DrillKey, string> = {
    opening_wip: "Opening WIP drill down",
    material: "Direct materials drill down",
    labor: "Direct labour drill down",
    overhead: "Factory overhead drill down",
    manufacturing_costs: "Total manufacturing costs drill down",
    closing_wip: "Closing WIP drill down",
    cogm: "Cost of goods manufactured drill down",
  };

  const componentRows =
    activeDrill === "material"
      ? rows.filter((row) => row.material_cost !== 0)
      : activeDrill === "labor"
        ? rows.filter((row) => row.labor_cost !== 0)
        : activeDrill === "overhead"
          ? rows.filter((row) => row.overhead_cost !== 0)
          : ["manufacturing_costs", "cogm"].includes(activeDrill)
            ? rows
            : [];

  return (
    <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50/40">
      <div className="border-b border-emerald-100 p-4">
        <h3 className="text-sm font-semibold text-slate-900">{headingByDrill[activeDrill]}</h3>
        <p className="mt-1 text-sm text-slate-600">
          {activeDrill === "opening_wip"
            ? `Opening WIP is the WIP ledger balance as of ${addDays(fromDate, -1)}.`
            : activeDrill === "closing_wip"
              ? `Closing WIP is the WIP ledger balance as of ${toDate}. Period WIP movements are shown below.`
              : activeDrill === "cogm"
                ? "COGM = opening WIP + direct materials + direct labour + factory overhead - closing WIP."
                : "Amounts are grouped from manufacturing costing entries in the selected period."}
        </p>
      </div>

      {["opening_wip", "closing_wip"].includes(activeDrill) ? (
        <WipLedgerDrillDown lines={wipLedgerLines} openingWip={openingWip} closingWip={closingWip} activeDrill={activeDrill} />
      ) : activeDrill === "cogm" ? (
        <>
          <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-5">
            <MiniAmount label="Opening WIP" value={openingWip} />
            <MiniAmount label="Materials" value={totals.material} />
            <MiniAmount label="Labour" value={totals.labor} />
            <MiniAmount label="Overhead" value={totals.overhead} />
            <MiniAmount label="Closing WIP" value={-closingWip} />
          </div>
          <CostingRowsTable rows={componentRows} amountMode="total" />
        </>
      ) : (
        <CostingRowsTable
          rows={componentRows}
          amountMode={activeDrill === "material" ? "material" : activeDrill === "labor" ? "labor" : activeDrill === "overhead" ? "overhead" : "total"}
        />
      )}
    </div>
  );
}

function CostingRowsTable({ rows, amountMode }: { rows: CostingRow[]; amountMode: "material" | "labor" | "overhead" | "total" }) {
  const amountFor = (row: CostingRow) => {
    if (amountMode === "material") return row.material_cost;
    if (amountMode === "labor") return row.labor_cost;
    if (amountMode === "overhead") return row.overhead_cost;
    return row.material_cost + row.labor_cost + row.overhead_cost;
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-white/70">
          <tr>
            <th className="p-3 text-left">Period</th>
            <th className="p-3 text-left">Product</th>
            <th className="p-3 text-right">Materials</th>
            <th className="p-3 text-right">Labour</th>
            <th className="p-3 text-right">Overhead</th>
            <th className="p-3 text-right">Drill amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`drill-${row.id}`} className="border-t border-emerald-100">
              <td className="p-3">{row.period}</td>
              <td className="p-3">{row.product_name}</td>
              <td className="p-3 text-right tabular-nums">{money(row.material_cost)}</td>
              <td className="p-3 text-right tabular-nums">{money(row.labor_cost)}</td>
              <td className="p-3 text-right tabular-nums">{money(row.overhead_cost)}</td>
              <td className="p-3 text-right font-semibold tabular-nums">{money(amountFor(row))}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="p-5 text-center text-slate-500">No supporting costing entries for this line.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function WipLedgerDrillDown({
  lines,
  openingWip,
  closingWip,
  activeDrill,
}: {
  lines: WipLedgerLine[];
  openingWip: number;
  closingWip: number;
  activeDrill: DrillKey;
}) {
  const periodMovement = lines.reduce((sum, line) => sum + line.debit - line.credit, 0);
  return (
    <>
      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
        <MiniAmount label="Opening WIP" value={openingWip} />
        <MiniAmount label="Period movement" value={periodMovement} />
        <MiniAmount label="Closing WIP" value={closingWip} emphasized={activeDrill === "closing_wip"} />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-white/70">
            <tr>
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">Entry</th>
              <th className="p-3 text-left">Line</th>
              <th className="p-3 text-right">Debit</th>
              <th className="p-3 text-right">Credit</th>
              <th className="p-3 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={`wip-${line.id}`} className="border-t border-emerald-100">
                <td className="p-3 whitespace-nowrap">{line.entry_date}</td>
                <td className="p-3">
                  <div className="font-medium text-slate-800">{line.description || line.reference_type || "Journal entry"}</div>
                  {line.transaction_id && <div className="text-xs text-slate-500">{line.transaction_id}</div>}
                </td>
                <td className="p-3">{line.line_description}</td>
                <td className="p-3 text-right tabular-nums">{money(line.debit)}</td>
                <td className="p-3 text-right tabular-nums">{money(line.credit)}</td>
                <td className="p-3 text-right font-semibold tabular-nums">{money(line.debit - line.credit)}</td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={6} className="p-5 text-center text-slate-500">No WIP ledger movements in this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MiniAmount({ label, value, emphasized = false }: { label: string; value: number; emphasized?: boolean }) {
  return (
    <div className={`rounded-lg border bg-white p-3 ${emphasized ? "border-emerald-300" : "border-emerald-100"}`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900 tabular-nums">{money(value)}</p>
    </div>
  );
}
