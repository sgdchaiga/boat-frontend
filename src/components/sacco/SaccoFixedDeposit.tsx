import React, { useState } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { PiggyBank, Plus, X, Eye, RefreshCw } from 'lucide-react';

const FixedDeposit: React.FC = () => {
  const { fixedDeposits, addFixedDeposit, members, formatCurrency, setFixedDeposits } = useAppContext();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const interestTiers = [
    { term: 3, rate: 7.5, label: '3 Months' },
    { term: 6, rate: 8.5, label: '6 Months' },
    { term: 12, rate: 9.5, label: '12 Months' },
    { term: 24, rate: 10.5, label: '24 Months' },
  ];

  const [form, setForm] = useState({
    memberId: '', memberName: '', amount: '', term: '12', interestRate: '9.5',
    startDate: new Date().toISOString().split('T')[0], autoRenew: false,
  });

  const getMaturityDate = (start: string, months: number) => {
    const d = new Date(start);
    d.setMonth(d.getMonth() + months);
    return d.toISOString().split('T')[0];
  };

  const filtered = fixedDeposits.filter(fd => statusFilter === 'all' || fd.status === statusFilter);
  const totalActive = fixedDeposits.filter(f => f.status === 'active').reduce((s, f) => s + f.amount, 0);
  const totalInterest = fixedDeposits.reduce((s, f) => s + f.interestEarned, 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    const term = parseInt(form.term);
    if (isNaN(amount) || amount < 10000) return;
    addFixedDeposit({
      memberId: form.memberId, memberName: form.memberName, amount,
      interestRate: parseFloat(form.interestRate), term,
      startDate: form.startDate,
      maturityDate: getMaturityDate(form.startDate, term),
      autoRenew: form.autoRenew,
    });
    setShowForm(false);
    setForm({ memberId: '', memberName: '', amount: '', term: '12', interestRate: '9.5', startDate: new Date().toISOString().split('T')[0], autoRenew: false });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Fixed Deposits</h1>
          <p className="text-slate-500 text-sm">{fixedDeposits.length} deposits | {formatCurrency(totalActive)} active</p>
        </div>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium">
          <Plus size={16} /> New Fixed Deposit
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Deposits', value: formatCurrency(totalActive), color: 'text-emerald-600' },
          { label: 'Interest Earned', value: formatCurrency(totalInterest), color: 'text-amber-600' },
          { label: 'Active Deposits', value: fixedDeposits.filter(f => f.status === 'active').length.toString(), color: 'text-blue-600' },
          { label: 'Maturing Soon', value: fixedDeposits.filter(f => f.status === 'active' && new Date(f.maturityDate) <= new Date('2026-06-01')).length.toString(), color: 'text-violet-600' },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Interest Rate Tiers */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Interest Rate Tiers</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {interestTiers.map(t => (
            <div key={t.term} className="p-4 bg-gradient-to-br from-emerald-50 to-cyan-50 rounded-lg border border-emerald-100 text-center">
              <p className="text-2xl font-bold text-emerald-700">{t.rate}%</p>
              <p className="text-xs text-slate-600 mt-1">{t.label}</p>
              <p className="text-[10px] text-slate-400">Per annum</p>
            </div>
          ))}
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {['all', 'active', 'matured', 'withdrawn'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${statusFilter === s ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                {['ID', 'Member', 'Amount', 'Rate', 'Term', 'Start', 'Maturity', 'Interest', 'Status', 'Auto-Renew'].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(fd => (
                <tr key={fd.id} className="hover:bg-slate-50/50">
                  <td className="px-3 py-2.5 text-sm font-mono">{fd.id}</td>
                  <td className="px-3 py-2.5 text-sm font-medium">{fd.memberName}</td>
                  <td className="px-3 py-2.5 text-sm font-medium">{formatCurrency(fd.amount)}</td>
                  <td className="px-3 py-2.5 text-sm">{fd.interestRate}%</td>
                  <td className="px-3 py-2.5 text-sm">{fd.term}m</td>
                  <td className="px-3 py-2.5 text-sm text-slate-500">{fd.startDate}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-500">{fd.maturityDate}</td>
                  <td className="px-3 py-2.5 text-sm font-medium text-amber-600">{formatCurrency(fd.interestEarned)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${fd.status === 'active' ? 'bg-emerald-100 text-emerald-700' : fd.status === 'matured' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                      {fd.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {fd.autoRenew && <RefreshCw size={14} className="text-emerald-500" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New FD Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold">New Fixed Deposit</h2>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Member</label>
                <select required value={form.memberId} onChange={e => {
                  const m = members.find(m => m.id === e.target.value);
                  setForm(p => ({ ...p, memberId: e.target.value, memberName: m?.name || '' }));
                }} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                  <option value="">Select Member</option>
                  {members.filter(m => m.status === 'active').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Amount (KES)</label>
                  <input type="number" required min="10000" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Term</label>
                  <select value={form.term} onChange={e => {
                    const tier = interestTiers.find(t => t.term === parseInt(e.target.value));
                    setForm(p => ({ ...p, term: e.target.value, interestRate: String(tier?.rate || 9.5) }));
                  }} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                    {interestTiers.map(t => <option key={t.term} value={t.term}>{t.label} ({t.rate}%)</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Start Date</label>
                <input type="date" required value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              {form.amount && (
                <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                  <p className="text-xs text-emerald-600">Estimated Interest at Maturity</p>
                  <p className="text-lg font-bold text-emerald-700">
                    {formatCurrency(Math.round(parseFloat(form.amount) * parseFloat(form.interestRate) / 100 * parseInt(form.term) / 12))}
                  </p>
                  <p className="text-xs text-slate-500">Maturity: {getMaturityDate(form.startDate, parseInt(form.term))}</p>
                </div>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.autoRenew} onChange={e => setForm(p => ({ ...p, autoRenew: e.target.checked }))}
                  className="w-4 h-4 text-emerald-600 rounded border-slate-300" />
                <span className="text-sm text-slate-700">Auto-renew on maturity</span>
              </label>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                <button type="submit" className="px-6 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700">Create Deposit</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FixedDeposit;
