import { useCallback, useEffect, useState } from "react";
import { Download, GraduationCap, Receipt, Users, Wallet } from "lucide-react";
import { jsPDF } from "jspdf";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { computeReportRange, type DateRangeKey } from "@/lib/reportsDateRange";

type SchoolStats = {
  feeCollected: number;
  paymentCount: number;
  outstandingBalance: number;
  activeStudents: number;
};

const PAGES = {
  feeCollections: "reports_school_fee_collections",
  outstanding: "reports_school_outstanding",
  enrollment: "reports_school_enrollment",
  dailyCash: "reports_school_daily_cash",
  incomeExpenditure: "reports_school_income_expenditure",
  feeTrends: "reports_school_fee_trends",
  topDefaulters: "reports_school_top_defaulters",
  termPerformance: "reports_school_term_performance",
  trialBalance: "accounting_trial",
  incomeStatement: "accounting_income",
  balanceSheet: "accounting_balance",
  cashFlow: "accounting_cashflow",
  budgetVariance: "reports_budget_variance",
} as const;

type Props = { onNavigate?: (page: string) => void };

export function SchoolReportsOverview({ onNavigate }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [stats, setStats] = useState<SchoolStats>({
    feeCollected: 0,
    paymentCount: 0,
    outstandingBalance: 0,
    activeStudents: 0,
  });
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [exportFormat, setExportFormat] = useState<"pdf" | "excel">("pdf");

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    const { from, to } = computeReportRange(dateRange, customFrom, customTo);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    setRangeFrom(fromIso);
    setRangeTo(toIso);

    const [payRes, invRes, studRes] = await Promise.all([
      supabase.from("school_payments").select("amount").eq("organization_id", orgId).gte("paid_at", fromIso).lt("paid_at", toIso),
      supabase
        .from("student_invoices")
        .select("total_due, amount_paid, status")
        .eq("organization_id", orgId)
        .neq("status", "cancelled"),
      supabase.from("students").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "active"),
    ]);

    const payments = payRes.data || [];
    const feeCollected = payments.reduce((s, p) => s + Number((p as { amount?: number }).amount ?? 0), 0);

    const invoices = (invRes.data || []) as { total_due?: number; amount_paid?: number }[];
    const outstandingBalance = invoices.reduce((sum, inv) => {
      const due = Number(inv.total_due ?? 0) - Number(inv.amount_paid ?? 0);
      return sum + Math.max(0, due);
    }, 0);

    setStats({
      feeCollected,
      paymentCount: payments.length,
      outstandingBalance,
      activeStudents: studRes.count ?? 0,
    });
    setLoading(false);
  }, [orgId, dateRange, customFrom, customTo]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const formatDate = (iso: string) => {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString();
  };

  const exportPdf = () => {
    if (!rangeFrom || !rangeTo) {
      alert("Report data not loaded yet.");
      return;
    }
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("School reports overview", 14, 20);
    doc.setFontSize(10);
    doc.text(`Period: ${formatDate(rangeFrom)} to ${formatDate(rangeTo)}`, 14, 28);
    let y = 42;
    const lines = [
      `Fee collections: ${stats.feeCollected.toFixed(2)}`,
      `Payments recorded: ${stats.paymentCount}`,
      `Outstanding fee balance: ${stats.outstandingBalance.toFixed(2)}`,
      `Active students: ${stats.activeStudents}`,
    ];
    lines.forEach((line) => {
      doc.text(line, 14, y);
      y += 8;
    });
    const fileLabel = `${formatDate(rangeFrom).replace(/\//g, "-")}_to_${formatDate(rangeTo).replace(/\//g, "-")}`;
    doc.save(`school_reports_overview_${fileLabel}.pdf`);
  };

  const exportCsv = () => {
    if (!rangeFrom || !rangeTo) {
      alert("Report data not loaded yet.");
      return;
    }
    const rows = [
      ["Metric", "Value"],
      ["From", formatDate(rangeFrom)],
      ["To", formatDate(rangeTo)],
      ["Fee collections", stats.feeCollected.toFixed(2)],
      ["Payments recorded", String(stats.paymentCount)],
      ["Outstanding fee balance", stats.outstandingBalance.toFixed(2)],
      ["Active students", String(stats.activeStudents)],
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "school_reports_overview.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-gradient-to-br from-slate-50 via-slate-100/30 to-indigo-50/30">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-200 rounded w-56" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-slate-200 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-gradient-to-br from-slate-50 via-slate-100/30 to-indigo-50/30">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Reports</h1>
            <PageNotes ariaLabel="School reports">
              <p>
                School-focused metrics from fee payments and invoices. Open financial and management reports below or from the sidebar (fee collections, daily
                cash, income &amp; expenditure, trends, defaulters, term summaries, GL statements, budget variance).
              </p>
            </PageNotes>
          </div>
          <p className="text-sm text-slate-600 mt-1">Overview for your organization — not hotel sales or operations.</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as "pdf" | "excel")}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="pdf">PDF</option>
            <option value="excel">Excel (CSV)</option>
          </select>
          <button type="button" onClick={() => (exportFormat === "pdf" ? exportPdf() : exportCsv())} className="app-btn-primary transition">
            <Download className="w-5 h-5" />
            <span className="hidden sm:inline">Export overview</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-slate-700">Date range (collections)</span>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
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
          </div>
          {dateRange === "custom" && (
            <div className="flex gap-2 items-center flex-wrap">
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
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl p-6 border border-slate-200 hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-emerald-100 p-3 rounded-lg">
              <Wallet className="w-6 h-6 text-emerald-700" />
            </div>
          </div>
          <p className="text-slate-600 text-sm mb-1">Fee collections</p>
          <p className="text-3xl font-bold text-slate-900">{stats.feeCollected.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          <p className="text-xs text-slate-500 mt-1">In selected period</p>
        </div>
        <div className="bg-white rounded-xl p-6 border border-slate-200 hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-sky-100 p-3 rounded-lg">
              <Receipt className="w-6 h-6 text-sky-700" />
            </div>
          </div>
          <p className="text-slate-600 text-sm mb-1">Payments recorded</p>
          <p className="text-3xl font-bold text-slate-900">{stats.paymentCount}</p>
          <p className="text-xs text-slate-500 mt-1">In selected period</p>
        </div>
        <div className="bg-white rounded-xl p-6 border border-slate-200 hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-amber-100 p-3 rounded-lg">
              <Wallet className="w-6 h-6 text-amber-700" />
            </div>
          </div>
          <p className="text-slate-600 text-sm mb-1">Outstanding fee balance</p>
          <p className="text-3xl font-bold text-slate-900">{stats.outstandingBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          <p className="text-xs text-slate-500 mt-1">All open invoices (not period-limited)</p>
        </div>
        <div className="bg-white rounded-xl p-6 border border-slate-200 hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-indigo-100 p-3 rounded-lg">
              <Users className="w-6 h-6 text-indigo-700" />
            </div>
          </div>
          <p className="text-slate-600 text-sm mb-1">Active students</p>
          <p className="text-3xl font-bold text-slate-900">{stats.activeStudents}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8 space-y-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900 mb-1">Financial reports</h2>
          <p className="text-sm text-slate-600 mb-3">Fees, cash, balances, and accounting views.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(
              [
                { page: PAGES.feeCollections, label: "Fee collection report", desc: "Per class and per student filters; payments by date and method" },
                { page: PAGES.outstanding, label: "Outstanding balances", desc: "Invoices with amount still due" },
                { page: PAGES.dailyCash, label: "Daily cash report", desc: "Cash and mobile money collections by day" },
                { page: PAGES.incomeExpenditure, label: "Income & expenditure", desc: "Fee income vs recorded expenses in the period" },
                { page: PAGES.trialBalance, label: "Trial balance", desc: "Chart of accounts balances (Accounting)" },
                { page: PAGES.incomeStatement, label: "Income statement", desc: "Profit and loss from the general ledger" },
                { page: PAGES.balanceSheet, label: "Balance sheet", desc: "Assets, liabilities, equity" },
                { page: PAGES.cashFlow, label: "Cash flow", desc: "Cash movement summary" },
                { page: PAGES.budgetVariance, label: "Budget variance analysis", desc: "Budget vs actual with usage bars" },
              ] as const
            ).map((item) => (
              <button
                key={item.page}
                type="button"
                onClick={() => onNavigate?.(item.page)}
                className="text-left rounded-xl border border-slate-200 p-4 hover:border-indigo-300 hover:bg-indigo-50/40 transition"
              >
                <div className="flex items-center gap-2 text-indigo-800 font-semibold text-sm">
                  <GraduationCap className="w-4 h-4 shrink-0" />
                  {item.label}
                </div>
                <p className="text-xs text-slate-600 mt-1">{item.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-bold text-slate-900 mb-1">Management reports</h2>
          <p className="text-sm text-slate-600 mb-3">Enrollment, trends, and receivables focus.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(
              [
                { page: PAGES.enrollment, label: "Student enrollment statistics", desc: "Headcount by class" },
                { page: PAGES.feeTrends, label: "Fee payment trends", desc: "Collections by month" },
                { page: PAGES.topDefaulters, label: "Top defaulters", desc: "Highest outstanding balances" },
                { page: PAGES.termPerformance, label: "Term performance summaries", desc: "Invoiced vs collected by term" },
              ] as const
            ).map((item) => (
              <button
                key={item.page}
                type="button"
                onClick={() => onNavigate?.(item.page)}
                className="text-left rounded-xl border border-slate-200 p-4 hover:border-indigo-300 hover:bg-indigo-50/40 transition"
              >
                <div className="flex items-center gap-2 text-indigo-800 font-semibold text-sm">
                  <Users className="w-4 h-4 shrink-0" />
                  {item.label}
                </div>
                <p className="text-xs text-slate-600 mt-1">{item.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 border border-slate-200">
        <h2 className="text-xl font-bold text-slate-900 mb-4">Summary</h2>
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            <span className="font-medium">Collections:</span> {stats.feeCollected.toFixed(2)} collected across {stats.paymentCount} fee payment
            {stats.paymentCount === 1 ? "" : "s"} in the selected period.
          </p>
          <p>
            <span className="font-medium">Receivables:</span> Outstanding balance across non-cancelled invoices is {stats.outstandingBalance.toFixed(2)}.
          </p>
          <p>
            <span className="font-medium">Enrollment:</span> {stats.activeStudents} active students on file.
          </p>
        </div>
      </div>
    </div>
  );
}
