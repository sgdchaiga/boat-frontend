import React, { useState, useMemo } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { Calculator, AlertTriangle, TrendingUp } from 'lucide-react';
import { PageNotes } from '@/components/common/PageNotes';

const LoanInterestCalc: React.FC = () => {
  const { loans, formatCurrency } = useAppContext();
  const activeLoans = loans.filter(l => l.status === 'disbursed');

  const [calcDate, setCalcDate] = useState('2026-03-03');
  const [penaltyRate, setPenaltyRate] = useState('2');

  const calculations = useMemo(() => {
    return activeLoans.map(loan => {
      const dailyRate = loan.interestRate / 100 / 365;
      const dailyInterest = Math.round(loan.balance * dailyRate);
      const monthlyAccrual = Math.round(loan.balance * loan.interestRate / 100 / 12);

      // Simulate days since last payment
      const daysSincePayment = Math.floor(Math.random() * 45) + 1;
      const isOverdue = daysSincePayment > 30;
      const overdueDays = isOverdue ? daysSincePayment - 30 : 0;
      const penalty = isOverdue ? Math.round(loan.balance * parseFloat(penaltyRate) / 100 / 12) : 0;
      const accruedInterest = dailyInterest * daysSincePayment;

      return {
        ...loan, dailyInterest, monthlyAccrual, daysSincePayment,
        isOverdue, overdueDays, penalty, accruedInterest,
      };
    });
  }, [activeLoans, calcDate, penaltyRate]);

  const totalDailyInterest = calculations.reduce((s, c) => s + c.dailyInterest, 0);
  const totalAccrued = calculations.reduce((s, c) => s + c.accruedInterest, 0);
  const totalPenalties = calculations.reduce((s, c) => s + c.penalty, 0);
  const overdueCount = calculations.filter(c => c.isOverdue).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Loan Interest Calculation</h1>
        <PageNotes ariaLabel="Loan interest calculation help">
          <p>Daily interest accrual and penalty computation.</p>
        </PageNotes>
      </div>

      {/* Config */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Calculation Parameters</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Calculation Date</label>
            <input type="date" value={calcDate} onChange={e => setCalcDate(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Penalty Rate (% p.a.)</label>
            <input type="number" step="0.5" value={penaltyRate} onChange={e => setPenaltyRate(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Active Loans</label>
            <div className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium">{activeLoans.length} loans</div>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Daily Interest', value: formatCurrency(totalDailyInterest), color: 'text-blue-600', icon: <TrendingUp size={18} /> },
          { label: 'Accrued Interest', value: formatCurrency(totalAccrued), color: 'text-emerald-600', icon: <Calculator size={18} /> },
          { label: 'Total Penalties', value: formatCurrency(totalPenalties), color: 'text-red-600', icon: <AlertTriangle size={18} /> },
          { label: 'Overdue Loans', value: overdueCount.toString(), color: 'text-amber-600', icon: <AlertTriangle size={18} /> },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <div className="flex items-center gap-2 mb-1">
              <span className={s.color}>{s.icon}</span>
              <p className="text-xs text-slate-500">{s.label}</p>
            </div>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Calculation Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                {['Loan ID', 'Member', 'Balance', 'Rate', 'Daily Interest', 'Days', 'Accrued', 'Penalty', 'Status'].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {calculations.map(c => (
                <tr key={c.id} className={`hover:bg-slate-50/50 ${c.isOverdue ? 'bg-red-50/30' : ''}`}>
                  <td className="px-3 py-2.5 text-sm font-mono">{c.id}</td>
                  <td className="px-3 py-2.5 text-sm font-medium">{c.memberName}</td>
                  <td className="px-3 py-2.5 text-sm">{formatCurrency(c.balance)}</td>
                  <td className="px-3 py-2.5 text-sm">{c.interestRate}%</td>
                  <td className="px-3 py-2.5 text-sm font-medium text-blue-600">{formatCurrency(c.dailyInterest)}</td>
                  <td className="px-3 py-2.5 text-sm">{c.daysSincePayment}d</td>
                  <td className="px-3 py-2.5 text-sm font-medium text-emerald-600">{formatCurrency(c.accruedInterest)}</td>
                  <td className="px-3 py-2.5 text-sm font-medium text-red-600">{c.penalty > 0 ? formatCurrency(c.penalty) : '-'}</td>
                  <td className="px-3 py-2.5">
                    {c.isOverdue ? (
                      <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full font-medium">Overdue ({c.overdueDays}d)</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full font-medium">Current</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-slate-200">
                <td colSpan={2} className="px-3 py-3 text-sm font-bold">Totals</td>
                <td className="px-3 py-3 text-sm font-bold">{formatCurrency(calculations.reduce((s, c) => s + c.balance, 0))}</td>
                <td></td>
                <td className="px-3 py-3 text-sm font-bold text-blue-600">{formatCurrency(totalDailyInterest)}</td>
                <td></td>
                <td className="px-3 py-3 text-sm font-bold text-emerald-600">{formatCurrency(totalAccrued)}</td>
                <td className="px-3 py-3 text-sm font-bold text-red-600">{formatCurrency(totalPenalties)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LoanInterestCalc;
