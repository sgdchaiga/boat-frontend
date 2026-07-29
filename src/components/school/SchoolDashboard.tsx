import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { SCHOOL_PAGE } from "@/lib/schoolPages";
import { PageNotes } from "@/components/common/PageNotes";
import { SchoolDashboardV1 } from "./SchoolDashboardV1";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  ClipboardList,
  FilePlus2,
  GraduationCap,
  PackageSearch,
  Receipt,
  TrendingUp,
  UserPlus,
  UsersRound,
  Wallet,
} from "lucide-react";

type Props = {
  onNavigate: (page: string, state?: Record<string, unknown>) => void;
};

type PaymentRow = {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  paid_at: string;
};

type ExpenseRow = {
  id: string;
  amount: number;
  description: string | null;
  expense_date: string;
  status: string | null;
};

type DashboardData = {
  students: number;
  parents: number;
  invoices: number;
  billed: number;
  collected: number;
  outstanding: number;
  collectedToday: number;
  receiptsToday: number;
  pendingApprovals: number;
  recentPayments: PaymentRow[];
  recentExpenses: ExpenseRow[];
};

const initialData: DashboardData = {
  students: 0,
  parents: 0,
  invoices: 0,
  billed: 0,
  collected: 0,
  outstanding: 0,
  collectedToday: 0,
  receiptsToday: 0,
  pendingApprovals: 0,
  recentPayments: [],
  recentExpenses: [],
};

const money = (value: number) => new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 }).format(value);
const dateLabel = (value: string) => new Date(value).toLocaleDateString("en-UG", { day: "2-digit", month: "short" });

export function SchoolDashboard({ onNavigate }: Props) {
  const { user } = useAuth();
  const parts = (user?.app_version || "1.0").split(".").map((part) => Number(part) || 0);
  const release = (parts[0] || 0) * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
  if (release < 10100) return <SchoolDashboardV1 onNavigate={onNavigate} />;
  return <SchoolDashboardV11 onNavigate={onNavigate} />;
}

function SchoolDashboardV11({ onNavigate }: Props) {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const orgId = user?.organization_id;
      if (!orgId) return;
      setLoading(true);
      setError(null);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const [students, parents, invoices, payments, pendingPos, expenses] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }).eq("organization_id", orgId).neq("status", "left"),
        supabase.from("parents").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
        supabase.from("student_invoices").select("id,total_due,amount_paid").eq("organization_id", orgId),
        supabase.from("school_payments").select("id,amount,method,reference,paid_at").eq("organization_id", orgId).order("paid_at", { ascending: false }).limit(8),
        supabase.from("purchase_orders").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "pending"),
        supabase.from("expenses").select("id,amount,description,expense_date,status").eq("organization_id", orgId).neq("status", "cancelled").order("expense_date", { ascending: false }).limit(8),
      ]);
      if (cancelled) return;
      const firstError = students.error || parents.error || invoices.error || payments.error || pendingPos.error;
      if (firstError) setError(firstError.message);
      const invoiceRows = (invoices.data || []) as Array<{ total_due?: number; amount_paid?: number }>;
      const paymentRows = (payments.data || []) as PaymentRow[];
      const billed = invoiceRows.reduce((sum, row) => sum + Number(row.total_due || 0), 0);
      const collected = invoiceRows.reduce((sum, row) => sum + Number(row.amount_paid || 0), 0);
      const todaysPayments = paymentRows.filter((row) => {
        const paidAt = new Date(row.paid_at);
        return paidAt >= today && paidAt < tomorrow;
      });
      setData({
        students: students.count || 0,
        parents: parents.count || 0,
        invoices: invoiceRows.length,
        billed,
        collected,
        outstanding: Math.max(0, billed - collected),
        collectedToday: todaysPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0),
        receiptsToday: todaysPayments.length,
        pendingApprovals: pendingPos.count || 0,
        recentPayments: paymentRows,
        recentExpenses: expenses.error ? [] : ((expenses.data || []) as ExpenseRow[]),
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.organization_id]);

  const collectionRate = data.billed > 0 ? Math.min(100, (data.collected / data.billed) * 100) : 0;
  const role = user?.role || "admin";
  const roleLabel = role === "accountant" ? "Bursar / accountant" : role === "cashier" ? "Cashier" : role === "storekeeper" ? "Storekeeper" : role === "receptionist" ? "Admissions officer" : "School administrator";
  const quickActions = useMemo(() => {
    if (role === "cashier") return [
      { label: "Receive school fees", page: SCHOOL_PAGE.payments, icon: Receipt },
      { label: "View receipts", page: SCHOOL_PAGE.receipts, icon: FilePlus2 },
      { label: "Collections summary", page: SCHOOL_PAGE.collections, icon: TrendingUp },
    ];
    if (role === "storekeeper") return [
      { label: "Stock balances", page: "inventory_stock_balances", icon: PackageSearch },
      { label: "Purchase orders", page: "purchases_orders", icon: ClipboardList },
      { label: "Record expense", page: "purchases_expenses", icon: Banknote },
    ];
    if (role === "receptionist") return [
      { label: "Add student", page: SCHOOL_PAGE.students, icon: UserPlus },
      { label: "Student list", page: SCHOOL_PAGE.studentsList, icon: GraduationCap },
      { label: "Parents / guardians", page: SCHOOL_PAGE.parents, icon: UsersRound },
      { label: "Health alerts", page: SCHOOL_PAGE.healthIssues, icon: AlertTriangle },
    ];
    return [
      { label: "Receive school fees", page: SCHOOL_PAGE.payments, icon: Receipt },
      { label: "Create invoices", page: SCHOOL_PAGE.invoices, icon: FilePlus2 },
      { label: "Add student", page: SCHOOL_PAGE.students, icon: UserPlus },
      { label: "Review approvals", page: "purchases_orders", icon: CheckCircle2 },
    ];
  }, [role]);

  const cards = [
    { label: "Active students", value: data.students.toLocaleString(), page: SCHOOL_PAGE.studentsList, icon: GraduationCap },
    { label: "Fees billed", value: money(data.billed), page: SCHOOL_PAGE.invoices, icon: FilePlus2 },
    { label: "Fees collected", value: money(data.collected), page: SCHOOL_PAGE.collections, icon: Receipt },
    { label: "Outstanding fees", value: money(data.outstanding), page: SCHOOL_PAGE.invoices, icon: Wallet, alert: data.outstanding > 0 },
    { label: "Collections today", value: money(data.collectedToday), page: SCHOOL_PAGE.payments, icon: Banknote },
    { label: "Pending approvals", value: data.pendingApprovals.toLocaleString(), page: "purchases_orders", icon: ClipboardList, alert: data.pendingApprovals > 0 },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2"><h1 className="text-3xl font-bold text-slate-900">{user?.organization_name || "School dashboard"}</h1><PageNotes ariaLabel="School dashboard help"><p>This shared dashboard prioritizes students, billing, collections, balances, approvals and exceptions. Detailed accounting and inventory remain in their dedicated workspaces.</p></PageNotes></div><p className="mt-1 text-sm text-slate-500">{roleLabel} view · live operational overview</p></div>
        <button type="button" onClick={() => onNavigate(SCHOOL_PAGE.payments)} className="app-btn-primary"><Receipt className="h-4 w-4"/> Record payment</button>
      </header>

      {error && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">Some dashboard information could not be loaded: {error}</div>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {cards.map(({ label, value, page, icon: Icon, alert }) => <button key={label} type="button" onClick={() => onNavigate(page)} className={`rounded-xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${alert ? "border-amber-300" : "border-slate-200"}`}><div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span><Icon className={`h-5 w-5 ${alert ? "text-amber-600" : "text-brand-700"}`}/></div><p className="text-2xl font-bold text-slate-900">{loading ? "—" : value}</p></button>)}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-semibold text-slate-900">Quick actions</h2><div className="mt-3 flex flex-wrap gap-2">{quickActions.map(({ label, page, icon: Icon }) => <button key={label} type="button" onClick={() => onNavigate(page)} className="app-btn-secondary"><Icon className="h-4 w-4"/>{label}</button>)}</div></section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between"><div><h2 className="font-semibold text-slate-900">Fee collection progress</h2><p className="text-xs text-slate-500">{money(data.collected)} collected from {money(data.billed)} billed</p></div><strong className="text-xl text-brand-700">{collectionRate.toFixed(1)}%</strong></div><div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${collectionRate}%` }}/></div><div className="mt-4 grid grid-cols-3 gap-3 text-sm"><Summary label="Invoices" value={data.invoices.toLocaleString()}/><Summary label="Receipts today" value={data.receiptsToday.toLocaleString()}/><Summary label="Balance" value={money(data.outstanding)}/></div></section>
        <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-900">Student summary</h2><div className="mt-4 grid grid-cols-2 gap-4"><Summary label="Active students" value={data.students.toLocaleString()}/><Summary label="Parents / guardians" value={data.parents.toLocaleString()}/></div><button type="button" onClick={() => onNavigate(SCHOOL_PAGE.studentsList)} className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">Open student register <ArrowRight className="h-4 w-4"/></button></section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-900">Tasks requiring attention</h2><div className="mt-3 divide-y divide-slate-100">{data.pendingApprovals > 0 && <Attention label={`${data.pendingApprovals} purchase order${data.pendingApprovals === 1 ? "" : "s"} awaiting approval`} action="Review approvals" onClick={() => onNavigate("purchases_orders")}/>} {data.outstanding > 0 && <Attention label={`${money(data.outstanding)} in outstanding school fees`} action="Review balances" onClick={() => onNavigate(SCHOOL_PAGE.invoices)}/>} {data.receiptsToday === 0 && <Attention label="No school-fee receipts recorded today" action="Receive payment" onClick={() => onNavigate(SCHOOL_PAGE.payments)}/>} {data.pendingApprovals === 0 && data.outstanding === 0 && data.receiptsToday > 0 && <p className="py-4 text-sm text-emerald-700">No urgent exceptions require attention.</p>}</div></section>

      <div className="grid gap-6 lg:grid-cols-2">
        <ActivityPanel title="Recent money received" empty="No recent school-fee payments." rows={data.recentPayments.map((row) => ({ id: row.id, primary: row.reference || "School-fee payment", secondary: `${dateLabel(row.paid_at)} · ${row.method}`, amount: money(row.amount) }))} onOpen={() => onNavigate(SCHOOL_PAGE.payments)}/>
        <ActivityPanel title="Recent spending" empty="No recent spending recorded." rows={data.recentExpenses.map((row) => ({ id: row.id, primary: row.description || "Expense", secondary: `${dateLabel(row.expense_date)} · ${row.status || "recorded"}`, amount: money(row.amount) }))} onOpen={() => onNavigate("purchases_expenses")}/>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-900">{value}</p></div>;
}

function Attention({ label, action, onClick }: { label: string; action: string; onClick: () => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="flex items-center gap-2 text-sm text-slate-700"><AlertTriangle className="h-4 w-4 text-amber-500"/>{label}</span><button type="button" onClick={onClick} className="text-sm font-semibold text-brand-700">{action}</button></div>;
}

function ActivityPanel({ title, empty, rows, onOpen }: { title: string; empty: string; rows: Array<{ id: string; primary: string; secondary: string; amount: string }>; onOpen: () => void }) {
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 p-4"><h2 className="font-semibold text-slate-900">{title}</h2><button type="button" onClick={onOpen} className="text-xs font-semibold text-brand-700">View all</button></div><div className="divide-y divide-slate-100">{rows.slice(0, 5).map((row) => <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><div className="min-w-0"><p className="truncate font-medium text-slate-800">{row.primary}</p><p className="text-xs capitalize text-slate-500">{row.secondary}</p></div><strong className="tabular-nums text-slate-900">{row.amount}</strong></div>)}{!rows.length && <p className="p-6 text-center text-sm text-slate-500">{empty}</p>}</div></section>;
}
