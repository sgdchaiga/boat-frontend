import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowLeftRight, ArrowUpRight, Banknote, Building2, Check, Clock3, Edit2, Eye, EyeOff, FileText, Landmark, LayoutDashboard, ListFilter, PackageCheck, Plus, ReceiptText, RefreshCw, Search, ShieldCheck, Users, WalletCards, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { supabase } from "@/lib/supabase";
import { createJournalEntry, createJournalForExpenseWithLines, createJournalForVendorPayment, reverseJournalEntriesByReference, type ExpenseJournalLineInput } from "@/lib/journal";
import { syncBillStatusInDb } from "@/lib/billStatus";
import { randomUuid } from "@/lib/randomUuid";
import { isCashEquivalentAccount } from "@/lib/cashFlowStatement";
import { normalizeGlAccountRows } from "@/lib/glAccountNormalize";
import { businessTodayISO } from "@/lib/timezone";
import { canApprove } from "@/lib/approvalRights";

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
type Collection = { amount: number; payment_source: string | null; paid_at: string; payment_method: string | null; transaction_id: string | null };
type VendorRef = { name: string | null } | { name: string | null }[] | null;
type Disbursement = {
  id: string;
  source: "vendor_payment" | "expense";
  date: string;
  payee: string | null;
  purpose: string;
  amount: number;
  payment_method: string | null;
  reference: string | null;
  status: string | null;
};
type TreasuryTab = "overview" | "cash-control" | "movements" | "end-of-day" | "approvals" | "disbursements" | "collections" | "history";
type PaymentMethod = "cash" | "bank_transfer" | "mobile_money" | "wallet" | "card";
type FundingAccount = { id: string; account_code: string; account_name: string; account_type: string; category: string | null; is_active: boolean };
type CashAccount = FundingAccount & { balance: number; kind: "Cash" | "Bank" | "Mobile / wallet" | "Float" };
type MoneyJournalLine = { gl_account_id: string; debit: number; credit: number; line_description: string | null; gl_accounts?: { account_code: string; account_name: string } | null };
type MoneyJournal = {
  id: string;
  transaction_id: string | null;
  entry_date: string;
  description: string;
  reference_type: string | null;
  journal_entry_lines?: MoneyJournalLine[];
};
type TransferForm = { fromAccountId: string; toAccountId: string; amount: string; date: string; reference: string; memo: string };
type CashAccountForm = { account_code: string; account_name: string; is_active: boolean };

const money = new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 });
const statusLabel: Record<Status, string> = {
  pending_approval: "Pending approval",
  approved: "Ready to disburse",
  rejected: "Rejected",
  disbursed: "Disbursed",
};

function localDatePart(value: string): string {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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

function methodLabel(value: string | null | undefined): string {
  return (value || "unspecified").replace(/_/g, " ");
}

function vendorName(value: VendorRef): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row?.name || null;
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

export function TreasuryPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const [requests, setRequests] = useState<TreasuryRequest[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [disbursements, setDisbursements] = useState<Disbursement[]>([]);
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
  const [moneyJournals, setMoneyJournals] = useState<MoneyJournal[]>([]);
  const [showComments, setShowComments] = useState(false);
  const [spendMoneyApprovalEnabled, setSpendMoneyApprovalEnabled] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [transferForm, setTransferForm] = useState<TransferForm>({
    fromAccountId: "",
    toAccountId: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    reference: "",
    memo: "",
  });
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const [editingCashAccount, setEditingCashAccount] = useState<CashAccount | null>(null);
  const [cashAccountForm, setCashAccountForm] = useState<CashAccountForm>({ account_code: "", account_name: "", is_active: true });
  const balanceAsOfDate = dateTo || businessTodayISO();
  const localAuthEnabled = ["true", "1", "yes"].includes((import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase());
  const canManageCashAccounts = !readOnly && (localAuthEnabled || canApprove("chart_of_accounts", user?.role));

  const fetchData = useCallback(async () => {
    if (!user?.organization_id) return;
    setLoading(true);
    const [requestRes, collectionRes, accountRes, workflowRes, initialVendorPaymentRes, expenseRes] = await Promise.all([
      supabase.from("treasury_requests").select("*").eq("organization_id", user.organization_id).order("requested_at", { ascending: false }),
      supabase.from("payments").select("amount,payment_source,paid_at,payment_method,transaction_id").eq("organization_id", user.organization_id).eq("payment_status", "completed").in("payment_source", ["pos_hotel", "pos_retail", "pos_clinic", "debtor"]).order("paid_at", { ascending: false }).limit(300),
      supabase.from("gl_accounts").select("id,account_code,account_name,account_type,category,is_active").eq("organization_id", user.organization_id).order("account_code"),
      supabase.from("organization_permissions").select("allowed").eq("organization_id", user.organization_id).eq("role_key", "__org__").eq("permission_key", "treasury_spend_money_approval_enabled").maybeSingle(),
      supabase.from("vendor_payments").select("id,amount,payment_date,payment_method,reference,status,vendors(name)").eq("organization_id", user.organization_id).order("payment_date", { ascending: false }).limit(300),
      supabase.from("expenses").select("id,amount,description,expense_date,status,vendors(name)").eq("organization_id", user.organization_id).order("expense_date", { ascending: false }).limit(300),
    ]);
    if (requestRes.error) console.error("Unable to load Treasury requests:", requestRes.error);
    if (collectionRes.error) console.error("Unable to load Treasury collections:", collectionRes.error);
    if (accountRes.error) console.error("Unable to load Treasury funding accounts:", accountRes.error);
    let vendorPaymentRes = initialVendorPaymentRes;
    if (vendorPaymentRes.error && vendorPaymentRes.error.message.toLowerCase().includes("status")) {
      vendorPaymentRes = await supabase.from("vendor_payments").select("id,amount,payment_date,payment_method,reference,vendors(name)").eq("organization_id", user.organization_id).order("payment_date", { ascending: false }).limit(300) as typeof initialVendorPaymentRes;
    }
    if (vendorPaymentRes.error) console.error("Unable to load Treasury supplier payments:", vendorPaymentRes.error);
    if (expenseRes.error) console.error("Unable to load Treasury expenses:", expenseRes.error);
    setRequests((requestRes.data || []) as TreasuryRequest[]);
    const loadedCollections = (collectionRes.data || []) as Collection[];
    const retailSaleIds = [...new Set(
      loadedCollections
        .filter((row) => row.payment_source === "pos_retail" && row.transaction_id)
        .map((row) => row.transaction_id!)
    )];
    const { data: activeRetailSales, error: activeRetailSalesError } = retailSaleIds.length
      ? await supabase
          .from("retail_sales")
          .select("id,sale_status")
          .eq("organization_id", user.organization_id)
          .in("id", retailSaleIds)
          .not("sale_status", "in", '("void","refunded")')
      : { data: [], error: null };
    if (activeRetailSalesError) console.error("Unable to validate Treasury retail POS collections:", activeRetailSalesError);
    const activeRetailSaleIds = new Set((activeRetailSales || []).map((sale) => sale.id));
    setCollections(loadedCollections.filter(
      (row) => row.payment_source !== "pos_retail" || (!!row.transaction_id && activeRetailSaleIds.has(row.transaction_id))
    ));
    setSpendMoneyApprovalEnabled(workflowRes.data?.allowed !== false);
    const allMoneyAccounts = normalizeGlAccountRows((accountRes.data || []) as unknown[])
      .filter(isCashEquivalentAccount)
      .map((account) => ({
        id: account.id,
        account_code: account.account_code,
        account_name: account.account_name,
        account_type: account.account_type,
        category: account.category,
        is_active: account.is_active !== false,
      }));
    const nextFundingAccounts = allMoneyAccounts.filter((account) => account.is_active);
    setFundingAccounts(nextFundingAccounts);
    const accountKindById = new Map(nextFundingAccounts.map((account) => {
      const label = `${account.account_code} ${account.account_name}`.toLowerCase();
      const kind: CashAccount["kind"] = /float/.test(label) ? "Float" : /(wallet|mobile money|momo|airtel|mtn)/.test(label) ? "Mobile / wallet" : /bank|current|checking|savings|stanbic|absa|centenary|dfcu|equity|kcb|barclays|standard chartered/.test(label) ? "Bank" : "Cash";
      return [account.id, kind] as const;
    }));
    const expenseRows = (expenseRes.data || []) as Array<{ id: string; amount: number | null; description: string | null; expense_date: string | null; status?: string | null; vendors: VendorRef }>;
    const expenseIds = expenseRows.map((expense) => expense.id);
    const expenseMethodById = new Map<string, string>();
    if (expenseIds.length > 0) {
      const { data: lineRows, error: lineError } = await supabase
        .from("expense_lines")
        .select("expense_id,source_cash_gl_account_id,sort_order")
        .in("expense_id", expenseIds);
      if (lineError) console.error("Unable to load Treasury expense funding accounts:", lineError);
      for (const row of [...(lineRows || [])].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))) {
        const line = row as { expense_id: string; source_cash_gl_account_id: string | null };
        if (expenseMethodById.has(line.expense_id)) continue;
        const kind = line.source_cash_gl_account_id ? accountKindById.get(line.source_cash_gl_account_id) : null;
        expenseMethodById.set(line.expense_id, kind === "Bank" ? "bank_transfer" : kind === "Mobile / wallet" ? "mobile_money" : kind === "Float" ? "cash" : "cash");
      }
    }
    const supplierPayments = ((vendorPaymentRes.data || []) as Array<{ id: string; amount: number | null; payment_date: string | null; payment_method: string | null; reference: string | null; status?: string | null; vendors: VendorRef }>)
      .filter((payment) => (payment.status || "active") !== "reversed")
      .map((payment): Disbursement => ({
        id: payment.id,
        source: "vendor_payment",
        date: payment.payment_date || balanceAsOfDate,
        payee: vendorName(payment.vendors),
        purpose: "Supplier payment",
        amount: Number(payment.amount || 0),
        payment_method: payment.payment_method || null,
        reference: payment.reference || null,
        status: payment.status || "active",
      }));
    const expenseDisbursements = expenseRows
      .filter((expense) => (expense.status || "active") !== "cancelled")
      .map((expense): Disbursement => ({
        id: expense.id,
        source: "expense",
        date: expense.expense_date || balanceAsOfDate,
        payee: vendorName(expense.vendors),
        purpose: expense.description || "Spend Money expense",
        amount: Number(expense.amount || 0),
        payment_method: expenseMethodById.get(expense.id) || null,
        reference: null,
        status: expense.status || "active",
      }));
    setDisbursements([...supplierPayments, ...expenseDisbursements].sort((a, b) => b.date.localeCompare(a.date)));
    if (allMoneyAccounts.length > 0) {
      const accountIds = allMoneyAccounts.map((account) => account.id);
      const [cashLinesRes, journalRes] = await Promise.all([
        supabase
          .from("journal_entry_lines")
          .select("gl_account_id,debit,credit,journal_entries!inner(organization_id,is_posted,is_deleted)")
          .in("gl_account_id", accountIds)
          .eq("journal_entries.organization_id", user.organization_id)
          .lte("journal_entries.entry_date", balanceAsOfDate)
          .eq("journal_entries.is_posted", true)
          .eq("journal_entries.is_deleted", false),
        supabase
          .from("journal_entries")
          .select("id,transaction_id,entry_date,description,reference_type,journal_entry_lines(gl_account_id,debit,credit,line_description,gl_accounts(account_code,account_name))")
          .eq("organization_id", user.organization_id)
          .lte("entry_date", balanceAsOfDate)
          .eq("is_posted", true)
          .eq("is_deleted", false)
          .order("entry_date", { ascending: false })
          .limit(150),
      ]);
      const { data: cashLines, error: cashLinesError } = cashLinesRes;
      if (cashLinesError) console.error("Unable to load Treasury cash balances:", cashLinesError);
      const balances = new Map<string, number>();
      for (const line of cashLines || []) {
        const row = line as { gl_account_id: string; debit: number; credit: number };
        balances.set(row.gl_account_id, (balances.get(row.gl_account_id) || 0) + Number(row.debit || 0) - Number(row.credit || 0));
      }
      setCashAccounts(allMoneyAccounts.map((account) => {
        const label = `${account.account_code} ${account.account_name}`.toLowerCase();
        const kind: CashAccount["kind"] = /float/.test(label) ? "Float" : /(wallet|mobile money|momo|airtel|mtn)/.test(label) ? "Mobile / wallet" : /bank|current|checking|savings|stanbic|absa|centenary|dfcu|equity|kcb|barclays|standard chartered/.test(label) ? "Bank" : "Cash";
        return { ...account, balance: balances.get(account.id) || 0, kind };
      }));
      if (journalRes.error) console.error("Unable to load Treasury money movements:", journalRes.error);
      const accountIdSet = new Set(accountIds);
      setMoneyJournals(((journalRes.data || []) as MoneyJournal[]).filter((journal) =>
        (journal.journal_entry_lines || []).some((line) => accountIdSet.has(line.gl_account_id))
      ));
    } else {
      setCashAccounts([]);
      setMoneyJournals([]);
    }
    setLoading(false);
  }, [balanceAsOfDate, user?.organization_id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!spendMoneyApprovalEnabled && activeTab === "approvals") setActiveTab("overview");
  }, [activeTab, spendMoneyApprovalEnabled]);

  const filteredCollections = useMemo(
    () => collections.filter((collection) => {
      const date = localDatePart(collection.paid_at);
      return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
    }),
    [collections, dateFrom, dateTo]
  );
  const filteredRequests = useMemo(
    () => requests.filter((request) => {
      const date = localDatePart(request.requested_at);
      return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
    }),
    [requests, dateFrom, dateTo]
  );
  const filteredDisbursements = useMemo(
    () => disbursements.filter((disbursement) => {
      const date = localDatePart(disbursement.date);
      return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
    }),
    [dateFrom, dateTo, disbursements]
  );

  const totals = useMemo(() => {
    const pending = filteredRequests.filter((r) => r.status === "pending_approval").reduce((s, r) => s + Number(r.amount), 0);
    const ready = filteredRequests.filter((r) => r.status === "approved").reduce((s, r) => s + Number(r.amount), 0);
    const pos = filteredCollections.filter((r) => r.payment_source?.startsWith("pos_")).reduce((s, r) => s + Number(r.amount), 0);
    const billing = filteredCollections.filter((r) => r.payment_source === "debtor").reduce((s, r) => s + Number(r.amount), 0);
    const disbursed = filteredDisbursements.reduce((s, r) => s + Number(r.amount), 0);
    const inflows = pos + billing;
    return { pending, ready, pos, billing, disbursed, inflows, projectedAvailable: inflows - ready };
  }, [filteredRequests, filteredCollections, filteredDisbursements]);

  const visibleRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    return filteredRequests.filter((request) => {
      if (sourceFilter !== "all" && request.source_type !== sourceFilter) return false;
      if (activeTab === "approvals" && request.status !== "pending_approval") return false;
      if (activeTab === "disbursements" && request.status !== "approved") return false;
      if (activeTab === "history" && !["disbursed", "rejected"].includes(request.status)) return false;
      if (!q) return true;
      return [request.payee_name, request.purpose, request.source_type, request.status]
        .some((value) => String(value || "").toLowerCase().includes(q));
    });
  }, [activeTab, filteredRequests, search, sourceFilter]);
  const visibleDisbursements = useMemo(() => {
    const q = search.trim().toLowerCase();
    return filteredDisbursements.filter((disbursement) => {
      if (sourceFilter === "expense" && disbursement.source !== "expense") return false;
      if (sourceFilter === "bill" && disbursement.source !== "vendor_payment") return false;
      if (!q) return true;
      return [disbursement.payee, disbursement.purpose, disbursement.source, disbursement.payment_method, disbursement.reference]
        .some((value) => String(value || "").toLowerCase().includes(q));
    });
  }, [filteredDisbursements, search, sourceFilter]);

  const spendMoneyRequests = filteredRequests.filter((request) => request.source_type === "expense");
  const buyStockRequests = filteredRequests.filter((request) => request.source_type === "bill");
  const cashUnderManagement = cashAccounts.reduce((sum, account) => sum + account.balance, 0);
  const activeCashAccounts = cashAccounts.filter((account) => account.is_active);
  const cashOnHandAccounts = cashAccounts.filter((account) => account.kind === "Cash");
  const nonPhysicalCashAccounts = cashAccounts.filter((account) => account.kind !== "Cash");
  const cashOnHandBalance = cashOnHandAccounts.reduce((sum, account) => sum + account.balance, 0);
  const pettyCashBalance = cashAccounts.filter((account) => /petty|imprest/i.test(account.account_name)).reduce((sum, account) => sum + account.balance, 0);
  const lowFloatAccounts = cashAccounts.filter((account) => account.kind === "Float" && account.balance <= 0);
  const walletSummary = { count: 0, balance: 0, active: 0 };
  const cashAccountIds = useMemo(() => new Set(cashAccounts.map((account) => account.id)), [cashAccounts]);
  const filteredMoneyJournals = useMemo(
    () => moneyJournals.filter((journal) => (!dateFrom || journal.entry_date >= dateFrom) && (!dateTo || journal.entry_date <= dateTo)),
    [dateFrom, dateTo, moneyJournals]
  );
  const journalMovementRows = useMemo(() => filteredMoneyJournals.map((journal) => {
    const moneyLines = (journal.journal_entry_lines || []).filter((line) => cashAccountIds.has(line.gl_account_id));
    const debit = moneyLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const credit = moneyLines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    const isTransfer = debit > 0 && credit > 0;
    return {
      ...journal,
      moneyLines,
      inflow: isTransfer ? 0 : debit,
      outflow: isTransfer ? 0 : credit,
      transfer: isTransfer ? Math.min(debit, credit) : 0,
    };
  }), [cashAccountIds, filteredMoneyJournals]);
  const movementTotals = useMemo(() => journalMovementRows.reduce(
    (sum, row) => ({
      inflow: sum.inflow + row.inflow,
      outflow: sum.outflow + row.outflow,
      transfer: sum.transfer + row.transfer,
    }),
    { inflow: 0, outflow: 0, transfer: 0 }
  ), [journalMovementRows]);
  const eodRows = useMemo(() => {
    const byMethod = new Map<string, { method: string; collections: number; disbursements: number }>();
    const ensure = (method: string) => {
      if (!byMethod.has(method)) byMethod.set(method, { method, collections: 0, disbursements: 0 });
      return byMethod.get(method)!;
    };
    for (const collection of filteredCollections) ensure(methodLabel(collection.payment_method)).collections += Number(collection.amount || 0);
    for (const disbursement of filteredDisbursements) ensure(methodLabel(disbursement.payment_method)).disbursements += Number(disbursement.amount || 0);
    return Array.from(byMethod.values()).sort((a, b) => a.method.localeCompare(b.method));
  }, [filteredCollections, filteredDisbursements]);
  const todayIso = new Date().toISOString().slice(0, 10);
  const todaysCollections = collections.filter((collection) => localDatePart(collection.paid_at) === todayIso).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const todaysDisbursements = disbursements.filter((disbursement) => localDatePart(disbursement.date) === todayIso).reduce((sum, row) => sum + Number(row.amount || 0), 0);

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

  const postFundTransfer = async () => {
    if (readOnly) return;
    const amount = Number(transferForm.amount);
    if (!transferForm.fromAccountId || !transferForm.toAccountId) {
      alert("Select both the source and destination accounts.");
      return;
    }
    if (transferForm.fromAccountId === transferForm.toAccountId) {
      alert("Choose two different accounts for a fund transfer.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Enter a transfer amount greater than zero.");
      return;
    }
    const fromAccount = cashAccounts.find((account) => account.id === transferForm.fromAccountId);
    const toAccount = cashAccounts.find((account) => account.id === transferForm.toAccountId);
    if (!fromAccount || !toAccount) {
      alert("One of the selected accounts could not be found.");
      return;
    }
    if (!fromAccount.is_active || !toAccount.is_active) {
      alert("Transfers can only use active Treasury accounts.");
      return;
    }
    if (amount > fromAccount.balance) {
      alert(`The source account only has ${money.format(fromAccount.balance)} available as of ${balanceAsOfDate}.`);
      return;
    }
    const transferId = randomUuid();
    setWorkingId("fund-transfer");
    try {
      const result = await createJournalEntry({
        entry_date: transferForm.date || todayIso,
        description: `Fund transfer: ${fromAccount.account_name} to ${toAccount.account_name}${transferForm.reference.trim() ? ` (${transferForm.reference.trim()})` : ""}`,
        reference_type: "manual",
        reference_id: transferId,
        created_by: user?.id ?? null,
        organizationId: user?.organization_id ?? null,
        lines: [
          {
            gl_account_id: toAccount.id,
            debit: amount,
            credit: 0,
            line_description: transferForm.memo.trim() || `Transfer in from ${fromAccount.account_name}`,
          },
          {
            gl_account_id: fromAccount.id,
            debit: 0,
            credit: amount,
            line_description: transferForm.memo.trim() || `Transfer out to ${toAccount.account_name}`,
          },
        ],
      });
      if (!result.ok) throw new Error(result.error);
      setTransferForm({
        fromAccountId: "",
        toAccountId: "",
        amount: "",
        date: todayIso,
        reference: "",
        memo: "",
      });
      await fetchData();
      setActiveTab("movements");
    } catch (error) {
      alert(`Fund transfer failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    setWorkingId(null);
  };

  const openCashAccountForm = (account?: CashAccount) => {
    setEditingCashAccount(account || null);
    setCashAccountForm(account
      ? { account_code: account.account_code, account_name: account.account_name, is_active: account.is_active }
      : { account_code: "", account_name: "", is_active: true });
    setAccountFormOpen(true);
  };

  const saveCashAccount = async () => {
    if (!canManageCashAccounts || !user?.organization_id) return;
    const accountCode = cashAccountForm.account_code.trim();
    const accountName = cashAccountForm.account_name.trim();
    if (!accountCode || !accountName) {
      alert("Enter an account code and account name.");
      return;
    }
    setWorkingId("cash-account");
    const payload = {
      account_code: accountCode,
      account_name: accountName,
      account_type: "asset",
      category: "cash",
      is_active: cashAccountForm.is_active,
    };
    try {
      const { error } = editingCashAccount
        ? await supabase.from("gl_accounts").update(payload).eq("id", editingCashAccount.id).eq("organization_id", user.organization_id)
        : await supabase.from("gl_accounts").insert({ ...payload, organization_id: user.organization_id });
      if (error) throw error;
      setAccountFormOpen(false);
      setEditingCashAccount(null);
      await fetchData();
    } catch (error) {
      alert(`Cash account could not be saved: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setWorkingId(null);
    }
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
          <div><h1 className="text-3xl font-bold tracking-tight">View and control all money movement.</h1><p data-treasury-comment className="mt-2 text-sm text-slate-300">Cash, bank, mobile money, float balances, fund transfers, collections, supplier releases, and daily balancing in one workspace.</p></div>
          <div className="flex flex-wrap items-end gap-3"><div className="rounded-xl bg-white/10 px-4 py-2"><p className="text-[10px] uppercase tracking-wide text-slate-300">Funds under management as of {balanceAsOfDate}</p><p className="font-bold">{money.format(cashUnderManagement)}</p></div><button type="button" onClick={() => setActiveTab("movements")} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-400"><ArrowLeftRight className="h-4 w-4" /> Move funds</button><button type="button" onClick={() => setShowComments((current) => !current)} title={showComments ? "Hide comments" : "Show comments"} aria-label={showComments ? "Hide Treasury comments" : "Show Treasury comments"} className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20">{showComments ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button><button onClick={fetchData} className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"><RefreshCw className="h-4 w-4" /> Refresh</button></div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {([
          ["overview", "Overview", LayoutDashboard],
          ["cash-control", "Accounts", Landmark],
          ["movements", "Fund movements", ArrowLeftRight],
          ["end-of-day", "End of day", ReceiptText],
          ...(spendMoneyApprovalEnabled ? [["approvals", "Spend Money approvals", ShieldCheck] as const] : []),
          ["disbursements", "Supplier payments", Banknote],
          ["collections", "Incoming funds", ArrowDownRight],
          ["history", "History", Clock3],
        ] as Array<[TreasuryTab, string, typeof Banknote]>).map(([tab, label, Icon]) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ${activeTab === tab ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="mr-auto">
          <p className="text-sm font-bold text-slate-900">Date filter</p>
          <p data-treasury-comment className="text-xs text-slate-500">Filters Treasury requests, forecasts, and incoming collections. Cash balances remain current.</p>
        </div>
        <label className="text-xs font-semibold text-slate-600">From<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800" /></label>
        <label className="text-xs font-semibold text-slate-600">To<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800" /></label>
        <button type="button" onClick={() => { setDateFrom(""); setDateTo(""); }} disabled={!dateFrom && !dateTo} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Clear dates</button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Cash inflows captured" value={money.format(totals.inflows)} hint="POS and billing collections" icon={WalletCards} />
        {spendMoneyApprovalEnabled && <MetricCard label="Pending approvals" value={money.format(totals.pending)} hint="Spend Money requests awaiting review" icon={ShieldCheck} />}
        <MetricCard label="Ready to release" value={money.format(totals.ready)} hint="Approved expenses and Buy Stock bills" icon={Banknote} />
        <MetricCard label="Money moved" value={money.format(movementTotals.transfer)} hint="Transfers between cash, bank, mobile money, and float" icon={ArrowLeftRight} />
      </div>

      {activeTab === "overview" ? (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            {spendMoneyApprovalEnabled && <button type="button" onClick={() => { setActiveTab("approvals"); setSourceFilter("expense"); }} className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 text-left shadow-sm hover:border-amber-300">
              <div className="flex items-center justify-between"><span className="rounded-xl bg-amber-100 p-3 text-amber-700"><FileText className="h-5 w-5" /></span><span className="text-2xl font-bold text-slate-900">{spendMoneyRequests.filter((r) => r.status === "pending_approval").length}</span></div>
              <h3 className="mt-4 font-bold text-slate-900">Spend Money approvals</h3><p data-treasury-comment className="mt-1 text-sm text-slate-500">Review expenses received directly from Spend Money before funds are released.</p>
            </button>}
            <button type="button" onClick={() => { setActiveTab("disbursements"); setSourceFilter("all"); }} className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 text-left shadow-sm hover:border-blue-300">
              <div className="flex items-center justify-between"><span className="rounded-xl bg-blue-100 p-3 text-blue-700"><PackageCheck className="h-5 w-5" /></span><span className="text-2xl font-bold text-slate-900">{buyStockRequests.filter((r) => r.status === "approved").length}</span></div>
              <h3 className="mt-4 font-bold text-slate-900">Payments and expenses</h3><p data-treasury-comment className="mt-1 text-sm text-slate-500">Review actual supplier payments and Spend Money cash-outs.</p>
            </button>
            <button type="button" onClick={() => setActiveTab("collections")} className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 text-left shadow-sm hover:border-emerald-300">
              <div className="flex items-center justify-between"><span className="rounded-xl bg-emerald-100 p-3 text-emerald-700"><Landmark className="h-5 w-5" /></span><span className="text-2xl font-bold text-slate-900">{filteredCollections.length}</span></div>
              <h3 className="mt-4 font-bold text-slate-900">Incoming collections</h3><p data-treasury-comment className="mt-1 text-sm text-slate-500">Monitor completed POS and billing receipts available to Treasury.</p>
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <button type="button" onClick={() => setActiveTab("cash-control")} className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-slate-400">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Funds under management</p><p className="mt-2 text-2xl font-bold text-slate-900">{money.format(cashUnderManagement)}</p><p data-treasury-comment className="mt-1 text-sm text-slate-500">The posted Balance Sheet total for Treasury cash and cash-equivalent accounts as of {balanceAsOfDate}.</p>
            </button>
            <button type="button" onClick={() => setActiveTab("movements")} className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5 text-left shadow-sm hover:border-cyan-400">
              <p className="text-xs font-bold uppercase tracking-wide text-cyan-700">Fund movements</p><p className="mt-2 text-2xl font-bold text-slate-900">{money.format(movementTotals.transfer)}</p><p data-treasury-comment className="mt-1 text-sm text-slate-500">Posted transfers between money accounts in the selected period.</p>
            </button>
            <button type="button" onClick={() => setActiveTab("end-of-day")} className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-left shadow-sm hover:border-indigo-400">
              <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">End of day balancing</p><p className="mt-2 text-2xl font-bold text-slate-900">{money.format(todaysCollections - todaysDisbursements)}</p><p data-treasury-comment className="mt-1 text-sm text-slate-500">Today: collections less disbursements.</p>
            </button>
          </div>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">Money position summary</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-emerald-50 p-4"><p className="text-xs font-semibold uppercase text-emerald-700">Collections</p><p className="mt-2 text-xl font-bold">{money.format(totals.inflows)}</p></div>
              <div className="rounded-xl bg-amber-50 p-4"><p className="text-xs font-semibold uppercase text-amber-700">Awaiting approval</p><p className="mt-2 text-xl font-bold">{money.format(totals.pending)}</p></div>
              <div className="rounded-xl bg-blue-50 p-4"><p className="text-xs font-semibold uppercase text-blue-700">Approved outflow</p><p className="mt-2 text-xl font-bold">{money.format(totals.ready)}</p></div>
              <div className="rounded-xl bg-slate-100 p-4"><p className="text-xs font-semibold uppercase text-slate-600">Cash on hand as of {balanceAsOfDate}</p><p className="mt-2 text-xl font-bold">{money.format(cashOnHandBalance)}</p></div>
            </div>
            {lowFloatAccounts.length > 0 && <div className="mt-4 grid gap-2 md:grid-cols-2">
              {lowFloatAccounts.map((account) => <div key={account.id} className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle className="h-5 w-5 shrink-0" /><span><strong>{account.account_name}</strong> has a zero or negative posted balance.</span></div>)}
            </div>}
          </section>
        </>
      ) : null}

      {["approvals", "history"].includes(activeTab) ? <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h2 className="font-bold text-slate-900">{activeTab === "approvals" ? "Spend Money approval queue" : "Treasury request history"}</h2><p data-treasury-comment className="text-sm text-slate-500">Spend Money entries arrive for approval; approved Buy Stock bills arrive ready for payment.</p></div>
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

      {activeTab === "disbursements" ? <section className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h2 className="font-bold text-slate-900">Ready to release</h2><p data-treasury-comment className="text-sm text-slate-500">Approved Treasury requests that still need a funding account and payment reference.</p></div>
            <div className="flex flex-wrap gap-2">
              <label className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search requests" className="rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" /></label>
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm text-slate-600"><ListFilter className="h-4 w-4" /><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)} className="bg-transparent py-2 outline-none"><option value="all">All sources</option><option value="expense">Spend Money</option><option value="bill">Buy Stock</option></select></label>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Source</th><th className="px-5 py-3">Payee / purpose</th><th className="px-5 py-3">Amount</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Actions</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">Loading Treasury...</td></tr> : visibleRequests.length === 0 ? <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">No approved requests waiting for release.</td></tr> : visibleRequests.map((request) => (
                  <tr key={request.id}>
                    <td className="px-5 py-4"><span className="inline-flex items-center gap-2 font-semibold text-slate-700">{request.source_type === "bill" ? <Building2 className="h-4 w-4" /> : <Banknote className="h-4 w-4" />}{request.source_type === "bill" ? "Buy Stock bill" : "Spend Money"}</span><p className="mt-1 text-xs text-slate-400">{new Date(request.requested_at).toLocaleDateString()}</p></td>
                    <td className="px-5 py-4"><p className="font-medium text-slate-900">{request.payee_name || "Internal request"}</p><p className="max-w-md truncate text-slate-500">{request.purpose}</p></td>
                    <td className="px-5 py-4 font-bold text-slate-900">{money.format(request.amount)}</td>
                    <td className="px-5 py-4"><StatusBadge status={request.status} /></td>
                    <td className="px-5 py-4"><div className="flex justify-end gap-2">
                      <button disabled={workingId === request.id || readOnly} onClick={() => openReleaseDialog(request)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700">Release funds</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-900">Payments and expenses register</h2><p data-treasury-comment className="text-sm text-slate-500">All active supplier payments and Spend Money expenses for the selected dates.</p></div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Date</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Payee / purpose</th><th className="px-5 py-3">Method</th><th className="px-5 py-3 text-right">Amount</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {visibleDisbursements.length === 0 ? <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">No payments or expenses found for the selected dates.</td></tr> : visibleDisbursements.slice(0, 80).map((disbursement) => (
                  <tr key={`${disbursement.source}-${disbursement.id}`}>
                    <td className="px-5 py-4 text-slate-600">{new Date(`${disbursement.date}T12:00:00`).toLocaleDateString()}</td>
                    <td className="px-5 py-4 font-semibold text-slate-800">{disbursement.source === "vendor_payment" ? "Supplier payment" : "Spend Money"}</td>
                    <td className="px-5 py-4"><p className="font-medium text-slate-900">{disbursement.payee || "Internal"}</p><p className="max-w-md truncate text-slate-500">{disbursement.purpose}{disbursement.reference ? ` - ${disbursement.reference}` : ""}</p></td>
                    <td className="px-5 py-4 capitalize text-slate-600">{methodLabel(disbursement.payment_method)}</td>
                    <td className="px-5 py-4 text-right font-bold text-rose-700">{money.format(disbursement.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section> : null}

      {activeTab === "cash-control" ? <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div><h2 className="font-bold text-slate-900">Treasury accounts</h2><p className="text-sm text-slate-500">Manage the asset accounts included in funds under management and on the Balance Sheet.</p></div>
          {canManageCashAccounts && <button type="button" onClick={() => openCashAccountForm()} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white"><Plus className="h-4 w-4" /> Add cash account</button>}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard label="Cash on hand" value={money.format(cashOnHandBalance)} hint={`${cashOnHandAccounts.length} physical cash GL account${cashOnHandAccounts.length === 1 ? "" : "s"} as of ${balanceAsOfDate}`} icon={Banknote} />
          <MetricCard label="Funds under management" value={money.format(cashUnderManagement)} hint={`${cashAccounts.length} Balance Sheet cash and cash-equivalent accounts as of ${balanceAsOfDate}`} icon={Landmark} />
          <MetricCard label="Digital petty cash" value={money.format(pettyCashBalance)} hint="Posted petty cash and imprest balances" icon={Banknote} />
        </div>
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="font-bold text-slate-900">Cash on hand drilldown</h2>
              <p data-treasury-comment className="text-sm text-slate-500">Reconcile these physical-cash GL rows to the same account rows on the Balance Sheet as of {balanceAsOfDate}.</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase text-slate-500">Drilldown total</p>
              <p className="text-lg font-bold text-slate-900">{money.format(cashOnHandBalance)}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Balance Sheet account</th><th className="px-5 py-3">Class</th><th className="px-5 py-3 text-right">Posted balance</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {cashOnHandAccounts.length === 0 ? <tr><td colSpan={3} className="px-5 py-8 text-center text-slate-500">No physical cash GL accounts matched the Treasury cash-on-hand rules.</td></tr> : cashOnHandAccounts.map((account) => (
                  <tr key={account.id}>
                    <td className="px-5 py-4"><p className="font-semibold text-slate-900">{account.account_code} - {account.account_name}</p><p className="text-xs text-slate-500">Included in Treasury cash on hand and Balance Sheet assets</p></td>
                    <td className="px-5 py-4 text-slate-600">{account.kind}</td>
                    <td className="px-5 py-4 text-right font-bold text-slate-900">{money.format(account.balance)}</td>
                  </tr>
                ))}
              </tbody>
              {cashOnHandAccounts.length > 0 && <tfoot><tr className="bg-slate-50 font-bold"><td colSpan={2} className="px-5 py-3 text-right">Cash on hand total</td><td className="px-5 py-3 text-right">{money.format(cashOnHandBalance)}</td></tr></tfoot>}
            </table>
          </div>
          {nonPhysicalCashAccounts.length > 0 && <div className="border-t border-slate-100 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cash equivalents excluded from cash on hand</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {nonPhysicalCashAccounts.map((account) => (
                <div key={account.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-slate-700">{account.account_code} - {account.account_name} <span className="text-slate-400">({account.kind})</span></span>
                  <span className="shrink-0 font-semibold text-slate-900">{money.format(account.balance)}</span>
                </div>
              ))}
            </div>
          </div>}
        </section>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cashAccounts.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No cash, bank, mobile money, or float GL accounts were found.</p> : cashAccounts.map((account) => (
            <div key={account.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-900">{account.account_name}</p><p className="text-xs text-slate-500">{account.account_code} · {account.kind}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${account.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{account.is_active ? "Active" : "Inactive"}</span></div>
              <p className="mt-5 text-2xl font-bold text-slate-900">{money.format(account.balance)}</p>
              <div className="mt-2 flex items-center justify-between gap-2"><p data-treasury-comment className="text-xs text-slate-500">Balance from posted journal entries.</p>{canManageCashAccounts && <button type="button" onClick={() => openCashAccountForm(account)} className="inline-flex items-center gap-1 text-xs font-bold text-blue-700"><Edit2 className="h-3.5 w-3.5" /> Edit</button>}</div>
            </div>
          ))}
        </div>
      </section> : null}

      {activeTab === "movements" ? <section className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="font-bold text-slate-900">Money movement ledger</h2>
              <p data-treasury-comment className="text-sm text-slate-500">Posted journals touching active cash-equivalent GL accounts through {balanceAsOfDate}.</p>
            </div>
            <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3">
              <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs font-bold uppercase text-emerald-700">Inflow</p><p className="mt-1 text-lg font-bold">{money.format(movementTotals.inflow)}</p></div>
              <div className="rounded-xl bg-rose-50 p-3"><p className="text-xs font-bold uppercase text-rose-700">Outflow</p><p className="mt-1 text-lg font-bold">{money.format(movementTotals.outflow)}</p></div>
              <div className="rounded-xl bg-cyan-50 p-3"><p className="text-xs font-bold uppercase text-cyan-700">Transfers</p><p className="mt-1 text-lg font-bold">{money.format(movementTotals.transfer)}</p></div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Date</th><th className="px-5 py-3">Movement</th><th className="px-5 py-3">Accounts touched</th><th className="px-5 py-3 text-right">Amount</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {journalMovementRows.length === 0 ? <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-500">No posted money movement found for the selected dates.</td></tr> : journalMovementRows.slice(0, 60).map((journal) => {
                    const tone = journal.transfer > 0 ? "text-cyan-700" : journal.inflow > 0 ? "text-emerald-700" : "text-rose-700";
                    const label = journal.transfer > 0 ? "Transfer" : journal.inflow > 0 ? "Inflow" : "Outflow";
                    const amount = journal.transfer || journal.inflow || journal.outflow;
                    return (
                      <tr key={journal.id}>
                        <td className="px-5 py-4 text-slate-600">{journal.entry_date}</td>
                        <td className="px-5 py-4"><p className="font-semibold text-slate-900">{journal.description}</p><p className="text-xs text-slate-500">{journal.transaction_id || journal.reference_type || "Journal"}</p></td>
                        <td className="px-5 py-4 text-slate-600">{journal.moneyLines.map((line) => line.gl_accounts?.account_name || line.gl_account_id).join(", ")}</td>
                        <td className={`px-5 py-4 text-right font-bold ${tone}`}>{label}: {money.format(amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-2xl border border-cyan-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">Move funds between accounts</h2>
            <p data-treasury-comment className="mt-1 text-sm text-slate-500">Posts a balanced manual journal: debit destination account, credit source account.</p>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-semibold text-slate-700">From account<select value={transferForm.fromAccountId} onChange={(event) => setTransferForm((form) => ({ ...form, fromAccountId: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal"><option value="">Select source</option>{activeCashAccounts.map((account) => <option key={account.id} value={account.id}>{account.account_code} - {account.account_name} ({money.format(account.balance)})</option>)}</select></label>
              <label className="block text-sm font-semibold text-slate-700">To account<select value={transferForm.toAccountId} onChange={(event) => setTransferForm((form) => ({ ...form, toAccountId: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal"><option value="">Select destination</option>{activeCashAccounts.map((account) => <option key={account.id} value={account.id}>{account.account_code} - {account.account_name}</option>)}</select></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-semibold text-slate-700">Amount<input type="number" min="0" step="0.01" value={transferForm.amount} onChange={(event) => setTransferForm((form) => ({ ...form, amount: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
                <label className="block text-sm font-semibold text-slate-700">Date<input type="date" value={transferForm.date} onChange={(event) => setTransferForm((form) => ({ ...form, date: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
              </div>
              <label className="block text-sm font-semibold text-slate-700">Reference<input value={transferForm.reference} onChange={(event) => setTransferForm((form) => ({ ...form, reference: event.target.value }))} placeholder="Slip, cheque, mobile money ref" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
              <label className="block text-sm font-semibold text-slate-700">Memo<input value={transferForm.memo} onChange={(event) => setTransferForm((form) => ({ ...form, memo: event.target.value }))} placeholder="Why funds are moving" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
              <button type="button" disabled={readOnly || workingId === "fund-transfer"} onClick={() => void postFundTransfer()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"><ArrowLeftRight className="h-4 w-4" />{workingId === "fund-transfer" ? "Posting transfer..." : "Post fund transfer"}</button>
            </div>
          </div>
        </div>
      </section> : null}

      {activeTab === "end-of-day" ? <section className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard label="Selected collections" value={money.format(totals.inflows)} hint="Completed POS and billing receipts" icon={ArrowDownRight} />
          <MetricCard label="Selected disbursements" value={money.format(totals.disbursed)} hint="Supplier payments and Spend Money expenses" icon={ArrowUpRight} />
          <MetricCard label="Net expected cash movement" value={money.format(totals.inflows - totals.disbursed)} hint="Collections less payments and expenses for the selected dates" icon={ReceiptText} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-900">End-of-day by method</h2><p data-treasury-comment className="text-sm text-slate-500">Compare expected cash, bank transfer, mobile money, card, and wallet totals against actual till and statements.</p></div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Method</th><th className="px-5 py-3 text-right">Collections</th><th className="px-5 py-3 text-right">Disbursements</th><th className="px-5 py-3 text-right">Expected net</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {eodRows.length === 0 ? <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-500">No end-of-day activity for the selected dates.</td></tr> : eodRows.map((row) => (
                    <tr key={row.method}>
                      <td className="px-5 py-4 font-semibold capitalize text-slate-800">{row.method}</td>
                      <td className="px-5 py-4 text-right font-bold text-emerald-700">{money.format(row.collections)}</td>
                      <td className="px-5 py-4 text-right font-bold text-rose-700">{money.format(row.disbursements)}</td>
                      <td className="px-5 py-4 text-right font-bold text-slate-900">{money.format(row.collections - row.disbursements)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-900">Account balances to count</h2><p data-treasury-comment className="text-sm text-slate-500">Current posted balances by money account. Count cash/float and compare statements for bank and mobile money.</p></div>
            <div className="divide-y divide-slate-100">
              {cashAccounts.length === 0 ? <p className="p-6 text-sm text-slate-500">No money accounts found.</p> : cashAccounts.map((account) => (
                <div key={account.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div><p className="font-semibold text-slate-900">{account.account_name}</p><p className="text-xs text-slate-500">{account.account_code} - {account.kind}</p></div>
                  <p className="font-bold text-slate-900">{money.format(account.balance)}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section> : null}

      {false ? null : null}
      {false ? <section className="space-y-4">
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
              {filteredCollections.length === 0 ? <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-500">No completed POS or Billing collections found for the selected dates.</td></tr> : filteredCollections.slice(0, 20).map((collection, index) => (
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

      {accountFormOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => workingId !== "cash-account" && setAccountFormOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-slate-900">{editingCashAccount ? "Edit Treasury account" : "Add Treasury account"}</h2><p className="mt-1 text-sm text-slate-500">Saved as a cash-category asset so the account appears in Treasury and the Balance Sheet.</p></div><button type="button" disabled={workingId === "cash-account"} onClick={() => setAccountFormOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-semibold text-slate-700">Account code<input value={cashAccountForm.account_code} onChange={(event) => setCashAccountForm((form) => ({ ...form, account_code: event.target.value }))} placeholder="e.g. 1010" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
              <label className="block text-sm font-semibold text-slate-700">Account name<input value={cashAccountForm.account_name} onChange={(event) => setCashAccountForm((form) => ({ ...form, account_name: event.target.value }))} placeholder="e.g. Stanbic operating account" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={cashAccountForm.is_active} onChange={(event) => setCashAccountForm((form) => ({ ...form, is_active: event.target.checked }))} /> Active for new transfers and payments</label>
              {!cashAccountForm.is_active && <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">An inactive account remains in funds under management while it has a posted Balance Sheet balance, but it cannot be used for new transactions.</p>}
            </div>
            <div className="mt-6 flex justify-end gap-2"><button type="button" disabled={workingId === "cash-account"} onClick={() => setAccountFormOpen(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button><button type="button" disabled={workingId === "cash-account" || !cashAccountForm.account_code.trim() || !cashAccountForm.account_name.trim()} onClick={() => void saveCashAccount()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{workingId === "cash-account" ? "Saving..." : "Save account"}</button></div>
          </div>
        </div>
      )}

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
