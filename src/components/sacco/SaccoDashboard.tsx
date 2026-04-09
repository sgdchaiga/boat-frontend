import React from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { SACCOPRO_PAGE } from '@/lib/saccoproPages';
import {
  Users, CreditCard, PiggyBank, TrendingUp,
  ArrowUpRight, ArrowDownRight, DollarSign, Building2, AlertTriangle, CheckCircle
} from 'lucide-react';
import { PageNotes } from '@/components/common/PageNotes';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, AreaChart, Area } from 'recharts';

const Dashboard: React.FC = () => {
  const {
    members,
    loans,
    fixedDeposits,
    cashbook,
    fixedAssets,
    formatCurrency,
    setCurrentPage,
    saccoLoading,
    saccoError,
    refreshSaccoWorkspace,
  } = useAppContext();

  const activeMembers = members.filter(m => m.status === 'active').length;
  const totalSavings = members.reduce((s, m) => s + m.savingsBalance, 0);
  const activeLoans = loans.filter(l => l.status === 'disbursed');
  const totalLoanPortfolio = activeLoans.reduce((s, l) => s + l.balance, 0);
  const pendingLoans = loans.filter(l => l.status === 'pending').length;
  const totalFD = fixedDeposits.filter(f => f.status === 'active').reduce((s, f) => s + f.amount, 0);
  const totalAssets = fixedAssets.filter(a => a.status === 'In Use').reduce((s, a) => s + a.currentValue, 0);
  const cashBalance = cashbook.length > 0 ? cashbook[cashbook.length - 1].balance : 0;

  const loanTypeData = [
    { name: 'Normal', value: loans.filter(l => l.loanType === 'Normal Loan').length, color: '#10b981' },
    { name: 'Emergency', value: loans.filter(l => l.loanType === 'Emergency Loan').length, color: '#f59e0b' },
    { name: 'Development', value: loans.filter(l => l.loanType === 'Development Loan').length, color: '#3b82f6' },
    { name: 'Education', value: loans.filter(l => l.loanType === 'Education Loan').length, color: '#8b5cf6' },
  ];

  const monthlyData = [
    { month: 'Sep', deposits: 1200000, withdrawals: 800000, loans: 500000 },
    { month: 'Oct', deposits: 1450000, withdrawals: 920000, loans: 650000 },
    { month: 'Nov', deposits: 1380000, withdrawals: 750000, loans: 800000 },
    { month: 'Dec', deposits: 1680000, withdrawals: 1100000, loans: 450000 },
    { month: 'Jan', deposits: 1520000, withdrawals: 880000, loans: 700000 },
    { month: 'Feb', deposits: 1750000, withdrawals: 950000, loans: 900000 },
    { month: 'Mar', deposits: 1900000, withdrawals: 1050000, loans: 1100000 },
  ];

  const savingsGrowth = [
    { month: 'Sep', amount: 12500000 },
    { month: 'Oct', amount: 13200000 },
    { month: 'Nov', amount: 13800000 },
    { month: 'Dec', amount: 14500000 },
    { month: 'Jan', amount: 15100000 },
    { month: 'Feb', amount: 15900000 },
    { month: 'Mar', amount: 16800000 },
  ];

  const recentTransactions = cashbook.slice(-5).reverse();

  const stats = [
    { label: 'Total Members', value: activeMembers.toString(), change: '+3 this month', up: true, icon: <Users size={22} />, color: 'bg-blue-500', page: SACCOPRO_PAGE.members },
    { label: 'Total Savings', value: formatCurrency(totalSavings), change: '+8.2%', up: true, icon: <PiggyBank size={22} />, color: 'bg-emerald-500', page: SACCOPRO_PAGE.savingsInterest },
    { label: 'Loan Portfolio', value: formatCurrency(totalLoanPortfolio), change: '+12.5%', up: true, icon: <CreditCard size={22} />, color: 'bg-violet-500', page: SACCOPRO_PAGE.loanList },
    { label: 'Cash Balance', value: formatCurrency(cashBalance), change: '-2.1%', up: false, icon: <DollarSign size={22} />, color: 'bg-amber-500', page: SACCOPRO_PAGE.cashbook },
    { label: 'Fixed Deposits', value: formatCurrency(totalFD), change: '+5.3%', up: true, icon: <TrendingUp size={22} />, color: 'bg-cyan-500', page: SACCOPRO_PAGE.fixedDeposit },
    { label: 'Fixed Assets', value: formatCurrency(totalAssets), change: '-1.8%', up: false, icon: <Building2 size={22} />, color: 'bg-rose-500', page: 'fixed_assets' },
  ];

  return (
    <div className="space-y-6">
      {saccoLoading && (
        <p className="text-sm text-slate-500">Loading workspace data from the server…</p>
      )}
      {saccoError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center justify-between gap-2">
          <span>SACCO data could not be loaded: {saccoError}</span>
          <button
            type="button"
            onClick={() => void refreshSaccoWorkspace()}
            className="text-amber-800 font-medium underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
            <PageNotes ariaLabel="Dashboard notes">
              <p className="text-slate-600">Welcome back! Here&apos;s your SACCO overview for March 2026</p>
            </PageNotes>
          </div>
        </div>
        <div className="flex gap-2">
          <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-full border border-emerald-200">
            System Online
          </span>
          <span className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-medium rounded-full">
            Last sync: 2 min ago
          </span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {stats.map((s, i) => (
          <button key={i} onClick={() => setCurrentPage(s.page)} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 hover:shadow-md transition-all text-left group">
            <div className="flex items-center justify-between mb-3">
              <div className={`${s.color} p-2 rounded-lg text-white`}>{s.icon}</div>
              <span className={`flex items-center gap-0.5 text-xs font-medium ${s.up ? 'text-emerald-600' : 'text-red-500'}`}>
                {s.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                {s.change}
              </span>
            </div>
            <p className="text-lg font-bold text-slate-900 group-hover:text-emerald-600 transition-colors">{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Alerts */}
      {pendingLoans > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle size={20} className="text-amber-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">{pendingLoans} loan application(s) pending approval</p>
            <p className="text-xs text-amber-600">Review and process pending applications</p>
          </div>
          <button onClick={() => setCurrentPage(SACCOPRO_PAGE.loanApproval)} className="px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700">
            Review Now
          </button>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Trends */}
        <div className="lg:col-span-2 bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Monthly Financial Trends</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} />
              <Tooltip formatter={(v: number) => `UGX ${v.toLocaleString()}`} />

              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="deposits" fill="#10b981" radius={[4, 4, 0, 0]} name="Deposits" />
              <Bar dataKey="withdrawals" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Withdrawals" />
              <Bar dataKey="loans" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Loans" />
            </BarChart>
          </ResponsiveContainer>
        </div>


        {/* Loan Distribution */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Loan Distribution</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={loanTypeData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                {loanTypeData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 mt-2">
            {loanTypeData.map((d, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="text-slate-600">{d.name}</span>
                </div>
                <span className="font-medium text-slate-900">{d.value} loans</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Second Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Savings Growth */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Savings Growth Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={savingsGrowth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`} />
              <Tooltip formatter={(v: number) => `UGX ${v.toLocaleString()}`} />

              <Area type="monotone" dataKey="amount" stroke="#10b981" fill="#10b98120" strokeWidth={2} name="Total Savings" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Recent Transactions */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-900">Recent Transactions</h3>
            <button onClick={() => setCurrentPage(SACCOPRO_PAGE.cashbook)} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">View All</button>
          </div>
          <div className="space-y-3">
            {recentTransactions.map(t => (
              <div key={t.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${t.debit > 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                    {t.debit > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900 truncate max-w-[200px]">{t.description}</p>
                    <p className="text-xs text-slate-400">{t.date}</p>
                  </div>
                </div>
                <span className={`text-sm font-semibold ${t.debit > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {t.debit > 0 ? '+' : '-'}{formatCurrency(t.debit || t.credit)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {[
            { label: 'New Member', icon: <Users size={20} />, page: SACCOPRO_PAGE.members, color: 'bg-blue-50 text-blue-600 hover:bg-blue-100' },
            { label: 'New Loan', icon: <CreditCard size={20} />, page: SACCOPRO_PAGE.loanInput, color: 'bg-violet-50 text-violet-600 hover:bg-violet-100' },
            { label: 'Cash Entry', icon: <DollarSign size={20} />, page: SACCOPRO_PAGE.cashbook, color: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' },
            { label: 'Fixed Deposit', icon: <PiggyBank size={20} />, page: SACCOPRO_PAGE.fixedDeposit, color: 'bg-cyan-50 text-cyan-600 hover:bg-cyan-100' },
            { label: 'Approve Loans', icon: <CheckCircle size={20} />, page: SACCOPRO_PAGE.loanApproval, color: 'bg-amber-50 text-amber-600 hover:bg-amber-100' },
            { label: 'View Ledger', icon: <Building2 size={20} />, page: 'accounting_gl', color: 'bg-rose-50 text-rose-600 hover:bg-rose-100' },
          ].map((a, i) => (
            <button key={i} onClick={() => setCurrentPage(a.page)} className={`${a.color} rounded-xl p-4 flex flex-col items-center gap-2 transition-colors`}>
              {a.icon}
              <span className="text-xs font-medium">{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
