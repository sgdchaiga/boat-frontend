import { useMemo, useState } from "react";
import { BarChart3, BookOpenCheck, FileText, Landmark, Receipt, ShieldCheck, ShoppingCart, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type TabId = "receive" | "spend" | "approve" | "balances" | "reconcile" | "reports";
type Props = { onNavigate: (page: string) => void };
type Action = { title: string; description: string; page: string; icon: typeof Wallet };

const operational: Action[] = [
  { title: "Treasury & cashbook", description: "Review cash, bank movements, approvals and available funds.", page: "treasury", icon: Wallet },
  { title: "Record expense", description: "Enter day-to-day expenditure and submit it for approval.", page: "purchases_expenses", icon: Receipt },
  { title: "Bank reconciliation", description: "Match statements to the BOAT ledger and print reconciliation statements.", page: "accounting_bank_reconciliation", icon: Landmark },
  { title: "Vote book & budgets", description: "Monitor approved budgets, commitments and spending variance.", page: "school_vote_book", icon: BookOpenCheck },
];
const payables: Action[] = [
  { title: "Suppliers", description: "Maintain the approved supplier register.", page: "purchases_vendors", icon: ShoppingCart },
  { title: "Purchase orders", description: "Create and follow purchase approvals.", page: "purchases_orders", icon: FileText },
  { title: "Supplier bills", description: "Record GRNs and bills without duplicate accounting entry.", page: "purchases_bills", icon: Receipt },
  { title: "Supplier payments", description: "Review and release approved supplier payments.", page: "purchases_payments", icon: Wallet },
  { title: "Supplier returns", description: "Record returns and supplier credits.", page: "purchases_credits", icon: FileText },
];
const control: Action[] = [
  { title: "Journal entries", description: "Review system-generated and approved accounting entries.", page: "accounting_journal", icon: ShieldCheck },
  { title: "Manual journals", description: "Prepare controlled adjustments and supporting narrations.", page: "accounting_manual", icon: FileText },
  { title: "Chart of accounts", description: "Maintain the organization’s approved ledger structure.", page: "gl_accounts", icon: BookOpenCheck },
  { title: "General ledger", description: "Review posted transactions and account movements.", page: "accounting_gl", icon: BarChart3 },
  { title: "Cost allocation", description: "Allocate shared costs to departments or activities.", page: "accounting_cost_allocation", icon: BarChart3 },
  { title: "Opening balances & migration", description: "Load controlled opening and historical balances.", page: "data_migration", icon: FileText },
];
const reports: Action[] = [
  { title: "Finance report centre", description: "Open financial and school management reports.", page: "reports", icon: BarChart3 },
  { title: "Trial balance", description: "Review debit and credit account balances.", page: "accounting_trial", icon: FileText },
  { title: "Income statement", description: "Review income and expenditure performance.", page: "accounting_income", icon: BarChart3 },
  { title: "Statement of financial position", description: "Review assets, liabilities and accumulated funds.", page: "accounting_balance", icon: Landmark },
  { title: "Cash flow statement", description: "Review operating, investing and financing cash flows.", page: "accounting_cashflow", icon: Wallet },
];

export function FinanceOverviewPage({ onNavigate }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabId>("receive");
  const role = String(user?.role || "").toLowerCase().replace(/[ -]+/g, "_");
  const canUseAccountingControl = ["accountant", "finance_manager", "manager", "admin", "super_admin", "owner"].includes(role) || user?.isSuperAdmin;
  const tabs = useMemo(() => [
    { id: "receive" as const, label: "Receive", actions: [
      { title: "Receive school fees", description: "Record and allocate a student-fee payment.", page: "school_fee_payments", icon: Receipt },
      { title: "Record other income", description: "Record grants, donations and other school income.", page: "school_other_revenue", icon: Wallet },
      { title: "Daily collections", description: "Review money received by method and date.", page: "school_collections_summary", icon: BarChart3 },
    ] },
    { id: "spend" as const, label: "Spend", actions: [{ title: "Record expense", description: "Enter direct or petty-cash expenditure.", page: "purchases_expenses", icon: Receipt }, ...payables] },
    { id: "approve" as const, label: "Approve", actions: [{ title: "Approval inbox", description: "Review expenses, supplier bills and payments awaiting action.", page: "treasury", icon: ShieldCheck }] },
    { id: "balances" as const, label: "Balances", actions: [operational[0], operational[3]] },
    { id: "reconcile" as const, label: "Reconcile", actions: [operational[2], { title: "Cash-out reconciliation", description: "Review outgoing cash and supplier payments.", page: "purchases_cash_out_reconciliation", icon: Landmark }] },
    { id: "reports" as const, label: "Reports", actions: reports },
  ], []);
  const active = tabs.find((item) => item.id === tab) || tabs[0];

  return <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
    <div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Money</p><h1 className="mt-1 text-3xl font-bold text-slate-900">Money overview</h1><p className="mt-1 text-sm text-slate-600">Receive, spend, approve and reconcile money while BOAT handles the accounting entries in the background.</p></div>
    <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5" aria-label="Finance sections">{tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold transition ${active.id === item.id ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>{item.label}</button>)}</nav>
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{active.actions.map((action) => { const Icon=action.icon; return <button key={action.page} type="button" onClick={() => onNavigate(action.page)} className="group rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"><span className="inline-flex rounded-lg bg-indigo-50 p-2.5 text-indigo-700 group-hover:bg-indigo-100"><Icon className="h-5 w-5" /></span><h2 className="mt-4 font-bold text-slate-900">{action.title}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{action.description}</p><span className="mt-4 inline-block text-sm font-semibold text-indigo-700">Open →</span></button>; })}</section>
  </div>;
}
