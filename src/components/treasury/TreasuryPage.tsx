import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Building2,
  Check,
  CreditCard,
  Landmark,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";

type TabId = "overview" | "wallets" | "requests" | "petty-cash" | "suppliers" | "float" | "budgets" | "cards";
type Status = "Pending" | "Approved" | "Rejected" | "Paid";

type ExpenseRequest = {
  id: string;
  staff: string;
  purpose: string;
  department: string;
  amount: number;
  status: Status;
  submitted: string;
};

type TreasuryState = {
  wallets: { id: string; staff: string; department: string; balance: number; limit: number }[];
  requests: ExpenseRequest[];
  pettyCash: { id: string; description: string; custodian: string; amount: number; direction: "In" | "Out"; date: string }[];
  suppliers: { id: string; supplier: string; reference: string; amount: number; due: string; status: Status }[];
  floats: { id: string; name: string; channel: string; balance: number; minimum: number }[];
  budgets: { id: string; department: string; allocated: number; spent: number }[];
  cards: { id: string; holder: string; label: string; last4: string; limit: number; spent: number; active: boolean }[];
};

const money = new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 });
const today = () => new Date().toISOString().slice(0, 10);
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const initialState: TreasuryState = {
  wallets: [
    { id: "wal-1", staff: "Sarah Namusoke", department: "Operations", balance: 850000, limit: 1500000 },
    { id: "wal-2", staff: "David Okello", department: "Procurement", balance: 420000, limit: 1000000 },
    { id: "wal-3", staff: "Martha Atim", department: "Sales", balance: 280000, limit: 750000 },
  ],
  requests: [
    { id: "REQ-1048", staff: "David Okello", purpose: "Supplier site visit", department: "Procurement", amount: 320000, status: "Pending", submitted: today() },
    { id: "REQ-1047", staff: "Martha Atim", purpose: "Client activation materials", department: "Sales", amount: 480000, status: "Approved", submitted: today() },
    { id: "REQ-1046", staff: "Sarah Namusoke", purpose: "Office utilities", department: "Operations", amount: 210000, status: "Paid", submitted: today() },
  ],
  pettyCash: [
    { id: "PC-2201", description: "Opening balance", custodian: "Sarah Namusoke", amount: 1500000, direction: "In", date: today() },
    { id: "PC-2202", description: "Courier and delivery", custodian: "Sarah Namusoke", amount: 85000, direction: "Out", date: today() },
    { id: "PC-2203", description: "Office refreshments", custodian: "Sarah Namusoke", amount: 120000, direction: "Out", date: today() },
  ],
  suppliers: [
    { id: "PAY-801", supplier: "Prime Office Supplies", reference: "INV-4482", amount: 2850000, due: today(), status: "Pending" },
    { id: "PAY-800", supplier: "City Fuel Services", reference: "INV-1908", amount: 1600000, due: today(), status: "Approved" },
    { id: "PAY-799", supplier: "Kampala Internet Ltd", reference: "INV-7721", amount: 780000, due: today(), status: "Paid" },
  ],
  floats: [
    { id: "flt-1", name: "Main Mobile Money", channel: "MTN MoMo", balance: 6400000, minimum: 3000000 },
    { id: "flt-2", name: "Collections Float", channel: "Airtel Money", balance: 2150000, minimum: 2500000 },
    { id: "flt-3", name: "Branch Cash Float", channel: "Cash", balance: 1850000, minimum: 1000000 },
  ],
  budgets: [
    { id: "bud-1", department: "Operations", allocated: 12000000, spent: 7350000 },
    { id: "bud-2", department: "Procurement", allocated: 18000000, spent: 14800000 },
    { id: "bud-3", department: "Sales & Marketing", allocated: 9000000, spent: 4200000 },
    { id: "bud-4", department: "Administration", allocated: 6500000, spent: 5850000 },
  ],
  cards: [
    { id: "card-1", holder: "Sarah Namusoke", label: "Operations card", last4: "4821", limit: 2000000, spent: 780000, active: true },
    { id: "card-2", holder: "David Okello", label: "Procurement card", last4: "1064", limit: 3500000, spent: 2920000, active: true },
    { id: "card-3", holder: "Martha Atim", label: "Campaign card", last4: "7730", limit: 1200000, spent: 1200000, active: false },
  ],
};

const tabs: { id: TabId; label: string; icon: typeof Wallet }[] = [
  { id: "overview", label: "Overview", icon: Landmark },
  { id: "wallets", label: "Staff wallets", icon: Users },
  { id: "requests", label: "Expense requests", icon: ArrowUpRight },
  { id: "petty-cash", label: "Petty cash", icon: Banknote },
  { id: "suppliers", label: "Supplier payments", icon: Building2 },
  { id: "float", label: "Float", icon: RefreshCw },
  { id: "budgets", label: "Budgets", icon: ShieldCheck },
  { id: "cards", label: "Expense cards", icon: CreditCard },
];

function StatusBadge({ status }: { status: Status }) {
  const tone =
    status === "Paid"
      ? "bg-emerald-100 text-emerald-700"
      : status === "Approved"
        ? "bg-blue-100 text-blue-700"
        : status === "Rejected"
          ? "bg-rose-100 text-rose-700"
          : "bg-amber-100 text-amber-700";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{status}</span>;
}

function MetricCard({ label, value, hint, icon: Icon, tone }: { label: string; value: string; hint: string; icon: typeof Wallet; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{hint}</p>
        </div>
        <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

function Progress({ value, warn = false }: { value: number; warn?: boolean }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${warn ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

export function TreasuryPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const storageKey = `boat.treasury.v1.${user?.organization_id ?? "default"}`;
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [data, setData] = useState<TreasuryState>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? (JSON.parse(saved) as TreasuryState) : initialState;
    } catch {
      return initialState;
    }
  });
  const [requestForm, setRequestForm] = useState({ purpose: "", department: "Operations", amount: "" });
  const [cashForm, setCashForm] = useState({ description: "", amount: "", direction: "Out" as "In" | "Out" });
  const [walletTopup, setWalletTopup] = useState<Record<string, string>>({});

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(data));
  }, [data, storageKey]);

  const totals = useMemo(() => {
    const walletBalance = data.wallets.reduce((sum, row) => sum + row.balance, 0);
    const pendingApprovals = data.requests.filter((row) => row.status === "Pending").reduce((sum, row) => sum + row.amount, 0);
    const supplierDue = data.suppliers.filter((row) => row.status !== "Paid").reduce((sum, row) => sum + row.amount, 0);
    const pettyCash = data.pettyCash.reduce((sum, row) => sum + (row.direction === "In" ? row.amount : -row.amount), 0);
    return { walletBalance, pendingApprovals, supplierDue, pettyCash };
  }, [data]);

  const updateRequest = (requestId: string, status: Status) => {
    if (readOnly) return;
    setData((current) => ({
      ...current,
      requests: current.requests.map((row) => (row.id === requestId ? { ...row, status } : row)),
    }));
  };

  const submitRequest = () => {
    const amount = Number(requestForm.amount);
    if (readOnly || !requestForm.purpose.trim() || amount <= 0) return;
    setData((current) => ({
      ...current,
      requests: [
        {
          id: `REQ-${1048 + current.requests.length}`,
          staff: user?.full_name || user?.email || "Staff member",
          purpose: requestForm.purpose.trim(),
          department: requestForm.department,
          amount,
          status: "Pending",
          submitted: today(),
        },
        ...current.requests,
      ],
    }));
    setRequestForm({ purpose: "", department: "Operations", amount: "" });
  };

  const addCashEntry = () => {
    const amount = Number(cashForm.amount);
    if (readOnly || !cashForm.description.trim() || amount <= 0) return;
    setData((current) => ({
      ...current,
      pettyCash: [
        {
          id: id("PC"),
          description: cashForm.description.trim(),
          custodian: user?.full_name || user?.email || "Treasury user",
          amount,
          direction: cashForm.direction,
          date: today(),
        },
        ...current.pettyCash,
      ],
    }));
    setCashForm({ description: "", amount: "", direction: "Out" });
  };

  const allocateWallet = (walletId: string) => {
    const amount = Number(walletTopup[walletId]);
    if (readOnly || amount <= 0) return;
    setData((current) => ({
      ...current,
      wallets: current.wallets.map((row) =>
        row.id === walletId ? { ...row, balance: Math.min(row.limit, row.balance + amount) } : row
      ),
    }));
    setWalletTopup((current) => ({ ...current, [walletId]: "" }));
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      {readOnly && <ReadOnlyNotice />}
      <div className="overflow-hidden rounded-3xl bg-slate-950 text-white shadow-xl">
        <div className="relative px-6 py-7 sm:px-8">
          <div className="absolute right-0 top-0 h-44 w-44 rounded-full bg-emerald-500/20 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-emerald-300">BOAT Treasury</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">Control every shilling.</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">Allocate, approve, pay, and monitor business funds from one accountable workspace.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 px-5 py-3 backdrop-blur">
              <p className="text-xs text-slate-300">Cash under management</p>
              <p className="mt-1 text-xl font-bold">{money.format(totals.walletBalance + totals.pettyCash + data.floats.reduce((s, r) => s + r.balance, 0))}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${activeTab === tab.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              <Icon className="h-4 w-4" />{tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "overview" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Staff wallet balances" value={money.format(totals.walletBalance)} hint={`${data.wallets.length} funded staff wallets`} icon={Wallet} tone="bg-indigo-100 text-indigo-700" />
            <MetricCard label="Awaiting approval" value={money.format(totals.pendingApprovals)} hint={`${data.requests.filter((r) => r.status === "Pending").length} expense requests`} icon={ShieldCheck} tone="bg-amber-100 text-amber-700" />
            <MetricCard label="Supplier payments due" value={money.format(totals.supplierDue)} hint="Approved and pending payments" icon={Building2} tone="bg-rose-100 text-rose-700" />
            <MetricCard label="Digital petty cash" value={money.format(totals.pettyCash)} hint="Live cash book balance" icon={Banknote} tone="bg-emerald-100 text-emerald-700" />
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
              <div className="flex items-center justify-between"><h2 className="font-bold text-slate-900">Approval queue</h2><button onClick={() => setActiveTab("requests")} className="text-sm font-semibold text-emerald-700">View all</button></div>
              <div className="mt-4 space-y-3">
                {data.requests.filter((row) => row.status === "Pending").slice(0, 4).map((row) => (
                  <div key={row.id} className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div><p className="font-semibold text-slate-900">{row.purpose}</p><p className="text-xs text-slate-500">{row.staff} · {row.department}</p></div>
                    <div className="flex items-center gap-2"><span className="mr-2 font-bold text-slate-900">{money.format(row.amount)}</span><button disabled={readOnly} onClick={() => updateRequest(row.id, "Approved")} className="rounded-lg bg-emerald-600 p-2 text-white disabled:opacity-40"><Check className="h-4 w-4" /></button><button disabled={readOnly} onClick={() => updateRequest(row.id, "Rejected")} className="rounded-lg bg-white p-2 text-rose-600 ring-1 ring-slate-200 disabled:opacity-40"><X className="h-4 w-4" /></button></div>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-bold text-slate-900">Control alerts</h2>
              <div className="mt-4 space-y-3">
                {data.floats.filter((row) => row.balance < row.minimum).map((row) => <div key={row.id} className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800"><AlertTriangle className="mb-2 h-5 w-5" /><strong>{row.name}</strong> is below its minimum float.</div>)}
                {data.budgets.filter((row) => row.spent / row.allocated >= 0.85).map((row) => <div key={row.id} className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800"><AlertTriangle className="mb-2 h-5 w-5" /><strong>{row.department}</strong> has used {Math.round((row.spent / row.allocated) * 100)}% of budget.</div>)}
              </div>
            </section>
          </div>
        </>
      )}

      {activeTab === "wallets" && (
        <section className="grid gap-4 lg:grid-cols-3">
          {data.wallets.map((row) => (
            <div key={row.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between"><div className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-700">{row.staff.split(" ").map((x) => x[0]).join("").slice(0, 2)}</div><Wallet className="h-5 w-5 text-slate-400" /></div>
              <p className="mt-4 font-bold text-slate-900">{row.staff}</p><p className="text-xs text-slate-500">{row.department}</p>
              <p className="mt-4 text-2xl font-bold text-slate-900">{money.format(row.balance)}</p><p className="text-xs text-slate-500">Limit {money.format(row.limit)}</p>
              <div className="mt-3"><Progress value={(row.balance / row.limit) * 100} /></div>
              <div className="mt-4 flex gap-2"><input disabled={readOnly} value={walletTopup[row.id] || ""} onChange={(e) => setWalletTopup((v) => ({ ...v, [row.id]: e.target.value }))} type="number" placeholder="Allocation amount" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" /><button disabled={readOnly} onClick={() => allocateWallet(row.id)} className="rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-40">Allocate</button></div>
            </div>
          ))}
        </section>
      )}

      {activeTab === "requests" && (
        <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
          <section className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">New expense request</h2><p className="mt-1 text-xs text-slate-500">Requests enter the manager approval queue.</p>
            <div className="mt-5 space-y-3"><input disabled={readOnly} value={requestForm.purpose} onChange={(e) => setRequestForm((v) => ({ ...v, purpose: e.target.value }))} placeholder="Purpose" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /><select disabled={readOnly} value={requestForm.department} onChange={(e) => setRequestForm((v) => ({ ...v, department: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"><option>Operations</option><option>Procurement</option><option>Sales</option><option>Administration</option></select><input disabled={readOnly} value={requestForm.amount} onChange={(e) => setRequestForm((v) => ({ ...v, amount: e.target.value }))} type="number" placeholder="Amount (UGX)" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /><button disabled={readOnly} onClick={submitRequest} className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"><Plus className="h-4 w-4" />Submit request</button></div>
          </section>
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5"><h2 className="font-bold text-slate-900">Approval workflow</h2></div>
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">Request</th><th className="px-5 py-3">Requester</th><th className="px-5 py-3">Amount</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{data.requests.map((row) => <tr key={row.id}><td className="px-5 py-4"><p className="font-semibold text-slate-900">{row.purpose}</p><p className="text-xs text-slate-500">{row.id} · {row.submitted}</p></td><td className="px-5 py-4">{row.staff}<p className="text-xs text-slate-500">{row.department}</p></td><td className="px-5 py-4 font-semibold">{money.format(row.amount)}</td><td className="px-5 py-4"><StatusBadge status={row.status} /></td><td className="px-5 py-4">{row.status === "Pending" ? <div className="flex gap-2"><button disabled={readOnly} onClick={() => updateRequest(row.id, "Approved")} className="rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-700 disabled:opacity-40">Approve</button><button disabled={readOnly} onClick={() => updateRequest(row.id, "Rejected")} className="rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-700 disabled:opacity-40">Reject</button></div> : <span className="text-xs text-slate-400">Completed</span>}</td></tr>)}</tbody></table></div>
          </section>
        </div>
      )}

      {activeTab === "petty-cash" && (
        <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
          <section className="h-fit rounded-2xl bg-slate-950 p-5 text-white shadow-lg"><p className="text-sm text-slate-300">Current digital cashbook balance</p><p className="mt-2 text-3xl font-bold">{money.format(totals.pettyCash)}</p><div className="mt-6 space-y-3"><input disabled={readOnly} value={cashForm.description} onChange={(e) => setCashForm((v) => ({ ...v, description: e.target.value }))} placeholder="Description" className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm placeholder:text-slate-400" /><input disabled={readOnly} value={cashForm.amount} onChange={(e) => setCashForm((v) => ({ ...v, amount: e.target.value }))} type="number" placeholder="Amount" className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm placeholder:text-slate-400" /><select disabled={readOnly} value={cashForm.direction} onChange={(e) => setCashForm((v) => ({ ...v, direction: e.target.value as "In" | "Out" }))} className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm"><option value="Out">Cash out</option><option value="In">Cash in</option></select><button disabled={readOnly} onClick={addCashEntry} className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 disabled:opacity-40">Post cashbook entry</button></div></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-900">Petty cash book</h2><div className="mt-4 space-y-2">{data.pettyCash.map((row) => <div key={row.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-4"><div className="flex items-center gap-3"><span className={`rounded-lg p-2 ${row.direction === "In" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{row.direction === "In" ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</span><div><p className="font-semibold text-slate-900">{row.description}</p><p className="text-xs text-slate-500">{row.custodian} · {row.date}</p></div></div><p className={`font-bold ${row.direction === "In" ? "text-emerald-700" : "text-slate-900"}`}>{row.direction === "In" ? "+" : "-"}{money.format(row.amount)}</p></div>)}</div></section>
        </div>
      )}

      {activeTab === "suppliers" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900">Supplier payment run</h2><p className="text-xs text-slate-500">Approve and release verified supplier invoices electronically.</p></div><span className="text-xl font-bold">{money.format(totals.supplierDue)}</span></div><div className="mt-5 space-y-3">{data.suppliers.map((row) => <div key={row.id} className="flex flex-col gap-3 rounded-xl border border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-slate-900">{row.supplier}</p><p className="text-xs text-slate-500">{row.reference} · Due {row.due}</p></div><div className="flex items-center gap-3"><span className="font-bold">{money.format(row.amount)}</span><StatusBadge status={row.status} />{row.status !== "Paid" && <button disabled={readOnly} onClick={() => setData((current) => ({ ...current, suppliers: current.suppliers.map((x) => x.id === row.id ? { ...x, status: row.status === "Pending" ? "Approved" : "Paid" } : x) }))} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{row.status === "Pending" ? "Approve" : "Release payment"}</button>}</div></div>)}</div></section>
      )}

      {activeTab === "float" && (
        <section className="grid gap-4 lg:grid-cols-3">{data.floats.map((row) => { const healthy = row.balance >= row.minimum; return <div key={row.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><p className="font-bold text-slate-900">{row.name}</p><p className="text-xs text-slate-500">{row.channel}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${healthy ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{healthy ? "Healthy" : "Top up"}</span></div><p className="mt-6 text-3xl font-bold">{money.format(row.balance)}</p><p className="mt-1 text-xs text-slate-500">Minimum {money.format(row.minimum)}</p><div className="mt-4"><Progress value={(row.balance / Math.max(row.minimum * 2, 1)) * 100} warn={!healthy} /></div><button disabled={readOnly} onClick={() => setData((current) => ({ ...current, floats: current.floats.map((x) => x.id === row.id ? { ...x, balance: x.balance + 1000000 } : x) }))} className="mt-5 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Add {money.format(1000000)} float</button></div>; })}</section>
      )}

      {activeTab === "budgets" && (
        <section className="grid gap-4 md:grid-cols-2">{data.budgets.map((row) => { const pct = (row.spent / row.allocated) * 100; return <div key={row.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="font-bold text-slate-900">{row.department}</p><span className={`text-sm font-bold ${pct >= 85 ? "text-amber-600" : "text-emerald-700"}`}>{Math.round(pct)}% used</span></div><div className="mt-5"><Progress value={pct} warn={pct >= 85} /></div><div className="mt-4 grid grid-cols-3 gap-3 text-sm"><div><p className="text-xs text-slate-500">Allocated</p><p className="mt-1 font-bold">{money.format(row.allocated)}</p></div><div><p className="text-xs text-slate-500">Spent</p><p className="mt-1 font-bold">{money.format(row.spent)}</p></div><div><p className="text-xs text-slate-500">Available</p><p className="mt-1 font-bold text-emerald-700">{money.format(row.allocated - row.spent)}</p></div></div></div>; })}</section>
      )}

      {activeTab === "cards" && (
        <section className="grid gap-5 lg:grid-cols-3">{data.cards.map((row) => <div key={row.id} className={`overflow-hidden rounded-2xl p-5 text-white shadow-lg ${row.active ? "bg-gradient-to-br from-indigo-950 to-indigo-700" : "bg-slate-500"}`}><div className="flex items-center justify-between"><CreditCard className="h-7 w-7" /><span className="text-xs font-bold uppercase tracking-widest">{row.active ? "Active" : "Frozen"}</span></div><p className="mt-8 text-sm text-white/70">{row.label}</p><p className="mt-1 text-xl font-bold tracking-[0.25em]">•••• {row.last4}</p><div className="mt-6 flex items-end justify-between"><div><p className="text-xs text-white/60">Cardholder</p><p className="text-sm font-semibold">{row.holder}</p></div><div className="text-right"><p className="text-xs text-white/60">Available</p><p className="text-sm font-bold">{money.format(row.limit - row.spent)}</p></div></div><button disabled={readOnly} onClick={() => setData((current) => ({ ...current, cards: current.cards.map((x) => x.id === row.id ? { ...x, active: !x.active } : x) }))} className="mt-5 w-full rounded-lg bg-white/15 px-4 py-2 text-sm font-bold ring-1 ring-white/20 hover:bg-white/20 disabled:opacity-40">{row.active ? "Freeze card" : "Unfreeze card"}</button></div>)}</section>
      )}
    </div>
  );
}
