import React, { useMemo, useState } from "react";
import { useAppContext } from "@/contexts/AppContext";
import { computeSaccoPerformanceRatios, type PeriodRange } from "@/lib/saccoPerformanceRatios";
import { PageNotes } from "@/components/common/PageNotes";
import { BarChart3 } from "lucide-react";

function fmtPct0(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function fmtRatio(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}×`;
}

/** yyyy-mm */
function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

const SaccoPerformanceDashboardPage: React.FC = () => {
  const { loans, members, cashbook, formatCurrency, saccoLoading } = useAppContext();

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(today);

  const range: PeriodRange = useMemo(() => ({ from, to }), [from, to]);

  const snapshot = useMemo(
    () => computeSaccoPerformanceRatios(loans, members, cashbook, range),
    [loans, members, cashbook, range]
  );

  const sortedCbAsc = useMemo(
    () => cashbook.slice().sort((a, b) => a.date.localeCompare(b.date)),
    [cashbook]
  );

  const board = useMemo(() => {
    const disbursedLike = loans.filter(
      (l) =>
        l.status === "disbursed" ||
        l.status === "defaulted" ||
        (l.status === "written_off" && l.balance > 0)
    );
    const portfolioOutstanding = disbursedLike.reduce((s, l) => s + Math.max(0, l.balance), 0);
    const woRemaining = loans.reduce((s, l) => s + Math.max(0, l.writtenOffRemaining ?? 0), 0);
    const defaultedBal = loans
      .filter((l) => l.status === "defaulted")
      .reduce((s, l) => s + Math.max(0, l.balance), 0);
    const atRisk = defaultedBal + woRemaining;
    const loansAtRiskPct = portfolioOutstanding + woRemaining > 0 ? (atRisk / (portfolioOutstanding + woRemaining)) * 100 : 0;
    const totalSavings = members.reduce((s, m) => s + Math.max(0, m.savingsBalance), 0);
    const totalLoansCount = loans.filter((l) => l.status !== "rejected").length;
    const cashAvailable = sortedCbAsc.length > 0 ? sortedCbAsc[sortedCbAsc.length - 1].balance : 0;

    const inRange = (d: string) => d >= range.from && d <= range.to;
    let income = 0;
    let expenses = 0;
    for (const e of cashbook) {
      if (!inRange(e.date)) continue;
      income += Number(e.credit || 0);
      expenses += Number(e.debit || 0);
    }

    return {
      loansAtRiskPct,
      atRisk,
      totalLoansCount,
      totalSavings,
      cashAvailable,
      income,
      expenses,
      portfolioOutstanding,
    };
  }, [loans, members, cashbook, sortedCbAsc, range.from, range.to]);

  const trend = useMemo(() => {
    const keys: string[] = [];
    const d = new Date();
    for (let i = 5; i >= 0; i--) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      keys.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`);
    }
    const creditBy = new Map<string, number>();
    const debitBy = new Map<string, number>();
    for (const k of keys) {
      creditBy.set(k, 0);
      debitBy.set(k, 0);
    }
    for (const e of cashbook) {
      const k = monthKey(e.date);
      if (!creditBy.has(k)) continue;
      creditBy.set(k, (creditBy.get(k) ?? 0) + Number(e.credit || 0));
      debitBy.set(k, (debitBy.get(k) ?? 0) + Number(e.debit || 0));
    }
    const maxVal = Math.max(1, ...keys.map((k) => Math.max(creditBy.get(k) ?? 0, debitBy.get(k) ?? 0)));
    return { keys, creditBy, debitBy, maxVal };
  }, [cashbook]);

  const support = [
    { title: "Sustainability", short: "Income vs running costs (approx.)", val: fmtRatio(snapshot.ossApprox) },
    { title: "Cash strength", short: "How activity compares to deposits", val: fmtRatio(snapshot.liquidityProxy) },
    { title: "Loans vs savings", short: "Outstanding loans per savings peso", val: fmtRatio(snapshot.loansToSavingsRatio) },
    { title: "Loan risk", short: "Stress in the lending book", val: fmtPct0(snapshot.parProxyPercent) },
    {
      title: "Profit ratio",
      short: "Surplus flavour vs deposits",
      val:
        snapshot.surplusToDepositsApprox === null ? "—" : fmtPct0(snapshot.surplusToDepositsApprox * 100),
    },
    { title: "Loan income", short: "Collections vs portfolio", val: fmtPct0(snapshot.portfolioYieldProxy) },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <BarChart3 className="text-emerald-600" size={28} />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Performance dashboard</h1>
            <p className="text-sm text-slate-500 mt-1">Readable signals for trustees — directional, not audited statements.</p>
          </div>
          <PageNotes ariaLabel="Board dashboard help">
            <p className="text-sm">
              Figures come from balances and cashbook text in BOAT. Name your ledger categories consistently for tighter accuracy.
            </p>
          </PageNotes>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase text-slate-500">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="px-2 py-1.5 border rounded-lg border-slate-200"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase text-slate-500">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="px-2 py-1.5 border rounded-lg border-slate-200"
            />
          </label>
        </div>
      </div>

      {saccoLoading && <p className="text-sm text-slate-500 animate-pulse">Refreshing numbers…</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-50 to-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Loans at risk</p>
          <p className="text-3xl font-extrabold text-rose-900 mt-1 tabular-nums">{fmtPct0(board.loansAtRiskPct)}</p>
          <p className="text-xs text-rose-900/75 mt-2">
            Exposure approx. <strong>{formatCurrency(board.atRisk)}</strong> vs performing balance.
          </p>
        </div>
        <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Total loans</p>
          <p className="text-3xl font-extrabold text-indigo-950 mt-1 tabular-nums">{board.totalLoansCount}</p>
          <p className="text-xs text-indigo-900/75 mt-2">Living applications &amp; facilities in the portfolio file.</p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Total savings</p>
          <p className="text-3xl font-extrabold text-emerald-950 mt-1 tabular-nums">{formatCurrency(board.totalSavings)}</p>
          <p className="text-xs text-emerald-900/75 mt-2">Member deposits rolled up across ordinary accounts.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase text-sky-800">Cash available</p>
          <p className="text-2xl font-bold text-sky-950 mt-1 tabular-nums">{formatCurrency(board.cashAvailable)}</p>
          <p className="text-[11px] text-slate-500 mt-2">Latest rolled balance on synced cashbook lines.</p>
        </div>
        <div className="rounded-2xl border border-teal-100 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase text-teal-800">Monthly income ({range.from.slice(5)}→{range.to.slice(5)})</p>
          <p className="text-2xl font-bold text-teal-950 mt-1 tabular-nums">{formatCurrency(board.income)}</p>
          <p className="text-[11px] text-slate-500 mt-2">Credits booked in selected window.</p>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase text-amber-800">Expenses</p>
          <p className="text-2xl font-bold text-amber-950 mt-1 tabular-nums">{formatCurrency(board.expenses)}</p>
          <p className="text-[11px] text-slate-500 mt-2">Debits in the same window.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900 mb-4">Trend (six months)</h2>
        <p className="text-xs text-slate-500 mb-6">Credits vs debits tallied monthly from synced cashbook — board-level pulse.</p>
        <div className="flex items-end gap-3 h-44">
          {trend.keys.map((k) => {
            const cred = trend.creditBy.get(k) ?? 0;
            const deb = trend.debitBy.get(k) ?? 0;
            const hCred = Math.round((cred / trend.maxVal) * 100);
            const hDeb = Math.round((deb / trend.maxVal) * 100);
            return (
              <div key={k} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <div className="flex gap-1 w-full justify-center items-end h-32">
                  <div
                    className="w-4 rounded-t-md bg-teal-500 min-h-[4px] transition-[height]"
                    style={{ height: `${hCred}%` }}
                    title={`In ${cred}`}
                  />
                  <div
                    className="w-4 rounded-t-md bg-amber-400 min-h-[4px] transition-[height]"
                    style={{ height: `${hDeb}%` }}
                    title={`Out ${deb}`}
                  />
                </div>
                <span className="text-[10px] text-slate-500 truncate w-full text-center">{k.slice(5)}</span>
              </div>
            );
          })}
        </div>
        <div className="flex gap-6 text-xs mt-4 text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-teal-500" /> Incoming
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-400" /> Outgoing
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50 p-5">
        <h2 className="text-sm font-bold text-slate-900 mb-3">Supporting metrics</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {support.map((s) => (
            <div key={s.title} className="rounded-lg border border-white bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold text-slate-500 uppercase">{s.title}</p>
              <p className="text-lg font-bold text-slate-900 tabular-nums">{s.val}</p>
              <p className="text-[11px] text-slate-500 mt-1">{s.short}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SaccoPerformanceDashboardPage;
