import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, FileText, RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { businessTodayISO } from "../../lib/timezone";
import { downloadCsv, downloadXlsx, exportAccountingPdf } from "../../lib/accountingReportExport";
import { PageNotes } from "../common/PageNotes";

type SessionRow = {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  closing_cash_counted: number | null;
  expected_cash: number | null;
  variance_amount: number | null;
  status: "open" | "closed";
  opened_by: string | null;
};

function money(n: number): string {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function RetailShiftVarianceReportPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [fromDate, setFromDate] = useState(businessTodayISO());
  const [toDate, setToDate] = useState(businessTodayISO());
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const start = new Date(`${fromDate}T00:00:00`);
      const end = new Date(`${toDate}T00:00:00`);
      end.setDate(end.getDate() + 1);
      const { data, error: qErr } = await filterByOrganizationId(
        supabase
          .from("retail_cashier_sessions")
          .select("id,opened_at,closed_at,opening_float,closing_cash_counted,expected_cash,variance_amount,status,opened_by")
          .gte("opened_at", start.toISOString())
          .lt("opened_at", end.toISOString())
          .order("opened_at", { ascending: false }),
        orgId,
        superAdmin
      );
      if (qErr) throw qErr;
      setRows((data || []) as SessionRow[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load shift variance report.");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.openingFloat += Number(r.opening_float ?? 0);
        acc.expected += Number(r.expected_cash ?? 0);
        acc.counted += Number(r.closing_cash_counted ?? 0);
        acc.variance += Number(r.variance_amount ?? 0);
        return acc;
      },
      { openingFloat: 0, expected: 0, counted: 0, variance: 0 }
    );
  }, [rows]);

  const exportRows = useMemo<(string | number)[][]>(() => {
    const header = ["Opened At", "Closed At", "Status", "Opened By", "Opening Float", "Expected Cash", "Counted Cash", "Variance"];
    const body = rows.map((r) => [
      new Date(r.opened_at).toISOString(),
      r.closed_at ? new Date(r.closed_at).toISOString() : "",
      r.status,
      r.opened_by || "",
      Number(r.opening_float ?? 0).toFixed(2),
      Number(r.expected_cash ?? 0).toFixed(2),
      Number(r.closing_cash_counted ?? 0).toFixed(2),
      Number(r.variance_amount ?? 0).toFixed(2),
    ]);
    body.push([
      "TOTAL",
      "",
      "",
      "",
      totals.openingFloat.toFixed(2),
      totals.expected.toFixed(2),
      totals.counted.toFixed(2),
      totals.variance.toFixed(2),
    ]);
    return [header, ...body];
  }, [rows, totals]);

  const exportCsvFile = () => {
    downloadCsv(`retail-shift-variance-${fromDate}-to-${toDate}.csv`, exportRows);
  };

  const exportExcelFile = () => {
    downloadXlsx(`retail-shift-variance-${fromDate}-to-${toDate}.xlsx`, exportRows, {
      companyName: user?.organization_name || "BOAT",
      sheetName: "Shift Variance",
    });
  };

  const exportPdfFile = () => {
    exportAccountingPdf({
      title: "Retail Shift Variance Report",
      subtitle: `Period: ${fromDate} to ${toDate}`,
      filename: `retail-shift-variance-${fromDate}-to-${toDate}.pdf`,
      companyName: user?.organization_name || "BOAT",
      sections: [
        {
          title: "Cashier Sessions",
          head: ["Opened At", "Closed At", "Status", "Opened By", "Opening Float", "Expected", "Counted", "Variance"],
          body: rows.map((r) => [
            new Date(r.opened_at).toLocaleString(),
            r.closed_at ? new Date(r.closed_at).toLocaleString() : "Open",
            r.status,
            r.opened_by || "—",
            Number(r.opening_float ?? 0).toFixed(2),
            Number(r.expected_cash ?? 0).toFixed(2),
            Number(r.closing_cash_counted ?? 0).toFixed(2),
            Number(r.variance_amount ?? 0).toFixed(2),
          ]),
        },
      ],
      footerLines: [
        `Total opening float: ${totals.openingFloat.toFixed(2)}`,
        `Total expected cash: ${totals.expected.toFixed(2)}`,
        `Total counted cash: ${totals.counted.toFixed(2)}`,
        `Total variance: ${totals.variance.toFixed(2)}`,
      ],
    });
  };

  const printSlip = () => {
    const company = user?.organization_name || "BOAT";
    const lines = [
      `${company}`,
      "Retail Shift Variance Slip",
      `Period: ${fromDate} to ${toDate}`,
      `Generated: ${new Date().toLocaleString()}`,
      "--------------------------------",
      `Sessions: ${rows.length}`,
      `Opening Float: ${totals.openingFloat.toFixed(2)}`,
      `Expected Cash: ${totals.expected.toFixed(2)}`,
      `Counted Cash: ${totals.counted.toFixed(2)}`,
      `Variance: ${totals.variance.toFixed(2)}`,
      "--------------------------------",
      "Top Sessions:",
      ...rows.slice(0, 8).map((r, idx) => {
        const when = new Date(r.opened_at).toLocaleTimeString();
        const variance = Number(r.variance_amount ?? 0).toFixed(2);
        return `${idx + 1}. ${when} | ${r.status} | var ${variance}`;
      }),
    ];
    const html = `
      <html>
        <head>
          <title>Retail Shift Variance Slip</title>
          <style>
            @media print { body { margin: 0; } }
            body {
              font-family: "Courier New", monospace;
              font-size: 12px;
              width: 72mm;
              padding: 6px;
              color: #111;
              white-space: pre-wrap;
            }
          </style>
        </head>
        <body>${lines.join("\n")}</body>
      </html>
    `;
    const win = window.open("", "_blank", "width=420,height=720");
    if (!win) {
      alert("Unable to open print window.");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="p-6 md:p-8">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="text-3xl font-bold text-slate-900">Retail Shift Variance Report</h1>
        <PageNotes ariaLabel="Retail shift variance help">
          <p>Track opening float, expected closing cash, counted cash, and till variance by cashier session.</p>
        </PageNotes>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-slate-600 mb-1">From</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-600 mb-1">To</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
        <button type="button" onClick={exportCsvFile} className="inline-flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50" disabled={rows.length === 0}>
          <Download className="w-4 h-4" />
          CSV
        </button>
        <button type="button" onClick={exportExcelFile} className="inline-flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50" disabled={rows.length === 0}>
          <FileSpreadsheet className="w-4 h-4" />
          Excel
        </button>
        <button type="button" onClick={exportPdfFile} className="inline-flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50" disabled={rows.length === 0}>
          <FileText className="w-4 h-4" />
          PDF
        </button>
        <button type="button" onClick={printSlip} className="inline-flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50" disabled={rows.length === 0}>
          <FileText className="w-4 h-4" />
          Print Slip
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading shift variance report...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No cashier sessions for this period.</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-200">
                <th className="py-2 pr-2">Opened At</th>
                <th className="py-2 pr-2">Closed At</th>
                <th className="py-2 pr-2">Status</th>
                <th className="py-2 pr-2">Opened By</th>
                <th className="py-2 pr-2 text-right">Opening Float</th>
                <th className="py-2 pr-2 text-right">Expected</th>
                <th className="py-2 pr-2 text-right">Counted</th>
                <th className="py-2 pr-2 text-right">Variance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-2 pr-2">{new Date(r.opened_at).toLocaleString()}</td>
                  <td className="py-2 pr-2">{r.closed_at ? new Date(r.closed_at).toLocaleString() : "Open"}</td>
                  <td className="py-2 pr-2 capitalize">{r.status}</td>
                  <td className="py-2 pr-2">{r.opened_by || "—"}</td>
                  <td className="py-2 pr-2 text-right">{money(r.opening_float)}</td>
                  <td className="py-2 pr-2 text-right">{money(r.expected_cash ?? 0)}</td>
                  <td className="py-2 pr-2 text-right">{money(r.closing_cash_counted ?? 0)}</td>
                  <td className={`py-2 pr-2 text-right font-semibold ${(r.variance_amount ?? 0) < 0 ? "text-red-700" : "text-emerald-700"}`}>
                    {money(r.variance_amount ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td className="py-2 pr-2">Total</td>
                <td className="py-2 pr-2" />
                <td className="py-2 pr-2" />
                <td className="py-2 pr-2" />
                <td className="py-2 pr-2 text-right">{money(totals.openingFloat)}</td>
                <td className="py-2 pr-2 text-right">{money(totals.expected)}</td>
                <td className="py-2 pr-2 text-right">{money(totals.counted)}</td>
                <td className={`py-2 pr-2 text-right ${totals.variance < 0 ? "text-red-700" : "text-emerald-700"}`}>{money(totals.variance)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
