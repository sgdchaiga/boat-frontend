import React, { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { SaccoReportToolbar } from '@/components/common/SaccoReportToolbar';
import { downloadLoanReportPdf } from '@/lib/saccoReportPdf';
import { PageNotes } from '@/components/common/PageNotes';
import { SACCOPRO_PAGE } from '@/lib/saccoproPages';
import type { Loan } from '@/types/saccoWorkspace';
import { useAuth } from '@/contexts/AuthContext';

/** Days since last payment, or since disbursement, or since application (for outstanding / aging buckets). */
function daysSinceReferenceForAging(loan: Loan): number {
  const ref = loan.lastPaymentDate || loan.disbursementDate || loan.applicationDate;
  if (!ref) return 0;
  const raw = ref.includes('T') ? ref : `${String(ref).slice(0, 10)}T12:00:00`;
  const start = new Date(raw);
  if (Number.isNaN(start.getTime())) return 0;
  const end = new Date();
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
}

function bucketIndexForDays(days: number): number {
  if (days <= 30) return 0;
  if (days <= 60) return 1;
  if (days <= 90) return 2;
  if (days <= 180) return 3;
  if (days <= 365) return 4;
  return 5;
}

const AGING_BRACKETS = [
  'Current (0–30 days)',
  '31–60 days',
  '61–90 days',
  '91–180 days',
  '181–365 days',
  'Over 365 days',
] as const;

function computeAgingFromLoans(activeLoans: Loan[]) {
  const buckets = AGING_BRACKETS.map((bracket) => ({
    bracket,
    count: 0,
    amount: 0,
    pct: 0,
  }));
  for (const loan of activeLoans) {
    const bal = Number(loan.balance) || 0;
    if (bal <= 0) continue;
    const days = daysSinceReferenceForAging(loan);
    const idx = bucketIndexForDays(days);
    buckets[idx].count += 1;
    buckets[idx].amount += bal;
  }
  const totalAmount = buckets.reduce((s, b) => s + b.amount, 0);
  for (const b of buckets) {
    b.pct = totalAmount > 0 ? Math.round((b.amount / totalAmount) * 1000) / 10 : 0;
  }
  return { buckets, totalAmount };
}

export type LoanReportTabId = 'summary' | 'aging' | 'disbursement' | 'collection';

const VALID_TABS = new Set<LoanReportTabId>(['summary', 'aging', 'disbursement', 'collection']);

interface LoanReportsProps {
  loanReportTab?: LoanReportTabId | null;
  navigate?: (page: string, state?: Record<string, unknown>) => void;
}

const LoanReports: React.FC<LoanReportsProps> = ({ loanReportTab, navigate }) => {
  const { user } = useAuth();
  const { loans, formatCurrency } = useAppContext();
  const [reportType, setReportType] = useState<LoanReportTabId>(() =>
    loanReportTab && VALID_TABS.has(loanReportTab) ? loanReportTab : 'summary'
  );

  useEffect(() => {
    const next = loanReportTab && VALID_TABS.has(loanReportTab) ? loanReportTab : 'summary';
    setReportType(next);
  }, [loanReportTab]);

  const setTab = (id: LoanReportTabId) => {
    setReportType(id);
    navigate?.(SACCOPRO_PAGE.loanReports, { loanReportTab: id });
  };

  const active = loans.filter(l => l.status === 'disbursed');
  const totalDisbursed = loans.filter(l => ['disbursed', 'closed'].includes(l.status)).reduce((s, l) => s + l.amount, 0);
  const totalOutstanding = active.reduce((s, l) => s + l.balance, 0);
  const totalCollected = loans.reduce((s, l) => s + l.paidAmount, 0);

  const { aging, agingTotalAmount } = useMemo(() => {
    const r = computeAgingFromLoans(active);
    return { aging: r.buckets, agingTotalAmount: r.totalAmount };
  }, [active]);

  const reportDateLabel = useMemo(
    () =>
      new Date().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    []
  );

  const reports = [
    { id: 'summary', label: 'Portfolio Summary' },
    { id: 'aging', label: 'Aging Analysis' },
    { id: 'disbursement', label: 'Disbursement Report' },
    { id: 'collection', label: 'Collection Report' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Loan Reports</h1>
          <PageNotes ariaLabel="Loan reports help">
            <p>Generate and view loan portfolio reports.</p>
          </PageNotes>
        </div>
        <SaccoReportToolbar
          onPrint={() => window.print()}
          onPdf={() => {
            const today = new Date().toISOString().slice(0, 10);
            void downloadLoanReportPdf(reportType, loans, { dateFrom: today, dateTo: today, organizationId: user?.organization_id });
          }}
        />
      </div>

      {/* Report Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="flex border-b border-slate-100 overflow-x-auto">
          {reports.map(r => (
            <button key={r.id} onClick={() => setTab(r.id as LoanReportTabId)}
              className={`px-6 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${reportType === r.id ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {r.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {reportType === 'summary' && (
            <div className="space-y-6">
              <div className="text-center border-b border-slate-200 pb-4">
                <h2 className="text-xl font-bold text-slate-900">Loan Portfolio Summary Report</h2>
                <p className="text-sm text-slate-500">As at {reportDateLabel}</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Total Loans Issued', value: loans.length },
                  { label: 'Active Loans', value: active.length },
                  { label: 'Closed Loans', value: loans.filter(l => l.status === 'closed').length },
                  { label: 'Pending Approval', value: loans.filter(l => l.status === 'pending').length },
                ].map((s, i) => (
                  <div key={i} className="p-4 bg-slate-50 rounded-lg text-center">
                    <p className="text-2xl font-bold text-slate-900">{s.value}</p>
                    <p className="text-xs text-slate-500">{s.label}</p>
                  </div>
                ))}
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Metric</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Amount (KES)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {[
                    ['Total Amount Disbursed', totalDisbursed],
                    ['Total Outstanding Balance', totalOutstanding],
                    ['Total Amount Collected', totalCollected],
                    ['Total Interest Earned', 0],
                    ['Provision for Bad Debts', 0],
                    ['Net Loan Portfolio', totalOutstanding],
                  ].map(([l, v]) => (
                    <tr key={l as string} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 text-sm text-slate-700">{l}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-slate-900">{formatCurrency(v as number)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4">
                <h4 className="text-sm font-semibold text-slate-900 mb-2">By Loan Type</h4>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Type</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600">Count</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600">Disbursed</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {['Normal Loan', 'Emergency Loan', 'Development Loan', 'Education Loan'].map(type => {
                      const tl = loans.filter(l => l.loanType === type);
                      return (
                        <tr key={type}>
                          <td className="px-4 py-2 text-sm">{type}</td>
                          <td className="px-4 py-2 text-sm text-right">{tl.length}</td>
                          <td className="px-4 py-2 text-sm text-right">{formatCurrency(tl.reduce((s, l) => s + l.amount, 0))}</td>
                          <td className="px-4 py-2 text-sm text-right font-medium">{formatCurrency(tl.filter(l => l.status === 'disbursed').reduce((s, l) => s + l.balance, 0))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {reportType === 'aging' && (
            <div className="space-y-4">
              <div className="text-center border-b border-slate-200 pb-4">
                <h2 className="text-xl font-bold text-slate-900">Loan Aging Analysis</h2>
                <p className="text-sm text-slate-500">As at {reportDateLabel}</p>
                <p className="mt-2 text-xs text-slate-500 max-w-xl mx-auto">
                  Buckets use days since last repayment (or first disbursement if none). Only loans with status
                  &quot;disbursed&quot; and a positive balance are included.
                </p>
              </div>
              {agingTotalAmount === 0 ? (
                <p className="text-center text-sm text-slate-600 py-4">
                  No outstanding disbursed loans — nothing to age. When you add and disburse loans, balances will appear
                  here.
                </p>
              ) : null}
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Age Bracket</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">No. of Loans</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Amount (KES)</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">% of Portfolio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {aging.map(a => (
                    <tr key={a.bracket} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 text-sm text-slate-700">{a.bracket}</td>
                      <td className="px-4 py-3 text-sm text-right">{a.count}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium">{formatCurrency(a.amount)}</td>
                      <td className="px-4 py-3 text-sm text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${a.pct}%` }} />
                          </div>
                          <span>{a.pct}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold">
                    <td className="px-4 py-3 text-sm">Total</td>
                    <td className="px-4 py-3 text-sm text-right">{aging.reduce((s, a) => s + a.count, 0)}</td>
                    <td className="px-4 py-3 text-sm text-right">{formatCurrency(aging.reduce((s, a) => s + a.amount, 0))}</td>
                    <td className="px-4 py-3 text-sm text-right">
                      {agingTotalAmount > 0 ? "100%" : "—"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {reportType === 'disbursement' && (
            <div className="space-y-4">
              <div className="text-center border-b border-slate-200 pb-4">
                <h2 className="text-xl font-bold text-slate-900">Loan Disbursement Report</h2>
                <p className="text-sm text-slate-500">All disbursed loans</p>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['Loan ID', 'Member', 'Type', 'Amount', 'Date', 'Rate', 'Term'].map(h => (
                      <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-slate-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {loans.filter(l => l.disbursementDate).map(l => (
                    <tr key={l.id} className="hover:bg-slate-50/50">
                      <td className="px-3 py-2 text-sm font-mono">{l.id}</td>
                      <td className="px-3 py-2 text-sm">{l.memberName}</td>
                      <td className="px-3 py-2 text-sm">{l.loanType}</td>
                      <td className="px-3 py-2 text-sm font-medium">{formatCurrency(l.amount)}</td>
                      <td className="px-3 py-2 text-sm">{l.disbursementDate}</td>
                      <td className="px-3 py-2 text-sm">{l.interestRate}%</td>
                      <td className="px-3 py-2 text-sm">{l.term}m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {reportType === 'collection' && (
            <div className="space-y-4">
              <div className="text-center border-b border-slate-200 pb-4">
                <h2 className="text-xl font-bold text-slate-900">Loan Collection Report</h2>
                <p className="text-sm text-slate-500">Repayment status of active loans</p>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['Member', 'Loan Amount', 'Paid', 'Balance', 'Date of payment', 'Progress'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {active.map(l => {
                    const pct = Math.round((l.paidAmount / l.amount) * 100);
                    return (
                      <tr key={l.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 text-sm font-medium">{l.memberName}</td>
                        <td className="px-4 py-3 text-sm">{formatCurrency(l.amount)}</td>
                        <td className="px-4 py-3 text-sm text-emerald-600 font-medium">{formatCurrency(l.paidAmount)}</td>
                        <td className="px-4 py-3 text-sm text-red-600 font-medium">{formatCurrency(l.balance)}</td>
                        <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">
                          {l.lastPaymentDate
                            ? new Date(l.lastPaymentDate + 'T12:00:00').toLocaleDateString('en-UG', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })
                            : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs font-medium text-slate-600 w-10">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoanReports;
