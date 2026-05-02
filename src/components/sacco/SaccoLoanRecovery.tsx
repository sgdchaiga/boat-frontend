import React, { useMemo } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import type { Loan } from '@/types/saccoWorkspace';
import { Phone, UserRound, Printer, Landmark } from 'lucide-react';
import { PageNotes } from '@/components/common/PageNotes';
import { SACCOPRO_PAGE } from '@/lib/saccoproPages';

/** Heuristic “overdue”: defaulted, matured with balance, or weak payment momentum (no repayment schedule rows in MVP). */
function isLikelyOverdueLoan(l: Loan): boolean {
  if ((l.status !== 'disbursed' && l.status !== 'defaulted') || l.balance <= 0) return false;
  if (l.status === 'defaulted') return true;
  const disb = l.disbursementDate ? new Date(`${l.disbursementDate}T12:00:00`) : null;
  if (disb && Number.isFinite(disb.getTime())) {
    const maturity = new Date(disb);
    maturity.setMonth(maturity.getMonth() + Math.max(1, l.term));
    if (Date.now() > maturity.getTime()) return true;
  }
  const lastPayment = l.lastPaymentDate ? new Date(`${l.lastPaymentDate}T12:00:00`) : null;
  if (lastPayment && Number.isFinite(lastPayment.getTime())) {
    const daysSincePay = (Date.now() - lastPayment.getTime()) / 864e5;
    if (daysSincePay > 45 && l.balance > (l.monthlyPayment || 0)) return true;
  }
  if (l.balance > Math.max(l.monthlyPayment * 2, l.amount * 0.08)) return true;
  return false;
}

export type LoanRecoveryDeskView = 'overdue' | 'tracking';

/** Outstanding loans for field follow-up: guarantor contacts, LC1 phone, balances. */
const SaccoLoanRecovery: React.FC<{
  navigate?: (page: string, state?: Record<string, unknown>) => void;
  recoveryView?: LoanRecoveryDeskView;
}> = ({ navigate, recoveryView = 'tracking' }) => {
  const { loans, members, formatCurrency } = useAppContext();

  const rows = useMemo(() => {
    let list = loans.filter((l) => l.status === 'disbursed' && l.balance > 0);
    if (recoveryView === 'overdue') list = list.filter(isLikelyOverdueLoan);
    return list;
  }, [loans, recoveryView]);

  const guarantorLines = (guarantorNames: string[]) => {
    return guarantorNames
      .filter(Boolean)
      .map((name) => {
        const m = members.find((x) => x.name === name);
        const phone = m?.phone?.trim();
        return phone ? `${name} (${phone})` : name;
      })
      .join('; ');
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-2 text-emerald-950">
          <Landmark className="shrink-0 mt-0.5 text-emerald-700" size={20} />
          <div className="text-sm">
            <p className="font-semibold">Loan repayments are posted only in Teller</p>
            <p className="text-emerald-900/90 text-xs mt-0.5">
              Use Receive money → Loan payment after a member brings cash or transfer details. This page is for follow-up contacts
              only — balances update when treasury posts repayment.
            </p>
          </div>
        </div>
        {navigate && (
          <button
            type="button"
            onClick={() => navigate(SACCOPRO_PAGE.teller, { tellerDesk: 'receive', tellerTask: 'loan_payment' })}
            className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            Open Teller — loan payment
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">
            {recoveryView === 'overdue' ? 'Overdue loans' : 'Recovery tracking'}
          </h1>
          <PageNotes ariaLabel="Loan recovery help">
            <p>
              {recoveryView === 'overdue'
                ? 'Loans flagged as overdue or stretched — prioritize contact and restructuring where needed.'
                : 'Guarantor contacts, LC1 telephone, and balances for active loans with money still owed.'}
            </p>
          </PageNotes>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50"
        >
          <Printer size={16} /> Print
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Borrower</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Guarantor(s)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Loan amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">LC1 telephone</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Amount paid</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                    No outstanding disbursed loans.
                  </td>
                </tr>
              ) : (
                rows.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/50 align-top">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{l.memberName}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      <div className="flex items-start gap-2">
                        <UserRound size={14} className="text-slate-400 shrink-0 mt-0.5" />
                        <span>{guarantorLines(l.guarantors) || '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium">{formatCurrency(l.amount)}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      <div className="flex items-center gap-2">
                        <Phone size={14} className="text-emerald-600 shrink-0" />
                        <span>{l.lc1ChairmanPhone?.trim() || '—'}</span>
                      </div>
                      {l.lc1ChairmanName?.trim() && (
                        <p className="text-[11px] text-slate-500 mt-1 pl-6">LC1: {l.lc1ChairmanName}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-emerald-600 font-medium">
                      {formatCurrency(l.paidAmount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-red-600 font-medium">
                      {formatCurrency(l.balance)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SaccoLoanRecovery;
