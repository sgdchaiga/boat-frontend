import React from 'react';
import { useAppContext } from '@/contexts/AppContext';
import { SACCOPRO_PAGE } from '@/lib/saccoproPages';
import { TrendingUp, CreditCard, CheckCircle, Clock } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line } from 'recharts';
import { PageNotes } from '@/components/common/PageNotes';

const LoanDashboard: React.FC = () => {
  const { loans, formatCurrency, setCurrentPage } = useAppContext();

  const active = loans.filter(l => l.status === 'disbursed');
  const pending = loans.filter(l => l.status === 'pending');
  const approved = loans.filter(l => l.status === 'approved');
  const closed = loans.filter(l => l.status === 'closed');

  const totalPortfolio = active.reduce((s, l) => s + l.balance, 0);
  const totalCollected = active.reduce((s, l) => s + l.paidAmount, 0);
  const avgRate = active.length > 0 ? (active.reduce((s, l) => s + l.interestRate, 0) / active.length).toFixed(1) : '0';

  const statusData = [
    { name: 'Disbursed', value: active.length, color: '#10b981' },
    { name: 'Pending', value: pending.length, color: '#f59e0b' },
    { name: 'Approved', value: approved.length, color: '#3b82f6' },
    { name: 'Closed', value: closed.length, color: '#6b7280' },
  ].filter(d => d.value > 0);

  const typeBreakdown = ['Normal Loan', 'Emergency Loan', 'Development Loan', 'Education Loan'].map(type => {
    const typeLoans = active.filter(l => l.loanType === type);
    return { name: type.replace(' Loan', ''), amount: typeLoans.reduce((s, l) => s + l.balance, 0), count: typeLoans.length };
  });

  const repaymentTrend = [
    { month: 'Oct', collected: 320000, expected: 350000 },
    { month: 'Nov', collected: 380000, expected: 370000 },
    { month: 'Dec', collected: 290000, expected: 390000 },
    { month: 'Jan', collected: 410000, expected: 400000 },
    { month: 'Feb', collected: 450000, expected: 420000 },
    { month: 'Mar', collected: 380000, expected: 440000 },
  ];

  const stats = [
    { label: 'Active Loans', value: active.length.toString(), icon: <CreditCard size={20} />, color: 'bg-emerald-500' },
    { label: 'Outstanding Balance', value: formatCurrency(totalPortfolio), icon: <TrendingUp size={20} />, color: 'bg-violet-500' },
    { label: 'Total Collected', value: formatCurrency(totalCollected), icon: <CheckCircle size={20} />, color: 'bg-blue-500' },
    { label: 'Pending Approval', value: pending.length.toString(), icon: <Clock size={20} />, color: 'bg-amber-500' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Loan Dashboard</h1>
          <PageNotes ariaLabel="Loan dashboard help">
            <p>Portfolio analytics and performance overview.</p>
          </PageNotes>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCurrentPage(SACCOPRO_PAGE.loanInput)} className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 font-medium">New Loan</button>
          <button onClick={() => setCurrentPage(SACCOPRO_PAGE.loanReports)} className="px-4 py-2 border border-slate-200 text-sm rounded-lg hover:bg-slate-50 font-medium">Reports</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <div className="flex items-center gap-3">
              <div className={`${s.color} p-2 rounded-lg text-white`}>{s.icon}</div>
              <div>
                <p className="text-xs text-slate-500">{s.label}</p>
                <p className="text-lg font-bold text-slate-900">{s.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Repayment Trend */}
        <div className="lg:col-span-2 bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Repayment Performance</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={repaymentTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={v => `${(v / 1000)}K`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Line type="monotone" dataKey="collected" stroke="#10b981" strokeWidth={2} name="Collected" dot={{ r: 4 }} />
              <Line type="monotone" dataKey="expected" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" name="Expected" dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Status Distribution */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Loan Status</h3>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={statusData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={4} dataKey="value">
                {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 mt-2">
            {statusData.map((d, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="text-slate-600">{d.name}</span>
                </div>
                <span className="font-medium">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Type Breakdown */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Portfolio by Loan Type</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={typeBreakdown} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={v => `${(v / 1000)}K`} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} stroke="#94a3b8" width={90} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Bar dataKey="amount" fill="#8b5cf6" radius={[0, 4, 4, 0]} name="Outstanding" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Avg Interest Rate', value: `${avgRate}%`, sub: 'Per annum' },
          { label: 'Collection Rate', value: '91.2%', sub: 'Last 6 months' },
          { label: 'Default Rate', value: '0.0%', sub: 'Current period' },
          { label: 'Total Interest Earned', value: formatCurrency(890000), sub: 'Year to date' },
        ].map((m, i) => (
          <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 text-center">
            <p className="text-2xl font-bold text-slate-900">{m.value}</p>
            <p className="text-xs text-slate-500 mt-1">{m.label}</p>
            <p className="text-[10px] text-slate-400">{m.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LoanDashboard;
