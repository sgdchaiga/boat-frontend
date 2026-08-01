import { useEffect, useState } from "react";
import { ArrowRight, Banknote, BookOpen, FileText, Receipt, ShoppingCart, TrendingUp, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { useGeneralBusinessMode } from "@/lib/generalBusinessMode";

type Props = { onNavigate: (page: string, state?: Record<string, unknown>) => void };
type Summary = { sales: number; expenses: number; receivables: number; payables: number; overdueCustomers: number; overdueSuppliers: number };
const EMPTY: Summary = { sales: 0, expenses: 0, receivables: 0, payables: 0, overdueCustomers: 0, overdueSuppliers: 0 };
const money = (value: number) => new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 }).format(value);

export function GeneralBusinessDashboard({ onNavigate }: Props) {
  const { user } = useAuth();
  const { mode, setMode } = useGeneralBusinessMode(user?.id, user?.organization_id);
  const [summary, setSummary] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (mode !== "modern") setMode("modern");
  }, [mode, setMode]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const orgId = user?.organization_id;
      if (!orgId) return;
      const start = new Date();
      start.setDate(1);
      const periodStart = start.toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const [invoices, expenses, bills] = await Promise.all([
        supabase.from("retail_invoices").select("total,status,due_date,issue_date").eq("organization_id", orgId).neq("status", "void"),
        supabase.from("expenses").select("amount,expense_date").eq("organization_id", orgId).gte("expense_date", periodStart),
        supabase.from("bills").select("amount,status,due_date,bill_date").eq("organization_id", orgId),
      ]);
      if (cancelled) return;
      const invoiceRows = (invoices.data || []) as Array<{ total: number; status: string; due_date: string | null; issue_date: string }>;
      const billRows = (bills.data || []) as Array<{ amount: number; status: string; due_date: string | null; bill_date: string }>;
      setSummary({
        sales: invoiceRows.filter((row) => row.issue_date >= periodStart).reduce((sum, row) => sum + Number(row.total || 0), 0),
        expenses: ((expenses.data || []) as Array<{ amount: number }>).reduce((sum, row) => sum + Number(row.amount || 0), 0),
        receivables: invoiceRows.filter((row) => row.status !== "paid").reduce((sum, row) => sum + Number(row.total || 0), 0),
        payables: billRows.filter((row) => !["paid", "cancelled", "void"].includes(row.status)).reduce((sum, row) => sum + Number(row.amount || 0), 0),
        overdueCustomers: invoiceRows.filter((row) => row.status !== "paid" && !!row.due_date && row.due_date < today).length,
        overdueSuppliers: billRows.filter((row) => !["paid", "cancelled", "void"].includes(row.status) && !!row.due_date && row.due_date < today).length,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.organization_id]);

  const cards = [
    { label: "Sales this month", value: summary.sales, icon: TrendingUp, page: "retail_credit_invoices" },
    { label: "Expenses this month", value: summary.expenses, icon: Receipt, page: "purchases_expenses" },
    { label: "Customers owing", value: summary.receivables, icon: Wallet, page: "retail_credit_invoices" },
    { label: "Suppliers to pay", value: summary.payables, icon: ShoppingCart, page: "purchases_bills" },
  ];
  const primarySalesPage = user?.sales_workflow === "quick_sale" ? "retail_pos" : "retail_credit_invoices";

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-wider text-brand-700">General Business</p><h1 className="mt-1 text-3xl font-bold text-slate-900">{user?.organization_name || "Business dashboard"}</h1><p className="mt-1 text-sm text-slate-600">Sales, spending, money owed and accounting in one shared workspace.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 text-sm" aria-label="General Business mode">
            <button type="button" onClick={() => setMode("modern")} className={`rounded-md px-3 py-1.5 font-semibold ${mode === "modern" ? "bg-brand-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}>Modern</button>
            <button type="button" onClick={() => { setMode("cashbook"); onNavigate("general_business_cashbook"); }} className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 font-semibold ${mode === "cashbook" ? "bg-brand-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}><BookOpen className="h-4 w-4" />Cashbook</button>
          </div>
          <button type="button" className="app-btn-primary" onClick={() => onNavigate(primarySalesPage)}><FileText className="h-4 w-4" />{user?.sales_workflow === "quick_sale" ? "New quick sale" : "New sales invoice"}</button>
        </div>
      </header>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, page }) => <button key={label} type="button" onClick={() => onNavigate(page)} className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-brand-300 hover:shadow-md"><div className="flex items-center justify-between text-slate-500"><span className="text-xs font-semibold uppercase tracking-wide">{label}</span><Icon className="h-5 w-5 text-brand-700" /></div><p className="mt-3 text-2xl font-bold text-slate-900">{loading ? "—" : money(value)}</p></button>)}
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <Attention label="Overdue customer invoices" count={summary.overdueCustomers} action="Review customers owing" onClick={() => onNavigate("retail_credit_invoices", { invoiceTab: "credit" })} />
        <Attention label="Overdue supplier bills" count={summary.overdueSuppliers} action="Review suppliers to pay" onClick={() => onNavigate("purchases_bills")} />
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-bold text-slate-900">Common tasks</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Action label="Money In" icon={Banknote} onClick={() => onNavigate("cash_receipts")} /><Action label="Money Out" icon={Receipt} onClick={() => onNavigate("purchases_expenses")} /><Action label="Reconcile accounts" icon={Wallet} onClick={() => onNavigate("accounting_bank_reconciliation")} /><Action label="Financial reports" icon={TrendingUp} onClick={() => onNavigate("accounting_income")} /></div></section>
    </div>
  );
}

function Attention({ label, count, action, onClick }: { label: string; count: number; action: string; onClick: () => void }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold text-slate-900">{count}</p><button type="button" onClick={onClick} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">{action}<ArrowRight className="h-4 w-4" /></button></div>;
}
function Action({ label, icon: Icon, onClick }: { label: string; icon: typeof Wallet; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 text-left font-semibold text-slate-800 hover:bg-slate-50"><Icon className="h-5 w-5 text-brand-700" />{label}</button>;
}
