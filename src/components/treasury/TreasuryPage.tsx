import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Banknote, Building2, Check, Clock3, Eye, EyeOff, FileText, Landmark, LayoutDashboard, ListFilter, PackageCheck, PieChart, RefreshCw, Search, ShieldCheck, Users, WalletCards, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { supabase } from "@/lib/supabase";
import { createJournalForExpenseWithLines, createJournalForVendorPayment, reverseJournalEntriesByReference, type ExpenseJournalLineInput } from "@/lib/journal";
import { syncBillStatusInDb } from "@/lib/billStatus";

type Status = "pending_approval" | "approved" | "rejected" | "disbursed";
type TreasuryRequest = {
  id: string;
  source_type: "expense" | "bill";
  source_id: string;
  request_type: "expense" | "supplier_payment";
  payee_name: string | null;
  purpose: string;
  amount: number;
  vendor_id: string | null;
  status: Status;
  requested_at: string;
  payment_method: string | null;
  payment_reference: string | null;
};
type Collection = { amount: number; payment_source: string | null; paid_at: string; payment_method: string | null };
type TreasuryTab = "overview" | "cash-control" | "approvals" | "disbursements" | "budgets" | "wallets" | "collections" | "history";
type PaymentMethod = "cash" | "bank_transfer" | "mobile_money" | "wallet" | "card";
type FundingAccount = { id: string; account_code: string; account_name: string; account_type: string; category: string | null };
type CashAccount = FundingAccount & { balance: number; kind: "Cash" | "Bank" | "Mobile / wallet" | "Float" };
type BudgetControl = { id: string; name: string; period_label: string | null; allocated: number; committed: number };
type WalletSummary = { count: number; balance: number; active: number };

const money = new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 });
const statusLabel: Record<Status, string> = {
  pending_approval: "Pending approval",
  approved: "Ready to disburse",
  rejected: "Rejected",
  disbursed: "Disbursed",
};

function StatusBadge({ status }: { status: Status }) {
  const tone =
    status === "disbursed"
      ? "bg-emerald-100 text-emerald-700"
      : status === "approved"
        ? "bg-blue-100 text-blue-700"
        : status === "rejected"
          ? "bg-rose-100 text-rose-700"
          : "bg-amber-100 text-amber-700";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{statusLabel[status]}</span>;
}

function MetricCard({ label, value, hint, icon: Icon }: { label: string; value: string; hint: string; icon: typeof Banknote }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p><p data-treasury-comment className="mt-1 text-xs text-slate-500">{hint}</p></div>
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><Icon className="h-5 w-5" /></span>
      </div>
    </div>
  );
}

function Progress({ value, warn = false }: { value: number; warn?: boolean }) {
  return <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${warn ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

export function TreasuryPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const [requests, setRequests] = useState<TreasuryRequest[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TreasuryTab>("overview");
  const [sourceFilter, setSourceFilter] = useState<"all" | "expense" | "bill">("all");
  const [search, setSearch] = useState("");
  const [fundingAccounts, setFundingAccounts] = useState<FundingAccount[]>([]);
  const [releaseRequest, setReleaseRequest] = useState<TreasuryRequest | null>(null);
  const [releasePaymentMethod, setReleasePaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [releaseFundingAccountId, setReleaseFundingAccountId] = useState("");
  const [releaseReference, setReleaseReference] = useState("");
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [budgetControls, setBudgetControls] = useState<BudgetControl[]>([]);
  const [walletSummary, setWalletSummary] = useState<WalletSummary>({ count: 0, balance: 0, active: 0 });
  const [showComments, setShowComments] = useState(false);
  const [spendMoneyApprovalEnabled, setSpendMoneyApprovalEnabled] = useState(true);

  const fetchData = useCallback(async () => {
    if (!user?.organization_id) return;
    setLoading(true);
    const [requestRes, collectionRes, accountRes, budgetRes, walletRes, walletBalanceRes, workflowRes] = await Promise.all([
      supabase.from("treasury_requests").select("*").eq("organization_id", user.organization_id).order("requested_at", { ascending: false }),
      supabase.from("payments").select("amount,payment_source,paid_at,payment_method").eq("organization_id", user.organization_id).eq("payment_status", "completed").in("payment_source", ["pos_hotel", "pos_retail", "pos_clinic", "debtor"]).order("paid_at", { ascending: false }).limit(100),
      supabase.from("gl_accounts").select("id,account_code,account_name,account_type,category").eq("organization_id", user.organization_id).order("account_code"),
      supabase.from("budgets").select("id,name,period_label,is_active,budget_lines(amount)").eq("organization_id", user.organization_id).eq("is_active", true),
      supabase.from("wallets").select("id,status").eq("organization_id", user.organization_id),
      supabase.from("wallet_balances").select("current_balance").eq("organization_id", user.organization_id),
      supabase.from("organization_permissions").select("allowed").eq("organization_id", user.organization_id).eq("role_key", "__org__").eq("permission_key", "treasury_spend_money_approval_enabled").maybeSingle(),
    ]);
    if (requestRes.error) console.error("Unable to load Treasury requests:", requestRes.error);
    if (collectionRes.error) console.error("Unable to load Treasury collections:", collectionRes.error);
    if (accountRes.error) console.error("Unable to load Treasury funding accounts:", accountRes.error);
    setRequests((requestRes.data || []) as TreasuryRequest[]);
    setCollections((collectionRes.data || []) as Collection[]);
    setSpendMoneyApprovalEnabled(workflowRes.data?.allowed !== false);
    const nextFundingAccounts = ((accountRes.data || []) as FundingAccount[]).filter((account) => {
      if (String(account.category || "").toLowerCase() === "cash") return true;
      if (account.account_type !== "asset") return false;
      return /(cash|bank|wallet|mobile money|momo|airtel|mtn|card|current account|checking|savings|stanbic|absa|centenary|dfcu|equity|kcb|barclays|standard chartered)/i.test(`${account.account_code} ${account.account_name}`);
    });
    setFundingAccounts(nextFundingAccounts);
    const requests = (requestRes.data || []) as TreasuryRequest[];
    const committed = requests.filter((row) => row.status === "approved").reduce((sum, row) => sum + Number(row.amount || 0), 0);
    setBudgetControls(((budgetRes.data || []) as Array<{ id: string; name: string; period_label: string | null; budget_lines?: Array<{ amount: number }> }>).map((budget) => ({
      id: budget.id,
      name: budget.name,
      period_label: budget.period_label,
      allocated: (budget.budget_lines || []).reduce((sum, line) => sum + Number(line.amount || 0), 0),
      committed,
    })));
    const walletRows = (walletRes.data || []) as Array<{ id: string; status: string }>;
    setWalletSummary({
      count: walletRows.length,
      active: walletRows.filter((wallet) => wallet.status === "active").length,
      balance: ((walletBalanceRes.data || []) as Array<{ current_balance: number }>).reduce((sum, row) => sum + Number(row.current_balance || 0), 0),
    });
    if (nextFundingAccounts.length > 0) {
      const { data: cashLines, error: cashLinesError } = await supabase
        .from("journal_entry_lines")
        .select("gl_account_id,debit,credit,journal_entries!inner(organization_id,is_posted,is_deleted)")
        .in("gl_account_id", nextFundingAccounts.map((account) => account.id))
        .eq("journal_entries.organization_id", user.organization_id)
        .eq("journal_entries.is_posted", true)
        .eq("journal_entries.is_deleted", false);
      if (cashLinesError) console.error("Unable to load Treasury cash balances:", cashLinesError);
      const balances = new Map<string, number>();
      for (const line of cashLines || []) {
        const row = line as { gl_account_id: string; debit: number; credit: number };
        balances.set(row.gl_account_id, (balances.get(row.gl_account_id) || 0) + Number(row.debit || 0) - Number(row.credit || 0));
      }
      setCashAccounts(nextFundingAccounts.map((account) => {
        const label = `${account.account_code} ${account.account_name}`.toLowerCase();
        const kind: CashAccount["kind"] = /float/.test(label) ? "Float" : /(wallet|mobile money|momo|airtel|mtn)/.test(label) ? "Mobile / wallet" : /bank|current|checking|savings|stanbic|absa|centenary|dfcu|equity|kcb|barclays|standard chartered/.test(label) ? "Bank" : "Cash";
        return { ...account, balance: balances.get(account.id) || 0, kind };
      }));
    } else {
      setCashAccounts([]);
    }
    setLoading(false);
  }, [user?.organization_id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!spendMoneyApprovalEnabled && activeTab === "approvals") setActiveTab("overview");
  }, [activeTab, spendMoneyApprovalEnabled]);

  const totals = useMemo(() => {
    const pending = requests.filter((r) => r.status === "pending_approval").reduce((s, r) => s + Number(r.amount), 0);
    const ready = requests.filter((r) => r.status === "approved").reduce((s, r) => s + Number(r.amount), 0);
    const pos = collections.filter((r) => r.payment_source?.startsWith("pos_")).reduce((s, r) => s + Number(r.amount), 0);
    const billing = collections.filter((r) => r.payment_source === "debtor").reduce((s, r) => s + Number(r.amount), 0);
    const disbursed = requests.filter((r) => r.status === "disbursed").reduce((s, r) => s + Number(r.amount), 0);
    const inflows = pos + billing;
    return { pending, ready, pos, billing, disbursed, inflows, projectedAvailable: inflows - ready };
  }, [requests, collections]);

  const visibleRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter((request) => {
      if (sourceFilter !== "all" && request.source_type !== sourceFilter) return false;
      if (activeTab === "approvals" && request.status !== "pending_approval") return false;
      if (activeTab === "disbursements" && request.status !== "approved") return false;
      if (activeTab === "history" && !["disbursed", "rejected"].includes(request.status)) return false;
      if (!q) return true;
      return [request.payee_name, request.purpose, request.source_type, request.status]
        .some((value) => String(value || "").toLowerCase().includes(q));
    });
  }, [activeTab, requests, search, sourceFilter]);

  const spendMoneyRequests = requests.filter((request) => request.source_type === "expense");
  const buyStockRequests = requests.filter((request) => request.source_type === "bill");
  const cashUnderManagement = cashAccounts.reduce((sum, account) => sum + account.balance, 0);
  const pettyCashBalance = cashAccounts.filter((account) => /petty|imprest/i.test(account.account_name)).reduce((sum, account) => sum + account.balance, 0);
  const lowFloatAccounts = cashAccounts.filter((account) => account.kind === "Float" && account.balance <= 0);

  const setStatus = async (request: TreasuryRequest, status: "approved" | "rejected") => {
    if (readOnly) return;
    const rejectionReason = status === "rejected" && request.source_type === "expense"
      ? window.prompt("Reason for rejecting and cancelling this expense", "Rejected in Treasury")
      : null;
    if (status === "rejected" && request.source_type === "expense" && !rejectionReason?.trim()) return;
    setWorkingId(request.id);
    const now = new Date().toISOString();
    try {
      if (status === "rejected" && request.source_type === "expense") {
        const reason = rejectionReason!.trim();
        const reversal = await reverseJournalEntriesByReference("expense", request.source_id, user?.id ?? null, reason);
        if (!reversal.ok) throw new Error(`Expense journal reversal failed: ${reversal.error}`);
        const { error: expenseError } = await supabase.from("expenses").update({
          status: "cancelled",
          cancelled_at: now,
          cancelled_by: user?.id ?? null,
          cancellation_reason: reason,
        }).eq("id", request.source_id);
        if (expenseError) throw expenseError;
        const { error: requestError } = await supabase.from("treasury_requests").update({
          status,
          rejected_by: user?.id ?? null,
          rejected_at: now,
          rejection_reason: reason,
        }).eq("id", request.id);
        if (requestError) throw requestError;
      } else {
        const patch = status === "approved"
          ? { status, approved_by: user?.id ?? null, approved_at: now }
          : { status, rejected_by: user?.id ?? null, rejected_at: now };
        const { error } = await supabase.from("treasury_requests").update(patch).eq("id", request.id);
        if (error) throw error;
      }
    } catch (error) {
      alert(`Treasury update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await fetchData();
    setWorkingId(null);
  };

  const openReleaseDialog = (request: TreasuryRequest) => {
    const method = (["cash", "bank_transfer", "mobile_money", "wallet", "card"].includes(request.payment_method || "")
      ? request.payment_method
      : "bank_transfer") as PaymentMethod;
    setReleaseRequest(request);
    setReleasePaymentMethod(method);
    setReleaseFundingAccountId("");
    setReleaseReference(request.payment_reference || "");
  };

  const disburse = async () => {
    const request = releaseRequest;
    if (!request) return;
    if (readOnly || request.status !== "approved") return;
    if (!releaseFundingAccountId) {
      alert("Select the cash, bank, wallet, or other account funding this payment.");
      return;
    }
    const paymentMethod = releasePaymentMethod;
    const reference = releaseReference.trim() || null;
    setWorkingId(request.id);
    try {
      if (request.source_type === "bill") {
        if (!request.vendor_id) throw new Error("The supplier is missing from this Treasury request.");
        const paymentDate = new Date().toISOString().slice(0, 10);
        const { data: payment, error } = await supabase.from("vendor_payments").insert({
          vendor_id: request.vendor_id,
          bill_id: request.source_id,
          amount: request.amount,
          payment_date: paymentDate,
          payment_method: paymentMethod,
          reference,
        }).select("id,payment_date").single();
        if (error) throw error;
        const journal = await createJournalForVendorPayment(payment.id, request.amount, payment.payment_date || paymentDate, user?.id ?? null, {
          payableAmount: request.amount,
          unearnedExcessAmount: 0,
          sourceFundsGlAccountId: releaseFundingAccountId,
        });
        if (!journal.ok) alert(`Supplier payment released, but its journal was not posted: ${journal.error}`);
        await syncBillStatusInDb(request.source_id);
      } else {
        const [expenseRes, linesRes] = await Promise.all([
          supabase.from("expenses").select("expense_date").eq("id", request.source_id).single(),
          supabase.from("expense_lines").select("expense_gl_account_id,source_cash_gl_account_id,amount,bank_charges,vat_amount,vat_gl_account_id,bank_charges_gl_account_id,comment,quantity").eq("expense_id", request.source_id).order("sort_order"),
        ]);
        if (expenseRes.error) throw expenseRes.error;
        if (linesRes.error) throw linesRes.error;
        const releaseLines = (linesRes.data as ExpenseJournalLineInput[]).map((line) => ({
          ...line,
          source_cash_gl_account_id: releaseFundingAccountId,
        }));
        const { error: sourceUpdateError } = await supabase
          .from("expense_lines")
          .update({ source_cash_gl_account_id: releaseFundingAccountId })
          .eq("expense_id", request.source_id);
        if (sourceUpdateError) throw sourceUpdateError;
        const journal = await createJournalForExpenseWithLines(request.source_id, expenseRes.data.expense_date, releaseLines, user?.id ?? null);
        if (!journal.ok) throw new Error(`Expense journal was not posted: ${journal.error}`);
      }
      const { error } = await supabase.from("treasury_requests").update({
        status: "disbursed",
        disbursed_by: user?.id ?? null,
        disbursed_at: new Date().toISOString(),
        payment_method: paymentMethod,
        payment_reference: reference,
      }).eq("id", request.id);
      if (error) throw error;
      setReleaseRequest(null);
    } catch (error) {
      alert(`Fund release failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await fetchData();
    setWorkingId(null);
  };

  return (
    <div className={`mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8 ${showComments ? "" : "[&_[data-treasury-comment]]:hidden"}`}>
      {readOnly && <ReadOnlyNotice />}
      <div className="overflow-hidden rounded-3xl bg-slate-950 px-6 py-7 text-white shadow-xl sm:px-8">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-emerald-300">BOAT Treasury</p>
        <div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div><h1 className="text-3xl font-bold tracking-tight">Approve and release business funds.</h1><p data-treasury-comment className="mt-2 text-sm text-slate-300">Expenses, approved supplier bills, POS collections, and billing receipts in one accountable workspace.</p></div>
          <div className="flex items-end gap-3"><div className="rounded-xl bg-white/10 px-4 py-2"><p className="text-[10px] uppercase tracking-wide text-slate-300">Cash under management</p><p className="font-bold">{money.format(cashUnderManagement)}</p></div><button type="button" onClick={() => setShowComments((current) => !current)} title={showComments ? "Hide comments" : "Show comments"} aria-label={showComments ? "Hide Treasury comments" : "Show Treasury comments"} className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20">{showComments ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button><button onClick={fetchData} className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"><RefreshCw className="h-4 w-4" /> Refresh</button></div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {([
          ["overview", "Overview", LayoutDashboard],
          ["cash-control", "Cash, petty cash & float", Landmark],
          ...(spendMoneyApprovalEnabled ? [["approvals", "Spend Money approvals", ShieldCheck] as const] : []),
          ["disbursements", "Supplier payments", Banknote],
          ["budgets", "Budget controls", PieChart],
          ["wallets", "Wallet visibility", Users],
          ["collections", "Incoming funds", ArrowDownRight],
          ["history", "History", Clock3],
        ] as Array<[TreasuryTab, string, typeof Banknote]>).map(([tab, label, Icon]) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ${activeTab === tab ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Cash inflows captured" value={money.format(totals.inflows)} hint="POS and billing collections" icon={WalletCards} />
        {spendMoneyApprovalEnabled && <MetricCard label="Pending approvals" value={money.format(totals.pending)} hint="Spend Money requests awaiting review" icon={ShieldCheck} />}
        <MetricCard label="Ready to release" value={money.format(totals.ready)} hint="Approved expenses and Buy Stock bills" icon={Banknote} />
        <MetricCard label="Projected after release" value={money.format(totals.projectedAvailable)} hint="Captured inflows less approved releases" icon={totals.projectedAvailable >= 0 ? ArrowUpRight : ArrowDownRight} />
      </div>

      {activeTab === "overview" ? (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            {spendMoneyApprovalEnabled && <button type="button" onClick={() => { setActiveTab("approvals"); setSourceFilter("expense"); }} className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 text-left shadow-sm hover:border-amber-300">
              <div className="flex items-center justify-between"><span className="rounded-xl bg-amber-100 p-3 text-amber-700"><FileText className="h-5 w-5" /></span><span className="text-2xl font-bold text-slate-900">{spendMoneyRequests.filter((r) => r.status === "pending_approval").length}</span></div>
              <h3 className="mt-4 font-bold text-slate-900">Spend Money approvals</h3><p data-treasury-comment className="mt-1 text-sm text-slate-500">Review expenses received directly from Spend Money before funds are released.</p>
            </button>}
            <button type="button" onClick={() => { setActiveTab("disbursements"); setSourceFilter("bill"); }} className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 text-left shadow-sm hover:border-blue-300">
              <div className="flex items-center justify-between"><span className="rounded-xl bg-blue-100 p-3 text-blue-700"><PackageCheck className="h-5 w-5" /></span><span className="text-2xl font-bold text-slate-900">{buyStockRequests.filter((r) => r.status === "approved").length}</span></div>
              <h3 className="mt-4 font-bold text-slate-900">Buy Stock supplier payments</h3><p data-treasury-comment className="mt-1 text-sm text-slate-500">Approved Buy Stock bills arrive ready for supplier fund disbursement.</p>
            </button>
            <button type="button" onClick={() => setActiveTab("collections")} className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 text-left shadow-sm hover:border-emerald-300">
              <div className="flex items-center justify-between"><span className="rounded-xl bg-emerald-100 p-3 text-emerald-700"><Landmark className="h-5 w-5" /></span><span className="text-2xl font-bold text-slate-900">{collections.length}</span></div>
              <h3 className="mt-4 font-bold text-slate-900">Incoming collections</h3><p data-treasury-comment className="mt-1 text-sm text-slate-500">Monitor completed POS and billing receipts available to Treasury.</p>
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <button type="button" onClick={() => setActiveTab("cash-control")} className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-slate-400">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Digital petty cash</p><p className="mt-2 text-2xl font-bold text-slate-900">{money.format(pettyCashBalance)}</p><p data-treasury-comment className="mt-1 text-sm text-slate-500">Backed by posted petty cash and imprest GL entries.</p>
            </button>
            <button type="button" onClick={() => setActiveTab("wallets")} className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-left shadow-sm hover:border-indigo-400">
              <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">Customer / student wallets</p><p className="mt-2 text-2xl font-bold text-slate-900">{money.format(walletSummary.balance)}</p><p data-treasury-comment className="mt-1 text-sm text-slate-500">{walletSummary.active} active of {walletSummary.count} wallets.</p>
            </button>
            <button type="button" onClick={() => setActiveTab("budgets")} className="rounded-2xl border border-violet-200 bg-violet-50 p-5 text-left shadow-sm hover:border-violet-400">
              <p className="text-xs font-bold uppercase tracking-wide text-violet-700">Budget controls</p><p className="mt-2 text-2xl font-bold text-slate-900">{budgetControls.length}</p><p data-treasury-comment className="mt-1 text-sm text-slate-500">Active budgets monitored against approved Treasury commitments.</p>
            </button>
          </div>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">Cash movement forecast</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-emerald-50 p-4"><p className="text-xs font-semibold uppercase text-emerald-700">Collections</p><p className="mt-2 text-xl font-bold">{money.format(totals.inflows)}</p></div>
              <div className="rounded-xl bg-amber-50 p-4"><p className="text-xs font-semibold uppercase text-amber-700">Awaiting approval</p><p className="mt-2 text-xl font-bold">{money.format(totals.pending)}</p></div>
              <div className="rounded-xl bg-blue-50 p-4"><p className="text-xs font-semibold uppercase text-blue-700">Approved outflow</p><p className="mt-2 text-xl font-bold">{money.format(totals.ready)}</p></div>
              <div className="rounded-xl bg-slate-100 p-4"><p className="text-xs font-semibold uppercase text-slate-600">Already disbursed</p><p className="mt-2 text-xl font-bold">{money.format(totals.disbursed)}</p></div>
            </div>
            {(lowFloatAccounts.length > 0 || budgetControls.some((budget) => budget.allocated > 0 && budget.committed / budget.allocated >= 0.85)) && <div className="mt-4 grid gap-2 md:grid-cols-2">
              {lowFloatAccounts.map((account) => <div key={account.id} className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle className="h-5 w-5 shrink-0" /><span><strong>{account.account_name}</strong> has a zero or negative posted balance.</span></div>)}
              {budgetControls.filter((budget) => budget.allocated > 0 && budget.committed / budget.allocated >= 0.85).map((budget) => <div key={budget.id} className="flex gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800"><AlertTriangle className="h-5 w-5 shrink-0" /><span><strong>{budget.name}</strong> has approved commitments at {Math.round((budget.committed / budget.allocated) * 100)}% of budget.</span></div>)}
            </div>}
          </section>
        </>
      ) : null}

      {["approvals", "disbursements", "history"].includes(activeTab) ? <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h2 className="font-bold text-slate-900">{activeTab === "approvals" ? "Spend Money approval queue" : activeTab === "disbursements" ? "Approved fund disbursements" : "Treasury request history"}</h2><p data-treasury-comment className="text-sm text-slate-500">Spend Money entries arrive for approval; approved Buy Stock bills arrive ready for payment.</p></div>
          <div className="flex flex-wrap gap-2">
            <label className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search requests" className="rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" /></label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm text-slate-600"><ListFilter className="h-4 w-4" /><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)} className="bg-transparent py-2 outline-none"><option value="all">All sources</option><option value="expense">Spend Money</option><option value="bill">Buy Stock</option></select></label>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Source</th><th className="px-5 py-3">Payee / purpose</th><th className="px-5 py-3">Amount</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">Loading Treasury...</td></tr> : visibleRequests.length === 0 ? <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">No matching Treasury requests.</td></tr> : visibleRequests.map((request) => (
                <tr key={request.id}>
                  <td className="px-5 py-4"><span className="inline-flex items-center gap-2 font-semibold text-slate-700">{request.source_type === "bill" ? <Building2 className="h-4 w-4" /> : <Banknote className="h-4 w-4" />}{request.source_type === "bill" ? "Buy Stock bill" : "Spend Money"}</span><p className="mt-1 text-xs text-slate-400">{new Date(request.requested_at).toLocaleDateString()}</p></td>
                  <td className="px-5 py-4"><p className="font-medium text-slate-900">{request.payee_name || "Internal request"}</p><p className="max-w-md truncate text-slate-500">{request.purpose}</p></td>
                  <td className="px-5 py-4 font-bold text-slate-900">{money.format(request.amount)}</td>
                  <td className="px-5 py-4"><StatusBadge status={request.status} /></td>
                  <td className="px-5 py-4"><div className="flex justify-end gap-2">
                    {request.status === "pending_approval" && <><button disabled={workingId === request.id || readOnly} onClick={() => setStatus(request, "approved")} className="rounded-lg bg-emerald-100 p-2 text-emerald-700 hover:bg-emerald-200" title="Approve"><Check className="h-4 w-4" /></button><button disabled={workingId === request.id || readOnly} onClick={() => setStatus(request, "rejected")} className="rounded-lg bg-rose-100 p-2 text-rose-700 hover:bg-rose-200" title="Reject"><X className="h-4 w-4" /></button></>}
                    {request.status === "approved" && <button disabled={workingId === request.id || readOnly} onClick={() => openReleaseDialog(request)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700">Release funds</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      : null}

      {activeTab === "cash-control" ? <section className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard label="Cash under management" value={money.format(cashUnderManagement)} hint={`${cashAccounts.length} cash, bank, wallet, and float accounts`} icon={Landmark} />
          <MetricCard label="Digital petty cash" value={money.format(pettyCashBalance)} hint="Posted petty cash and imprest balances" icon={Banknote} />
          <MetricCard label="Float alerts" value={String(lowFloatAccounts.length)} hint="Float accounts at zero or below" icon={AlertTriangle} />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cashAccounts.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No cash, bank, wallet, or float GL accounts were found.</p> : cashAccounts.map((account) => (
            <div key={account.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-900">{account.account_name}</p><p className="text-xs text-slate-500">{account.account_code} · {account.kind}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${account.balance > 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{account.balance > 0 ? "Funded" : "Review"}</span></div>
              <p className="mt-5 text-2xl font-bold text-slate-900">{money.format(account.balance)}</p>
              <p data-treasury-comment className="mt-1 text-xs text-slate-500">Balance from posted journal entries.</p>
            </div>
          ))}
        </div>
      </section> : null}

      {activeTab === "budgets" ? <section className="space-y-4">
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5"><h2 className="font-bold text-violet-950">Budget release controls</h2><p data-treasury-comment className="mt-1 text-sm text-violet-800">Approved Treasury requests are shown as committed funds before release. Detailed actual-versus-budget reporting remains in Accounting.</p></div>
        <div className="grid gap-4 md:grid-cols-2">
          {budgetControls.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No active budgets found. Create and activate budgets in Accounting.</p> : budgetControls.map((budget) => {
            const pct = budget.allocated > 0 ? (budget.committed / budget.allocated) * 100 : 0;
            return <div key={budget.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-900">{budget.name}</p><p className="text-xs text-slate-500">{budget.period_label || "Active budget"}</p></div><span className={`text-sm font-bold ${pct >= 85 ? "text-amber-700" : "text-emerald-700"}`}>{pct.toFixed(0)}% committed</span></div>
              <div className="mt-4"><Progress value={pct} warn={pct >= 85} /></div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm"><div><p className="text-xs text-slate-500">Allocated</p><p className="font-bold">{money.format(budget.allocated)}</p></div><div><p className="text-xs text-slate-500">Approved</p><p className="font-bold">{money.format(budget.committed)}</p></div><div><p className="text-xs text-slate-500">Uncommitted</p><p className="font-bold text-emerald-700">{money.format(budget.allocated - budget.committed)}</p></div></div>
            </div>;
          })}
        </div>
      </section> : null}

      {activeTab === "wallets" ? <section className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard label="Wallet liability" value={money.format(walletSummary.balance)} hint="Current customer and student wallet balances" icon={WalletCards} />
          <MetricCard label="Active wallets" value={String(walletSummary.active)} hint={`${walletSummary.count} total wallet records`} icon={Users} />
          <MetricCard label="Treasury use" value="Visibility" hint="Wallet operations remain in the Wallet module" icon={ShieldCheck} />
        </div>
        <div data-treasury-comment className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-sm text-indigo-900">
          <h2 className="font-bold">Wallet control note</h2>
          <p className="mt-1">BOAT’s current wallet model holds customer and student funds. It is shown here for Treasury liquidity visibility, but it is not available business cash and is not treated as a staff petty-cash wallet.</p>
        </div>
      </section> : null}

      {activeTab === "collections" ? <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-900">Recent incoming collections</h2><p data-treasury-comment className="text-sm text-slate-500">Completed POS and Billing receipts available for Treasury cash visibility.</p></div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Date</th><th className="px-5 py-3">Source</th><th className="px-5 py-3">Method</th><th className="px-5 py-3 text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {collections.length === 0 ? <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-500">No completed POS or Billing collections found.</td></tr> : collections.slice(0, 20).map((collection, index) => (
                <tr key={`${collection.paid_at}-${index}`}>
                  <td className="px-5 py-4 text-slate-600">{new Date(collection.paid_at).toLocaleString()}</td>
                  <td className="px-5 py-4 font-semibold text-slate-800">{collection.payment_source === "debtor" ? "Billing" : collection.payment_source?.startsWith("pos_") ? "POS" : collection.payment_source || "Collection"}</td>
                  <td className="px-5 py-4 capitalize text-slate-600">{(collection.payment_method || "unspecified").replace(/_/g, " ")}</td>
                  <td className="px-5 py-4 text-right font-bold text-emerald-700">{money.format(collection.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      : null}

      {releaseRequest && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => !workingId && setReleaseRequest(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Release funds</h2>
                <p className="mt-1 text-sm text-slate-500">{releaseRequest.payee_name || releaseRequest.purpose} · {money.format(releaseRequest.amount)}</p>
              </div>
              <button type="button" disabled={workingId === releaseRequest.id} onClick={() => setReleaseRequest(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-semibold text-slate-700">
                Payment method
                <select value={releasePaymentMethod} onChange={(event) => setReleasePaymentMethod(event.target.value as PaymentMethod)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal">
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="mobile_money">Mobile money</option>
                  <option value="wallet">Wallet</option>
                  <option value="card">Card</option>
                </select>
              </label>
              <label className="block text-sm font-semibold text-slate-700">
                Funding account
                <select value={releaseFundingAccountId} onChange={(event) => setReleaseFundingAccountId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal">
                  <option value="">Select cash, bank, or wallet account</option>
                  {fundingAccounts.map((account) => <option key={account.id} value={account.id}>{account.account_code} · {account.account_name}</option>)}
                </select>
              </label>
              {fundingAccounts.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">No cash, bank, mobile money, or wallet GL accounts were found. Add one in the chart of accounts before releasing funds.</p>}
              <label className="block text-sm font-semibold text-slate-700">
                Payment reference <span className="font-normal text-slate-400">(optional)</span>
                <input value={releaseReference} onChange={(event) => setReleaseReference(event.target.value)} placeholder="Cheque, transfer, or transaction reference" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" disabled={workingId === releaseRequest.id} onClick={() => setReleaseRequest(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
              <button type="button" disabled={workingId === releaseRequest.id || !releaseFundingAccountId} onClick={() => void disburse()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{workingId === releaseRequest.id ? "Releasing..." : "Release funds"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
