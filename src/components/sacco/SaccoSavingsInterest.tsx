import React, { useState, useMemo } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { Calculator, Play } from 'lucide-react';
import { PageNotes } from '@/components/common/PageNotes';

const SavingsInterest: React.FC = () => {
  const { members, formatCurrency } = useAppContext();
  const activeMembers = members.filter(m => m.status === 'active' && m.savingsBalance > 0);

  const [interestRate, setInterestRate] = useState('5');
  const [period, setPeriod] = useState<'monthly' | 'quarterly'>('monthly');
  const [calculated, setCalculated] = useState(false);

  const calculations = useMemo(() => {
    const rate = parseFloat(interestRate) / 100;
    const periodDivisor = period === 'monthly' ? 12 : 4;
    return activeMembers.map(m => {
      const interest = Math.round(m.savingsBalance * rate / periodDivisor);
      return { ...m, interest, newBalance: m.savingsBalance + interest };
    });
  }, [activeMembers, interestRate, period]);

  const totalInterest = calculations.reduce((s, c) => s + c.interest, 0);
  const totalSavings = calculations.reduce((s, c) => s + c.savingsBalance, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Savings Interest Calculation</h1>
        <PageNotes ariaLabel="Savings interest help">
          <p>Calculate and post interest on member savings.</p>
        </PageNotes>
      </div>

      {/* Configuration */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Interest Configuration</h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Annual Interest Rate (%)</label>
            <input type="number" step="0.5" min="0" max="20" value={interestRate}
              onChange={e => { setInterestRate(e.target.value); setCalculated(false); }}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Posting Period</label>
            <select value={period} onChange={e => { setPeriod(e.target.value as any); setCalculated(false); }}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Effective Rate ({period})</label>
            <div className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium">
              {(parseFloat(interestRate) / (period === 'monthly' ? 12 : 4)).toFixed(4)}%
            </div>
          </div>
          <div className="flex items-end">
            <button onClick={() => setCalculated(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium">
              <Calculator size={16} /> Calculate
            </button>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Eligible Members', value: activeMembers.length.toString(), color: 'text-blue-600' },
          { label: 'Total Savings', value: formatCurrency(totalSavings), color: 'text-slate-900' },
          { label: 'Total Interest', value: formatCurrency(totalInterest), color: 'text-emerald-600' },
          { label: 'New Total', value: formatCurrency(totalSavings + totalInterest), color: 'text-violet-600' },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Calculation Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Interest Calculation Details</h3>
          {calculated && (
            <button onClick={() => setCalculated(false)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 font-medium">
              <Play size={14} /> Post Interest
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                {['Account #', 'Member Name', 'Savings Balance', 'Rate', 'Interest Amount', 'New Balance'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {calculations.map(c => (
                <tr key={c.id} className={`hover:bg-slate-50/50 ${calculated ? '' : 'opacity-60'}`}>
                  <td className="px-4 py-2.5 text-sm font-mono">{c.accountNumber}</td>
                  <td className="px-4 py-2.5 text-sm font-medium text-slate-900">{c.name}</td>
                  <td className="px-4 py-2.5 text-sm">{formatCurrency(c.savingsBalance)}</td>
                  <td className="px-4 py-2.5 text-sm">{interestRate}% p.a.</td>
                  <td className="px-4 py-2.5 text-sm font-medium text-emerald-600">{formatCurrency(c.interest)}</td>
                  <td className="px-4 py-2.5 text-sm font-bold text-slate-900">{formatCurrency(c.newBalance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-slate-200">
                <td colSpan={2} className="px-4 py-3 text-sm font-bold">Totals</td>
                <td className="px-4 py-3 text-sm font-bold">{formatCurrency(totalSavings)}</td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3 text-sm font-bold text-emerald-600">{formatCurrency(totalInterest)}</td>
                <td className="px-4 py-3 text-sm font-bold">{formatCurrency(totalSavings + totalInterest)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SavingsInterest;
