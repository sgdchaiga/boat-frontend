import React, { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useAppContext, Loan } from '@/contexts/AppContext';
import { Search, Eye, X, Printer, FileSpreadsheet } from 'lucide-react';
import { ModuleMessagingToolbar } from '@/components/communications/ModuleMessagingButtons';
import { buildLoanAmortizationSchedule } from '@/lib/saccoLoanMath';

function digitsOnlyPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

const LoanList: React.FC = () => {
  const { user } = useAuth();
  const communicationsEnabled = user?.enable_communications !== false;
  const { loans, formatCurrency, members, setCurrentPage } = useAppContext();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [viewLoan, setViewLoan] = useState<Loan | null>(null);
  const [schedulePreviewLoan, setSchedulePreviewLoan] = useState<Loan | null>(null);

  const filtered = loans.filter(l => {
    const matchSearch = l.memberName.toLowerCase().includes(search.toLowerCase()) || l.id.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || l.status === statusFilter;
    const matchType = typeFilter === 'all' || l.loanType === typeFilter;
    return matchSearch && matchStatus && matchType;
  });

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    approved: 'bg-blue-100 text-blue-700',
    disbursed: 'bg-emerald-100 text-emerald-700',
    closed: 'bg-slate-100 text-slate-600',
    rejected: 'bg-red-100 text-red-700',
    defaulted: 'bg-red-200 text-red-800',
    written_off: 'bg-rose-100 text-rose-800 border border-rose-200',
  };

  const totalPortfolio = filtered.reduce((s, l) => s + l.balance, 0);
  const totalDisbursed = filtered.filter(l => l.status === 'disbursed').reduce((s, l) => s + l.amount, 0);

  const memberPhoneById = useMemo(() => {
    const m = new Map<string, string>();
    for (const mem of members) {
      if (mem.phone) m.set(mem.id, digitsOnlyPhone(mem.phone));
    }
    return m;
  }, [members]);

  const getSchedule = (loan: Loan) => buildLoanAmortizationSchedule(loan);

  const printAmortizationSchedule = (loan: Loan) => {
    const rows = getSchedule(loan);
    const basisLabel = loan.interestBasis === 'flat' ? 'Flat rate (constant principal & interest)' : 'Declining balance';
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Amortization ${loan.id}</title>
<style>
body{font-family:system-ui,sans-serif;padding:24px;color:#0f172a;}
h1{font-size:18px;margin:0 0 4px;}
p.meta{margin:0 0 16px;font-size:13px;color:#475569;}
table{width:100%;border-collapse:collapse;font-size:12px;}
th,td{border:1px solid #e2e8f0;padding:8px;text-align:right;}
th:first-child,td:first-child{text-align:left;}
thead{background:#f8fafc;}
@media print{body{padding:12px;}}
</style></head><body>
<h1>Loan amortization — ${loan.loanNumber ?? loan.id}</h1>
<p class="meta">${loan.memberName} · ${basisLabel} · ${loan.term} mo @ ${loan.interestRate}% p.a.</p>
<table><thead><tr>
<th>Month</th><th>Payment</th><th>Principal</th><th>Interest</th><th>Balance</th>
</tr></thead><tbody>
${rows.map((s) => `<tr><td>${s.month}</td><td>${s.payment.toLocaleString('en-UG')}</td><td>${s.principal.toLocaleString('en-UG')}</td><td>${s.interest.toLocaleString('en-UG')}</td><td>${s.balance.toLocaleString('en-UG')}</td></tr>`).join('')}
</tbody></table>
</body></html>`;
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Loan Portfolio</h1>
        <p className="text-slate-500 text-sm">{loans.length} total loans | Outstanding: {formatCurrency(totalPortfolio)}</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Loans', value: loans.length, color: 'text-slate-900' },
          { label: 'Active Loans', value: loans.filter(l => l.status === 'disbursed').length, color: 'text-emerald-600' },
          { label: 'Total Disbursed', value: formatCurrency(totalDisbursed), color: 'text-blue-600' },
          { label: 'Outstanding Balance', value: formatCurrency(totalPortfolio), color: 'text-violet-600' },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search by member or loan ID..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none">
            <option value="all">All Status</option>
            {['pending', 'approved', 'disbursed', 'written_off', 'defaulted', 'closed', 'rejected'].map(s => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none">
            <option value="all">All Types</option>
            {['Normal Loan', 'Emergency Loan', 'Development Loan', 'Education Loan'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                {['Loan ID', 'Member', 'Type', 'Amount', 'Balance', 'Paid', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(l => {
                const paidPct = l.amount > 0 ? Math.round((l.paidAmount / l.amount) * 100) : 0;
                return (
                  <tr key={l.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 text-sm font-mono text-slate-900">{l.id}</td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{l.memberName}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{l.loanType}</td>
                    <td className="px-4 py-3 text-sm font-medium">{formatCurrency(l.amount)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-red-600">{formatCurrency(l.balance)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${paidPct}%` }} />
                        </div>
                        <span className="text-xs text-slate-500 w-8">{paidPct}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[l.status] || 'bg-slate-100'}`}>{l.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setViewLoan(l)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500" title="Loan details">
                          <Eye size={15} />
                        </button>
                        <button type="button" onClick={() => setSchedulePreviewLoan(l)} className="p-1.5 hover:bg-emerald-50 rounded-lg text-emerald-600" title="Amortization schedule">
                          <FileSpreadsheet size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* View Loan with Schedule */}
      {viewLoan && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setViewLoan(null)}>
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold">Loan Details - {viewLoan.id}</h2>
              <button onClick={() => setViewLoan(null)} className="p-1 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              {communicationsEnabled ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                <p className="text-xs font-semibold text-emerald-900 uppercase tracking-wide mb-2">Notify member</p>
                <ModuleMessagingToolbar
                  onNavigate={setCurrentPage}
                  phone={memberPhoneById.get(viewLoan.memberId) ?? ''}
                  defaultMessage={`Loan ${viewLoan.id} (${viewLoan.loanType}) — Balance ${formatCurrency(viewLoan.balance)}. Member: ${viewLoan.memberName}.`}
                  contextLabel={`loan:${viewLoan.id}:${viewLoan.memberName}`}
                  compact
                />
              </div>
              ) : null}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  ['Member', viewLoan.memberName], ['Type', viewLoan.loanType], ['Amount', formatCurrency(viewLoan.amount)],
                  ['Balance', formatCurrency(viewLoan.balance)], ['Rate', `${viewLoan.interestRate}%`], ['Term', `${viewLoan.term} months`],
                  ['Basis', viewLoan.interestBasis === 'flat' ? 'Flat (equal P & I)' : 'Declining balance'],
                  ['Monthly', formatCurrency(viewLoan.monthlyPayment)], ['Paid', formatCurrency(viewLoan.paidAmount)], ['Status', viewLoan.status],
                ].map(([l, v]) => (
                  <div key={l} className="p-3 bg-slate-50 rounded-lg">
                    <p className="text-xs text-slate-400">{l}</p>
                    <p className="text-sm font-medium text-slate-900">{v}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <h3 className="text-sm font-semibold text-slate-900">Amortization schedule</h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSchedulePreviewLoan(viewLoan)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <FileSpreadsheet size={14} /> Full preview
                  </button>
                  <button
                    type="button"
                    onClick={() => printAmortizationSchedule(viewLoan)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    <Printer size={14} /> Print
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto max-h-60">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Month</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Payment</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Principal</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Interest</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {getSchedule(viewLoan).map(s => (
                      <tr key={s.month} className="hover:bg-slate-50/50">
                        <td className="px-3 py-1.5">{s.month}</td>
                        <td className="px-3 py-1.5 text-right">{formatCurrency(s.payment)}</td>
                        <td className="px-3 py-1.5 text-right">{formatCurrency(s.principal)}</td>
                        <td className="px-3 py-1.5 text-right text-amber-600">{formatCurrency(s.interest)}</td>
                        <td className="px-3 py-1.5 text-right font-medium">{formatCurrency(s.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {schedulePreviewLoan && (
        <div
          className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
          onClick={() => setSchedulePreviewLoan(null)}
          role="dialog"
          aria-modal
          aria-label="Amortization schedule preview"
        >
          <div
            className="bg-white rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-slate-100 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Amortization — {schedulePreviewLoan.loanNumber ?? schedulePreviewLoan.id}</h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  {schedulePreviewLoan.memberName} · {schedulePreviewLoan.interestBasis === 'flat' ? 'Flat rate (constant principal & interest each month)' : 'Declining balance'} · {schedulePreviewLoan.term} mo @ {schedulePreviewLoan.interestRate}% p.a.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => printAmortizationSchedule(schedulePreviewLoan)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  <Printer size={16} /> Print
                </button>
                <button type="button" onClick={() => setSchedulePreviewLoan(null)} className="p-2 hover:bg-slate-100 rounded-lg" aria-label="Close">
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="overflow-auto flex-1 p-4">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 z-10">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Month</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Payment</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Principal</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Interest</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {getSchedule(schedulePreviewLoan).map((s) => (
                    <tr key={s.month} className="hover:bg-slate-50/50">
                      <td className="px-3 py-1.5">{s.month}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(s.payment)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(s.principal)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-amber-600">{formatCurrency(s.interest)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatCurrency(s.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoanList;
