import React, { useState } from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { CreditCard, PiggyBank, FileText, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { PageNotes } from '@/components/common/PageNotes';

const ClientDashboard: React.FC = () => {
  const { members, loans, fixedDeposits, cashbook, formatCurrency } = useAppContext();
  const [selectedMember, setSelectedMember] = useState(members.find(m => m.status === 'active')?.id || '');

  const member = members.find(m => m.id === selectedMember);
  const memberLoans = loans.filter(l => l.memberId === selectedMember);
  const memberFDs = fixedDeposits.filter(f => f.memberId === selectedMember);
  const memberTransactions = cashbook.filter(c => c.memberId === selectedMember);

  const savingsHistory = [
    { month: 'Oct', balance: (member?.savingsBalance || 0) * 0.7 },
    { month: 'Nov', balance: (member?.savingsBalance || 0) * 0.78 },
    { month: 'Dec', balance: (member?.savingsBalance || 0) * 0.82 },
    { month: 'Jan', balance: (member?.savingsBalance || 0) * 0.88 },
    { month: 'Feb', balance: (member?.savingsBalance || 0) * 0.94 },
    { month: 'Mar', balance: member?.savingsBalance || 0 },
  ];

  if (!member) return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Client Dashboard</h1>
        <PageNotes ariaLabel="Client dashboard help">
          <p>Personal account overview.</p>
        </PageNotes>
      </div>
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <label className="block text-sm font-medium text-slate-700 mb-2">Select Member</label>
        <select value={selectedMember} onChange={e => setSelectedMember(e.target.value)}
          className="w-full max-w-md px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500">
          <option value="">Choose a member...</option>
          {members.filter(m => m.status === 'active').map(m => <option key={m.id} value={m.id}>{m.name} ({m.accountNumber})</option>)}
        </select>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Client Dashboard</h1>
          <PageNotes ariaLabel="Client dashboard help">
            <p>Personal account overview.</p>
          </PageNotes>
        </div>
        <select value={selectedMember} onChange={e => setSelectedMember(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 max-w-xs">
          {members.filter(m => m.status === 'active').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

      {/* Member Card */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl p-6 text-white">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center text-xl font-bold">
            {member.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div>
            <h2 className="text-xl font-bold">{member.name}</h2>
            <p className="text-slate-300 text-sm">{member.accountNumber} | Member since {member.joinDate}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Savings Balance', value: formatCurrency(member.savingsBalance), icon: <PiggyBank size={16} /> },
            { label: 'Shares Balance', value: formatCurrency(member.sharesBalance), icon: <FileText size={16} /> },
            { label: 'Active Loans', value: memberLoans.filter(l => l.status === 'disbursed').length.toString(), icon: <CreditCard size={16} /> },
            { label: 'Fixed Deposits', value: memberFDs.filter(f => f.status === 'active').length.toString(), icon: <PiggyBank size={16} /> },
          ].map((s, i) => (
            <div key={i} className="bg-white/10 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-slate-300 mb-1">{s.icon}<span className="text-xs">{s.label}</span></div>
              <p className="text-lg font-bold">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Savings Trend */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Savings Growth</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={savingsHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={v => `${(v / 1000)}K`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Area type="monotone" dataKey="balance" stroke="#10b981" fill="#10b98120" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Active Loans */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">My Loans</h3>
          {memberLoans.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No loans found</p>
          ) : (
            <div className="space-y-3">
              {memberLoans.map(l => {
                const pct = l.amount > 0 ? Math.round((l.paidAmount / l.amount) * 100) : 0;
                return (
                  <div key={l.id} className="p-3 border border-slate-100 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{l.loanType}</p>
                        <p className="text-xs text-slate-400">{l.id} | {l.interestRate}% p.a.</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                        ${l.status === 'disbursed' ? 'bg-emerald-100 text-emerald-700' : l.status === 'pending' ? 'bg-amber-100 text-amber-700' : l.status === 'closed' ? 'bg-slate-100 text-slate-600' : 'bg-blue-100 text-blue-700'}`}>
                        {l.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                      <span>Paid: {formatCurrency(l.paidAmount)}</span>
                      <span>Balance: {formatCurrency(l.balance)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-medium text-slate-600">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Fixed Deposits */}
      {memberFDs.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">My Fixed Deposits</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {memberFDs.map(fd => (
              <div key={fd.id} className="p-4 bg-gradient-to-br from-cyan-50 to-emerald-50 rounded-lg border border-emerald-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-slate-500">{fd.id}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${fd.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{fd.status}</span>
                </div>
                <p className="text-xl font-bold text-slate-900">{formatCurrency(fd.amount)}</p>
                <div className="mt-2 space-y-1 text-xs text-slate-500">
                  <p>Rate: {fd.interestRate}% p.a. | Term: {fd.term} months</p>
                  <p>Maturity: {fd.maturityDate}</p>
                  <p className="text-emerald-600 font-medium">Interest Earned: {formatCurrency(fd.interestEarned)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Transactions */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Recent Transactions</h3>
        {memberTransactions.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">No transactions found</p>
        ) : (
          <div className="space-y-2">
            {memberTransactions.slice(-10).reverse().map(t => (
              <div key={t.id} className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${t.debit > 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                    {t.debit > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{t.description}</p>
                    <p className="text-xs text-slate-400">{t.date} | {t.reference}</p>
                  </div>
                </div>
                <span className={`text-sm font-semibold ${t.debit > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {t.debit > 0 ? '+' : '-'}{formatCurrency(t.debit || t.credit)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ClientDashboard;
