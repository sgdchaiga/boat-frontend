import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, Ban, BookOpen, CheckCircle2, Download, FileSpreadsheet, FileText, PackagePlus, Palette, Pencil, Plus, Printer, RefreshCw, Search, ShoppingCart, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { paymentReceivedCustomerLabel, type PaymentWithCustomer } from "@/lib/billingShared";
import { useGeneralBusinessMode } from "@/lib/generalBusinessMode";
import { supabase } from "@/lib/supabase";
import { isGlAccountRelevantForBusinessType } from "@/lib/glAccountBusinessScope";
import { GlAccountPicker } from "@/components/common/GlAccountPicker";
import { downloadCsv, downloadXlsx, exportAccountingPdf } from "@/lib/accountingReportExport";
import { createJournalForBill, createJournalForVendorPayment, deleteJournalEntryByReference, getDefaultGlAccounts } from "@/lib/journal";
import { postStockInFromPurchaseOrderForBill } from "@/lib/poGrnStock";
import { syncBillStatusInDb } from "@/lib/billStatus";
import { randomUuid } from "@/lib/randomUuid";
import { processSaleOnline } from "@/components/retail-pos/services/processSaleOnline";
import { SCHOOL_PAGE } from "@/lib/schoolPages";

type CashbookDirection = "in" | "out";

type CashbookRow = {
  id: string;
  source: "cashbook_entry" | "receipt" | "supplier_payment" | "expense" | "school_fee" | "mf_repayment" | "mf_disbursement" | "mf_recovery" | "modern_gl";
  date: string;
  description: string;
  party: string;
  method: string;
  reference: string;
  cashIn: number;
  cashOut: number;
  status: string;
  headquarters?: string;
  glAccount?: string;
  postedAt?: string;
  submittedBy?: string;
  comments?: string;
  rawId?: string;
  createdBy?: string | null;
  approvalStatus?: string;
};

type VendorRef = { name: string | null } | { name: string | null }[] | null;
type EntryType = "money_in" | "money_out" | "sale" | "purchase" | "transfer";
type DraftEntry = { type: EntryType; date: string; party: string; project: string; description: string; method: string; amount: string; reference: string; productId: string; productName: string; quantity: string; unitCost: string };
type GlPosition = { opening: number; movement: number; closing: number };
type ChannelPosition = { channel: string; opening: number; movement: number; closing: number };
type QueuedDraft = DraftEntry & { id: string; queuedAt: string };
type GlOption = { id: string; account_code: string; account_name: string; account_type: string; category: string | null };
type MasterOption = { id: string; name: string; code?: string };
type InventoryProductOption = { id: string; name: string; cost_price: number | null; sales_price: number | null; unit_of_measure: string | null; department_id: string | null; track_inventory: boolean | null };
type SheetEntry = { transactionDate: string; headquarters: string; paymentMethod: string; description: string; comments: string; supplier: string; customer: string; counterpartGlId: string; cashGlId: string; cashIn: string; cashOut: string; reference: string };
type CashbookSettings = { show_helper_text: boolean; helper_text: string; show_page_description: boolean; page_description: string; primary_color: string; accent_color: string; button_radius: number };

const DEFAULT_CASHBOOK_SETTINGS: CashbookSettings = {
  show_helper_text: false,
  helper_text: "Matches the Google Sheet register and posts a balanced journal immediately.",
  show_page_description: false,
  page_description: "Record cash, mobile money and bank transactions in a focused AppSheet-style form.",
  primary_color: "#0f766e",
  accent_color: "#14b8a6",
  button_radius: 10,
};

const money = new Intl.NumberFormat("en-UG", {
  style: "currency",
  currency: "UGX",
  maximumFractionDigits: 0,
});

function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function monthStartISO(): string {
  const today = todayISO();
  return `${today.slice(0, 8)}01`;
}

function localDatePart(value: string | null | undefined): string {
  if (!value) return "";
  return value.length >= 10 ? value.slice(0, 10) : value;
}

function vendorName(value: VendorRef): string {
  const row = Array.isArray(value) ? value[0] : value;
  return row?.name?.trim() || "—";
}

function readable(value: string | null | undefined): string {
  return (value || "Unspecified").replaceAll("_", " ");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error || "Unknown error");
}

function receiptDescription(payment: PaymentWithCustomer): string {
  if (payment.payment_source === "debtor") return "Customer receipt";
  if (payment.payment_source === "pos_retail") return "Retail sale receipt";
  if (payment.payment_source === "pos_hotel") return "Hotel/POS receipt";
  if (payment.payment_source === "pos_clinic") return "Clinic/POS receipt";
  return "Money received";
}

type CashbookView = "register" | "entry" | "daily";

type CashbookRouteSet = { dashboard: string; register: string; entry: string; daily: string };
const GENERAL_BUSINESS_ROUTES: CashbookRouteSet = { dashboard: "general_business_dashboard", register: "general_business_cashbook", entry: "general_business_cashbook_entry", daily: "general_business_daily_summary" };

export function GeneralBusinessCashbookPage({ onNavigate, view = "register", workspaceLabel = "General Business", routes = GENERAL_BUSINESS_ROUTES }: {
  onNavigate: (page: string, state?: Record<string, unknown>) => void;
  view?: CashbookView;
  workspaceLabel?: string;
  routes?: CashbookRouteSet;
}) {
  const { user } = useAuth();
  const { mode, setMode } = useGeneralBusinessMode(user?.id, user?.organization_id);
  const orgId = user?.organization_id ?? null;
  const [rows, setRows] = useState<CashbookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(monthStartISO);
  const [dateTo, setDateTo] = useState(todayISO);
  const [direction, setDirection] = useState<"all" | CashbookDirection>("all");
  const [search, setSearch] = useState("");
  const [rowLimit, setRowLimit] = useState(2000);
  const [summaryDate, setSummaryDate] = useState(todayISO);
  const [entryOpen, setEntryOpen] = useState(false);
  const [draft, setDraft] = useState<DraftEntry>(() => ({ type: "money_in", date: todayISO(), party: "", project: "", description: "", method: "cash", amount: "", reference: "", productId: "", productName: "", quantity: "", unitCost: "" }));
  const [draftError, setDraftError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [glPosition, setGlPosition] = useState<GlPosition | null>(null);
  const [channelPositions, setChannelPositions] = useState<ChannelPosition[]>([]);
  const [glOptions, setGlOptions] = useState<GlOption[]>([]);
  const [sheetEntry, setSheetEntry] = useState<SheetEntry>(() => ({ transactionDate: todayISO(), headquarters: "", paymentMethod: "cash", description: "", comments: "", supplier: "", customer: "", counterpartGlId: "", cashGlId: "", cashIn: "", cashOut: "", reference: "" }));
  const [postingEntry, setPostingEntry] = useState(false);
  const [postingQuickTransaction, setPostingQuickTransaction] = useState(false);
  const [entryMessage, setEntryMessage] = useState<string | null>(null);
  const [projects, setProjects] = useState<MasterOption[]>([]);
  const [suppliers, setSuppliers] = useState<MasterOption[]>([]);
  const [customers, setCustomers] = useState<MasterOption[]>([]);
  const [inventoryProducts, setInventoryProducts] = useState<InventoryProductOption[]>([]);
  const commentsPreferenceKey = `boat.cashbook.comments.${orgId || "no-org"}.${user?.id || "anonymous"}`;
  const [showComments, setShowComments] = useState(true);
  const [cashbookSettings, setCashbookSettings] = useState<CashbookSettings>(DEFAULT_CASHBOOK_SETTINGS);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [appearanceMessage, setAppearanceMessage] = useState<string | null>(null);
  const draftStorageKey = `boat.cashbook.draft.${orgId || "no-org"}.${user?.id || "anonymous"}`;
  const queueStorageKey = `boat.cashbook.queue.${orgId || "no-org"}.${user?.id || "anonymous"}`;
  const [queuedDrafts, setQueuedDrafts] = useState<QueuedDraft[]>(() => []);
  const roleKey = String(user?.role || "").trim().toLowerCase();
  const canCustomizeAppearance = Boolean(user?.isSuperAdmin || ["admin", "super_admin"].includes(roleKey));
  const canEditHelperText = Boolean(user?.isSuperAdmin || roleKey === "super_admin");
  const [canControlEntries,setCanControlEntries] = useState(Boolean(user?.isSuperAdmin || ["admin", "super_admin", "manager", "accountant"].includes(roleKey)));
  const isMicrofinance = workspaceLabel.toLowerCase() === "microfinance";
  const isSchool = workspaceLabel.toLowerCase() === "school";

  useEffect(()=>{if(!orgId)return;void (supabase as any).rpc("gb_cashbook_can_control",{target_org:orgId}).then(({data,error}:any)=>{if(!error)setCanControlEntries(Boolean(data));});},[orgId,user?.isSuperAdmin,roleKey]);

  useEffect(() => {
    if (mode !== "cashbook") setMode("cashbook");
  }, [mode, setMode]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void Promise.all([
      supabase.from("business_projects").select("id,name,code").eq("organization_id", orgId).in("status", ["planned", "active"]).order("name"),
      supabase.from("vendors").select("id,name").eq("organization_id", orgId).order("name"),
      supabase.from("retail_customers").select("id,name").eq("organization_id", orgId).order("name"),
      supabase.from("products").select("id,name,cost_price,sales_price,unit_of_measure,department_id,track_inventory").eq("organization_id", orgId).eq("track_inventory", true).eq("active", true).order("name"),
    ]).then(([projectRes, supplierRes, customerRes, productRes]) => {
      if (cancelled) return;
      setProjects((projectRes.data || []) as MasterOption[]);
      setSuppliers((supplierRes.data || []) as MasterOption[]);
      setCustomers((customerRes.data || []) as MasterOption[]);
      setInventoryProducts((productRes.data || []) as InventoryProductOption[]);
    });
    return () => { cancelled = true; };
  }, [orgId]);

  useEffect(() => {
    setShowComments(window.localStorage.getItem(commentsPreferenceKey) !== "off");
  }, [commentsPreferenceKey]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void supabase.from("general_business_cashbook_settings").select("show_helper_text,helper_text,show_page_description,page_description,primary_color,accent_color,button_radius").eq("organization_id", orgId).maybeSingle().then(({ data }) => {
      if (!cancelled && data) setCashbookSettings({ ...DEFAULT_CASHBOOK_SETTINGS, ...(data as CashbookSettings) });
    });
    return () => { cancelled = true; };
  }, [orgId]);

  const toggleComments = () => {
    const next = !showComments;
    setShowComments(next);
    window.localStorage.setItem(commentsPreferenceKey, next ? "on" : "off");
    if (!next) setSheetEntry((current) => ({ ...current, comments: "" }));
  };

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);

  useEffect(() => {
    if (entryOpen) window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [draft, draftStorageKey, entryOpen]);

  useEffect(() => {
    try { setQueuedDrafts(JSON.parse(window.localStorage.getItem(queueStorageKey) || "[]") as QueuedDraft[]); }
    catch { setQueuedDrafts([]); }
  }, [queueStorageKey]);

  const persistQueue = (next: QueuedDraft[]) => {
    setQueuedDrafts(next);
    window.localStorage.setItem(queueStorageKey, JSON.stringify(next));
  };

  const load = useCallback(async () => {
    if (!orgId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setWarning(null);
    const queryFrom = [dateFrom, summaryDate].filter(Boolean).sort()[0] || dateFrom;
    const queryToValues = [dateTo, summaryDate].filter(Boolean).sort();
    const queryTo = queryToValues[queryToValues.length - 1] || dateTo;

    const [paymentsRes, vendorPaymentsInitial, expensesRes, directEntriesRes, glAccountsRes, modernGlRes] = await Promise.all([
      supabase
        .from("payments")
        .select("id,amount,paid_at,payment_method,payment_status,payment_source,transaction_id,property_customer_id,retail_customer_id")
        .eq("organization_id", orgId)
        .eq("payment_status", "completed")
        .gte("paid_at", `${queryFrom}T00:00:00`)
        .lte("paid_at", `${queryTo}T23:59:59`)
        .order("paid_at", { ascending: false })
        .limit(rowLimit),
      supabase
        .from("vendor_payments")
        .select("id,amount,payment_date,payment_method,reference,status,vendors(name)")
        .eq("organization_id", orgId)
        .gte("payment_date", queryFrom)
        .lte("payment_date", queryTo)
        .order("payment_date", { ascending: false })
        .limit(rowLimit),
      supabase
        .from("expenses")
        .select("id,amount,description,expense_date,status,vendors(name)")
        .eq("organization_id", orgId)
        .gte("expense_date", queryFrom)
        .lte("expense_date", queryTo)
        .order("expense_date", { ascending: false })
        .limit(rowLimit),
      (supabase as any).from("general_business_cashbook_entries")
        .select("id,posted_at,transaction_date,headquarters,payment_method,description,comments,supplier_name,customer_name,cash_in,cash_out,reference,workspace_type,approval_status,created_by,counterpart:gl_accounts!counterpart_gl_account_id(account_code,account_name),creator:staff!created_by(full_name)")
        .eq("organization_id", orgId).gte("transaction_date", queryFrom).lte("transaction_date", queryTo)
        .order("transaction_date", { ascending: false }).limit(rowLimit),
      supabase.from("gl_accounts").select("id,account_code,account_name,account_type,category").eq("organization_id", orgId).eq("is_active", true).order("account_code"),
      (supabase as any).rpc("cashbook_modern_gl_entries", { p_organization_id: orgId, p_date_from: queryFrom, p_date_to: queryTo, p_limit: rowLimit }),
    ]);
    if (!glAccountsRes.error) setGlOptions(((glAccountsRes.data || []) as GlOption[]).filter((account) => isGlAccountRelevantForBusinessType(account, user?.business_type)));

    let vendorPaymentsRes = vendorPaymentsInitial;
    if (vendorPaymentsRes.error && vendorPaymentsRes.error.message.toLowerCase().includes("status")) {
      vendorPaymentsRes = await supabase
        .from("vendor_payments")
        .select("id,amount,payment_date,payment_method,reference,vendors(name)")
        .eq("organization_id", orgId)
        .gte("payment_date", queryFrom)
        .lte("payment_date", queryTo)
        .order("payment_date", { ascending: false })
        .limit(rowLimit) as typeof vendorPaymentsInitial;
    }

    const errors = [paymentsRes.error, vendorPaymentsRes.error, expensesRes.error].filter(Boolean);
    if (errors.length) setWarning(`Some cashbook sources could not be loaded: ${errors.map(errorMessage).join(" · ")}`);
    else if (directEntriesRes.error) setWarning("Direct Cash Book entry requires the latest Supabase migration. Existing BOAT transactions are still shown.");
    else if (modernGlRes.error) setWarning("Modern-mode GL transactions require the latest Cash Book bridge migration. Other cashbook sources are still shown.");
    else if ([paymentsRes.data?.length, vendorPaymentsRes.data?.length, expensesRes.data?.length,directEntriesRes.data?.length].some((count) => Number(count||0) >= rowLimit)) setWarning(`This period reached the ${rowLimit.toLocaleString()}-row page limit for at least one source. Load the next page or narrow the date range.`);

    const paymentRows = (paymentsRes.data || []) as unknown as PaymentWithCustomer[];
    const hotelCustomerIds = [...new Set(paymentRows.map((row) => row.property_customer_id).filter(Boolean))] as string[];
    const retailCustomerIds = [...new Set(paymentRows.map((row) => row.retail_customer_id).filter(Boolean))] as string[];
    const [hotelCustomersRes, retailCustomersRes] = await Promise.all([
      hotelCustomerIds.length
        ? supabase.from("hotel_customers").select("id,first_name,last_name").eq("organization_id", orgId).in("id", hotelCustomerIds)
        : Promise.resolve({ data: [], error: null }),
      retailCustomerIds.length
        ? supabase.from("retail_customers").select("id,name").eq("organization_id", orgId).in("id", retailCustomerIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const hotelCustomers = new Map(
      ((hotelCustomersRes.data || []) as Array<{ id: string; first_name: string; last_name: string }>).map((row) => [
        row.id,
        { first_name: row.first_name, last_name: row.last_name },
      ])
    );
    const retailCustomers = new Map(
      ((retailCustomersRes.data || []) as Array<{ id: string; name: string }>).map((row) => [row.id, { name: row.name }])
    );

    const receipts: CashbookRow[] = paymentRows.map((payment) => {
      const enriched: PaymentWithCustomer = {
        ...payment,
        property_customer: payment.property_customer_id ? hotelCustomers.get(payment.property_customer_id) : undefined,
        retail_customer: payment.retail_customer_id ? retailCustomers.get(payment.retail_customer_id) : undefined,
      };
      return {
        id: `receipt:${payment.id}`,
        source: "receipt",
        date: localDatePart(payment.paid_at),
        description: receiptDescription(payment),
        party: paymentReceivedCustomerLabel(enriched),
        method: readable(payment.payment_method),
        reference: payment.transaction_id || payment.id,
        cashIn: Number(payment.amount || 0),
        cashOut: 0,
        status: "Completed",
      };
    });

    const supplierPayments: CashbookRow[] = ((vendorPaymentsRes.data || []) as unknown as Array<{
      id: string;
      amount: number | null;
      payment_date: string | null;
      payment_method: string | null;
      reference: string | null;
      status?: string | null;
      vendors: VendorRef;
    }>)
      .filter((payment) => (payment.status || "active") !== "reversed")
      .map((payment) => ({
        id: `supplier:${payment.id}`,
        source: "supplier_payment",
        date: localDatePart(payment.payment_date),
        description: "Supplier payment",
        party: vendorName(payment.vendors),
        method: readable(payment.payment_method),
        reference: payment.reference || payment.id,
        cashIn: 0,
        cashOut: Number(payment.amount || 0),
        status: readable(payment.status || "active"),
      }));

    const expenses: CashbookRow[] = ((expensesRes.data || []) as unknown as Array<{
      id: string;
      amount: number | null;
      description: string | null;
      expense_date: string | null;
      status?: string | null;
      vendors: VendorRef;
    }>)
      .filter((expense) => (expense.status || "active") !== "cancelled")
      .map((expense) => ({
        id: `expense:${expense.id}`,
        source: "expense",
        date: localDatePart(expense.expense_date),
        description: expense.description?.trim() || "Direct expense",
        party: vendorName(expense.vendors),
        method: "Cash / bank",
        reference: expense.id,
        cashIn: 0,
        cashOut: Number(expense.amount || 0),
        status: readable(expense.status || "active"),
      }));
    const dedupedExpenses = expenses.filter(expense => !supplierPayments.some(payment => payment.date === expense.date && payment.cashOut === expense.cashOut && payment.party === expense.party));

    const directEntries: CashbookRow[] = ((directEntriesRes.data || []) as Array<any>).map((entry) => ({
      id: `cashbook:${entry.id}`,
      source: "cashbook_entry",
      date: localDatePart(entry.transaction_date),
      description: entry.description,
      party: entry.customer_name || entry.supplier_name || "—",
      method: readable(entry.payment_method),
      reference: entry.reference || entry.id,
      cashIn: Number(entry.cash_in || 0),
      cashOut: Number(entry.cash_out || 0),
      status: "Posted",
      headquarters: entry.headquarters || "—",
      glAccount: entry.counterpart ? `${entry.counterpart.account_code} - ${entry.counterpart.account_name}` : "—",
      postedAt: entry.posted_at,
      submittedBy: entry.creator?.full_name || "—",
      comments: entry.comments || "",
      rawId: entry.id,
      createdBy: entry.created_by,
      approvalStatus: entry.approval_status || "pending",
    }));
    const representedSourceIds = new Set<string>([
      ...paymentRows.map((row) => row.id),
      ...((vendorPaymentsRes.data || []) as Array<{ id: string }>).map((row) => row.id),
      ...((expensesRes.data || []) as Array<{ id: string }>).map((row) => row.id),
      ...((directEntriesRes.data || []) as Array<{ id: string }>).map((row) => row.id),
    ]);
    const modernGlRows: CashbookRow[] = ((modernGlRes.data || []) as Array<any>)
      .filter((entry) => !entry.reference_id || !representedSourceIds.has(entry.reference_id))
      .map((entry) => ({
        id: `modern-gl:${entry.journal_entry_id}`,
        rawId: entry.journal_entry_id,
        source: "modern_gl" as const,
        date: localDatePart(entry.entry_date),
        description: entry.description || "Modern-mode cash movement",
        party: "General ledger",
        method: entry.cash_account_name || "Cash / bank",
        reference: entry.reference_id || entry.journal_entry_id,
        cashIn: Math.max(Number(entry.cash_movement || 0), 0),
        cashOut: Math.max(-Number(entry.cash_movement || 0), 0),
        status: "Posted",
        glAccount: entry.cash_account_name || undefined,
        postedAt: entry.created_at || undefined,
      }));
    let mfiRows: CashbookRow[] = [];
    if (isMicrofinance) {
      const [repayments, disbursements, recoveries] = await Promise.all([
        (supabase as any).from("mf_repayments").select("id,payment_date,payment_method,amount,receipt_number,external_reference,status,reversal_of,posted_at,mf_loans(loan_number,mf_borrowers(full_name))").eq("organization_id",orgId).gte("payment_date",queryFrom).lte("payment_date",queryTo).in("status",["posted","reversed"]).limit(rowLimit),
        (supabase as any).from("mf_disbursements").select("id,disbursed_at,method,net_amount,disbursement_reference,transaction_reference,mf_loans(loan_number,mf_borrowers(full_name))").eq("organization_id",orgId).gte("disbursed_at",`${queryFrom}T00:00:00`).lte("disbursed_at",`${queryTo}T23:59:59`).not("journal_entry_id","is",null).limit(rowLimit),
        (supabase as any).from("mf_recoveries").select("id,recovery_date,payment_method,amount,external_reference,mf_loans(loan_number,mf_borrowers(full_name))").eq("organization_id",orgId).gte("recovery_date",queryFrom).lte("recovery_date",queryTo).not("journal_entry_id","is",null).limit(rowLimit),
      ]);
      const loanParty = (row:any) => row.mf_loans?.mf_borrowers?.full_name || row.mf_loans?.loan_number || "Microfinance client";
      mfiRows = [
        ...(repayments.data || []).map((r:any) => ({ id:`mf-repayment:${r.id}`,rawId:r.id,source:"mf_repayment" as const,date:r.payment_date,description:r.reversal_of?"Repayment reversal":"Loan repayment",party:loanParty(r),method:readable(r.payment_method),reference:r.receipt_number||r.external_reference,cashIn:r.reversal_of?0:Number(r.amount||0),cashOut:r.reversal_of?Number(r.amount||0):0,status:readable(r.status),postedAt:r.posted_at })),
        ...(disbursements.data || []).map((r:any) => ({ id:`mf-disbursement:${r.id}`,rawId:r.id,source:"mf_disbursement" as const,date:localDatePart(r.disbursed_at),description:"Loan disbursement",party:loanParty(r),method:readable(r.method),reference:r.transaction_reference||r.disbursement_reference,cashIn:0,cashOut:Number(r.net_amount||0),status:"Posted" })),
        ...(recoveries.data || []).map((r:any) => ({ id:`mf-recovery:${r.id}`,rawId:r.id,source:"mf_recovery" as const,date:r.recovery_date,description:"Written-off loan recovery",party:loanParty(r),method:readable(r.payment_method),reference:r.external_reference,cashIn:Number(r.amount||0),cashOut:0,status:"Posted" })),
      ];
      const mfiErrors = [repayments.error,disbursements.error,recoveries.error].filter(Boolean);
      if (mfiErrors.length) setWarning(`Some Microfinance cash flows could not be loaded: ${mfiErrors.map(errorMessage).join(" · ")}`);
    }
    let schoolRows: CashbookRow[] = [];
    if (isSchool) {
      const schoolPayments = await supabase.from("school_payments").select("id,amount,method,reference,paid_at,notes,students(first_name,last_name,admission_number)").eq("organization_id",orgId).gte("paid_at",`${queryFrom}T00:00:00`).lte("paid_at",`${queryTo}T23:59:59`).order("paid_at",{ascending:false}).limit(rowLimit);
      if (schoolPayments.error) setWarning(`School fee collections could not be loaded: ${schoolPayments.error.message}`);
      schoolRows=((schoolPayments.data||[]) as any[]).map(payment=>({id:`school-fee:${payment.id}`,source:"school_fee" as const,date:localDatePart(payment.paid_at),description:payment.notes?.trim()||"School fee collection",party:[payment.students?.first_name,payment.students?.last_name].filter(Boolean).join(" ")||payment.students?.admission_number||"Student",method:readable(payment.method),reference:payment.reference||payment.id,cashIn:Number(payment.amount||0),cashOut:0,status:"Completed"}));
    }
    const baseRows = isMicrofinance ? directEntries : isSchool ? [...directEntries,...schoolRows,...supplierPayments,...dedupedExpenses,...modernGlRows] : [...directEntries, ...receipts, ...supplierPayments, ...dedupedExpenses, ...modernGlRows];
    setRows([...baseRows,...mfiRows].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)));
    setLoading(false);
  }, [dateFrom, dateTo, orgId, summaryDate, isMicrofinance, isSchool, user?.business_type, rowLimit]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!orgId) { setGlPosition(null); return; }
    let cancelled = false;
    void (supabase as any).rpc("cashbook_daily_gl_position", { p_organization_id: orgId, p_date: summaryDate })
      .then(({ data, error }: { data?: Array<{ opening_balance: number; day_movement: number; closing_balance: number }>; error?: unknown }) => {
        if (cancelled) return;
        if (error || !data?.[0]) { setGlPosition(null); return; }
        const row = data[0];
        setGlPosition({ opening: Number(row.opening_balance || 0), movement: Number(row.day_movement || 0), closing: Number(row.closing_balance || 0) });
      });
    return () => { cancelled = true; };
  }, [orgId, summaryDate, rows]);

  useEffect(() => {
    if (!orgId) { setChannelPositions([]); return; }
    void (supabase as any).rpc("cashbook_daily_channel_positions", { p_organization_id: orgId, p_date: summaryDate }).then(({ data, error }: any) => {
      if (error) { setChannelPositions([]); return; }
      setChannelPositions((data || []).map((row:any) => ({ channel:row.channel,opening:Number(row.opening_balance||0),movement:Number(row.day_movement||0),closing:Number(row.closing_balance||0) })));
    });
  }, [orgId,summaryDate,rows]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (dateFrom && row.date < dateFrom) return false;
      if (dateTo && row.date > dateTo) return false;
      if (direction === "in" && row.cashIn <= 0) return false;
      if (direction === "out" && row.cashOut <= 0) return false;
      if (needle && !`${row.description} ${row.party} ${row.method} ${row.reference}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [dateFrom, dateTo, direction, rows, search]);

  const totals = useMemo(() => filteredRows.reduce((total, row) => ({
    cashIn: total.cashIn + row.cashIn,
    cashOut: total.cashOut + row.cashOut,
  }), { cashIn: 0, cashOut: 0 }), [filteredRows]);

  const cashGlOptions = useMemo(() => glOptions.filter((account) => {
    if (account.account_type !== "asset") return false;
    const text = `${account.category || ""} ${account.account_name}`.toLowerCase();
    return /cash|bank|mobile|momo|wallet|till|float/.test(text);
  }), [glOptions]);
  const counterpartGlOptions = useMemo(() => glOptions.filter((account) => !cashGlOptions.some((cash) => cash.id === account.id)), [cashGlOptions, glOptions]);

  const daily = useMemo(() => {
    const dayRows = rows.filter((row) => row.date === summaryDate);
    const cashIn = dayRows.reduce((sum, row) => sum + row.cashIn, 0);
    const cashOut = dayRows.reduce((sum, row) => sum + row.cashOut, 0);
    return {
      rows: dayRows.length,
      cashIn,
      cashOut,
      net: cashIn - cashOut,
      receipts: dayRows.filter((row) => row.cashIn > 0).length,
      payments: dayRows.filter((row) => row.cashOut > 0).length,
      methods: new Set(dayRows.map((row) => row.method).filter(Boolean)).size,
    };
  }, [rows, summaryDate]);

  const dailyLines = useMemo(() => {
    const dayRows = rows.filter((row) => row.date === summaryDate);
    const openingByChannel = new Map(channelPositions.map(position => [position.channel,position.opening]));
    const running: Record<string,number> = { cash:openingByChannel.get("cash")||0,mobile_money:openingByChannel.get("mobile_money")||0,bank:openingByChannel.get("bank")||0,wallet:openingByChannel.get("wallet")||0 };
    return dayRows.slice().sort((a, b) => a.id.localeCompare(b.id)).map((row) => {
      const method = row.method.toLowerCase();
      const signed = row.cashIn - row.cashOut;
      const isCash = method.includes("cash");
      const channel = isCash ? "cash" : method.includes("mobile") || method.includes("momo") ? "mobile_money" : method.includes("card") || method.includes("wallet") ? "wallet" : "bank";
      running[channel] = (running[channel] || 0) + signed;
      return {
        ...row,
        momo: method.includes("mobile") || method.includes("momo") ? signed : 0,
        bank: method.includes("bank") || method.includes("card") || method.includes("wallet") ? signed : 0,
        physicalIn: isCash ? row.cashIn : 0,
        physicalOut: isCash ? row.cashOut : 0,
        channel,
        channelBalance: running[channel],
      };
    });
  }, [channelPositions, rows, summaryDate]);

  const postSheetEntry = async () => {
    if (!orgId) return;
    const cashIn = Number(sheetEntry.cashIn || 0);
    const cashOut = Number(sheetEntry.cashOut || 0);
    if (!sheetEntry.transactionDate || !sheetEntry.description.trim() || !sheetEntry.counterpartGlId || !sheetEntry.cashGlId) {
      setEntryMessage("Transaction date, description, GL account and cash/bank account are required."); return;
    }
    if (!((cashIn > 0 && cashOut === 0) || (cashOut > 0 && cashIn === 0))) {
      setEntryMessage("Enter either Cash In or Cash Out, but not both."); return;
    }
    if (!online) { setEntryMessage("Direct ledger posting requires connectivity. Use the offline queue for work that must be completed later."); return; }
    setPostingEntry(true); setEntryMessage(null);
    const { data: postedId, error } = await (supabase as any).rpc("post_general_business_cashbook_entry", {
      p_organization_id: orgId, p_transaction_date: sheetEntry.transactionDate,
      p_headquarters: sheetEntry.headquarters, p_payment_method: sheetEntry.paymentMethod,
      p_description: sheetEntry.description.trim(), p_supplier_name: sheetEntry.supplier,
      p_customer_name: sheetEntry.customer, p_counterpart_gl_account_id: sheetEntry.counterpartGlId,
      p_cash_gl_account_id: sheetEntry.cashGlId, p_cash_in: cashIn, p_cash_out: cashOut,
      p_reference: sheetEntry.reference,
    });
    setPostingEntry(false);
    if (error) { setEntryMessage(errorMessage(error)); return; }
    if (postedId && (isMicrofinance || (showComments && sheetEntry.comments.trim()))) {
      const { error: commentError } = await (supabase as any).from("general_business_cashbook_entries").update({ ...(showComments && sheetEntry.comments.trim() ? { comments: sheetEntry.comments.trim() } : {}), workspace_type: isMicrofinance ? "microfinance" : "general_business" }).eq("id", postedId).eq("organization_id", orgId);
      if (commentError) { setEntryMessage(`Entry posted, but comments were not saved: ${errorMessage(commentError)}`); await load(); return; }
    }
    setSheetEntry((current) => ({ ...current, description: "", comments: "", supplier: "", customer: "", cashIn: "", cashOut: "", reference: "" }));
    setEntryMessage("Cashbook entry posted to the register and general ledger.");
    await load();
  };

  const openEntry = () => {
    let saved: DraftEntry | null = null;
    try { saved = JSON.parse(window.localStorage.getItem(draftStorageKey) || "null") as DraftEntry | null; } catch { saved = null; }
    setDraft(saved ? { ...saved, project: saved.project || "", productId: saved.productId || "", productName: saved.productName || "", quantity: saved.quantity || "", unitCost: saved.unitCost || "" } : { type: "money_in", date: todayISO(), party: "", project: "", description: "", method: "cash", amount: "", reference: "", productId: "", productName: "", quantity: "", unitCost: "" });
    setDraftError(null);
    setEntryOpen(true);
  };

  const openEntryFor = (type: EntryType) => {
    openEntry();
    setDraft((current) => ({ ...current, type, party: "", productId: "", productName: "", quantity: "", unitCost: "", amount: "" }));
  };

  const saveAppearance = async () => {
    if (!orgId || !canCustomizeAppearance) return;
    setSavingAppearance(true);
    setAppearanceMessage(null);
    const { error } = await (supabase as any).from("general_business_cashbook_settings").upsert({
      organization_id: orgId,
      ...cashbookSettings,
      updated_by: user?.id || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id" });
    setSavingAppearance(false);
    setAppearanceMessage(error ? errorMessage(error) : "Cashbook appearance saved for this organization.");
  };

  const fundsGlForMethod = async (method: string): Promise<string | null> => {
    const accounts = await getDefaultGlAccounts();
    if (method === "bank_transfer" || method === "card") return accounts.posBank || accounts.cash;
    if (method === "airtel_money") return accounts.posAirtelMoney || accounts.posMtnMobileMoney || accounts.cash;
    if (method === "mobile_money" || method === "mtn_mobile_money") return accounts.posMtnMobileMoney || accounts.posAirtelMoney || accounts.cash;
    return accounts.cash;
  };

  const finishQuickPosting = async (message: string) => {
    window.localStorage.removeItem(draftStorageKey);
    setEntryOpen(false);
    setDraftError(null);
    setEntryMessage(message);
    await load();
  };

  const postQuickPurchase = async () => {
    if (!orgId || !user?.id) throw new Error("Your organization or user session is missing.");
    const vendor = suppliers.find((item) => item.name === draft.party);
    if (!vendor) throw new Error("Select the supplier being paid.");
    const product = inventoryProducts.find((item) => item.id === draft.productId);
    if (!product) throw new Error("Select a valid inventory product.");
    const quantity = Number(draft.quantity);
    const unitCost = Number(draft.unitCost);
    const amount = Number(draft.amount);
    if (Math.abs(quantity * unitCost - amount) > 0.02) throw new Error("Purchase amount must equal quantity × unit cost.");

    const purchaseOrderId = randomUuid();
    const billId = randomUuid();
    const paymentId = randomUuid();
    let billJournalPosted = false;
    let paymentJournalPosted = false;
    try {
      const approvedAt = new Date().toISOString();
      const { error: poError } = await supabase.from("purchase_orders").insert({ id: purchaseOrderId, organization_id: orgId, vendor_id: vendor.id, order_date: draft.date, status: "approved", total_amount: amount, approved_at: approvedAt });
      if (poError) throw poError;
      const { error: itemError } = await supabase.from("purchase_order_items").insert({ purchase_order_id: purchaseOrderId, organization_id: orgId, product_id: product.id, description: product.name, quantity, cost_price: unitCost });
      if (itemError) throw itemError;
      const { error: billError } = await supabase.from("bills").insert({ id: billId, organization_id: orgId, vendor_id: vendor.id, purchase_order_id: purchaseOrderId, bill_date: draft.date, due_date: draft.date, amount, description: draft.description.trim(), status: "pending_approval", approved_at: approvedAt, approved_by: user.id });
      if (billError) throw billError;
      const billJournal = await createJournalForBill(billId, amount, draft.description.trim(), draft.date, user.id, purchaseOrderId);
      if (!billJournal.ok) throw new Error(billJournal.error || "The purchase journal could not be posted.");
      billJournalPosted = true;
      const stockResult = await postStockInFromPurchaseOrderForBill(billId, purchaseOrderId, draft.date);
      if (stockResult.unmatchedDescriptions.length) throw new Error(`Stock item was not matched: ${stockResult.unmatchedDescriptions.join(", ")}`);
      const { error: paymentError } = await supabase.from("vendor_payments").insert({ id: paymentId, organization_id: orgId, vendor_id: vendor.id, bill_id: billId, amount, payment_date: draft.date, payment_method: draft.method, reference: draft.reference.trim() || `Cashbook purchase ${billId.slice(0, 8)}`, bill_allocations: [] });
      if (paymentError) throw paymentError;
      const sourceFundsGlAccountId = await fundsGlForMethod(draft.method);
      const paymentJournal = await createJournalForVendorPayment(paymentId, amount, draft.date, user.id, { payableAmount: amount, unearnedExcessAmount: 0, sourceFundsGlAccountId });
      if (!paymentJournal.ok) throw new Error(paymentJournal.error || "The supplier payment journal could not be posted.");
      paymentJournalPosted = true;
      await syncBillStatusInDb(billId);
      await finishQuickPosting(`Purchase completed: ${quantity.toLocaleString()} ${product.unit_of_measure || "units"} of ${product.name} received and ${money.format(amount)} paid to ${vendor.name}.`);
    } catch (error) {
      if (paymentJournalPosted) await deleteJournalEntryByReference("vendor_payment", paymentId, orgId);
      if (billJournalPosted) await deleteJournalEntryByReference("bill", billId, orgId);
      await supabase.from("product_stock_movements").delete().eq("source_type", "bill").eq("source_id", billId);
      await supabase.from("vendor_payments").delete().eq("id", paymentId);
      await supabase.from("bills").delete().eq("id", billId);
      await supabase.from("purchase_order_items").delete().eq("purchase_order_id", purchaseOrderId);
      await supabase.from("purchase_orders").delete().eq("id", purchaseOrderId);
      throw error;
    }
  };

  const postQuickSale = async () => {
    if (!orgId || !user?.id) throw new Error("Your organization or user session is missing.");
    const product = inventoryProducts.find((item) => item.id === draft.productId);
    if (!product) throw new Error("Select a valid inventory product.");
    const customer = customers.find((item) => item.name === draft.party);
    const quantity = Number(draft.quantity);
    const unitPrice = Number(draft.unitCost);
    const total = Number(draft.amount);
    if (Math.abs(quantity * unitPrice - total) > 0.02) throw new Error("Sale amount must equal quantity × unit price.");
    const tenderMethod = draft.method === "mobile_money" ? "mtn_mobile_money" : draft.method as "cash" | "card" | "bank_transfer" | "mtn_mobile_money" | "airtel_money" | "wallet";
    await processSaleOnline({
      saleId: randomUuid(),
      lines: [{ productId: product.id, quantity, unitPrice, lineTotal: total, costPrice: product.cost_price, trackInventory: product.track_inventory !== false, departmentId: product.department_id, name: product.name }],
      tenders: [{ method: tenderMethod, amount: total, status: "completed", reference: draft.reference.trim() || null }],
      saleCustomer: { id: customer?.id || null, name: customer?.name || draft.party || "Walk-in customer", phone: null },
      useDesktopLocalMode: false,
      activeSessionId: null,
      total,
      amountPaid: total,
      amountDue: 0,
      changeDue: 0,
      paymentStatus: "completed",
      saleType: "cash",
      creditDueDate: "",
      posVatEnabled: false,
      posVatRate: null,
      userId: user.id,
      organizationId: orgId,
      customers: [],
      departments: [],
      onAtomicRpcStatus: () => undefined,
      onAtomicFallbackCount: () => undefined,
      saleAt: `${draft.date}T12:00:00+03:00`,
    });
    await finishQuickPosting(`Sale completed: ${quantity.toLocaleString()} ${product.unit_of_measure || "units"} of ${product.name} sold and ${money.format(total)} received${customer ? ` from ${customer.name}` : ""}.`);
  };

  const continueEntry = async () => {
    if (!draft.date || !draft.description.trim() || Number(draft.amount) <= 0) {
      setDraftError("Enter a date, description and an amount greater than zero.");
      return;
    }
    if ((draft.type === "purchase" || draft.type === "sale") && (!draft.productId || Number(draft.quantity) <= 0 || Number(draft.unitCost) < 0)) {
      setDraftError("Select the inventory product and enter a quantity greater than zero.");
      return;
    }
    if (draft.type === "purchase" || draft.type === "sale") {
      setPostingQuickTransaction(true);
      setDraftError(null);
      try {
        if (draft.type === "purchase") await postQuickPurchase();
        else await postQuickSale();
      } catch (error) {
        setDraftError(errorMessage(error));
      } finally {
        setPostingQuickTransaction(false);
      }
      return;
    }
    if (!online) {
      persistQueue([...queuedDrafts, { ...draft, id: crypto.randomUUID(), queuedAt: new Date().toISOString() }]);
      window.localStorage.removeItem(draftStorageKey);
      setEntryOpen(false);
      setDraftError(null);
      return;
    }
    const target = draft.type === "money_in"
      ? "cash_receipts"
      : draft.type === "money_out"
        ? "purchases_expenses"
        : "treasury";
    setEntryOpen(false);
    onNavigate(target, { cashbookDraft: draft, treasuryTab: draft.type === "transfer" ? "movements" : undefined });
  };

  const resumeQueuedDraft = (queued: QueuedDraft) => {
    persistQueue(queuedDrafts.filter((item) => item.id !== queued.id));
    const { id: _id, queuedAt: _queuedAt, ...entry } = queued;
    setDraft(entry);
    setDraftError(null);
    setEntryOpen(true);
  };

  const reviewRow = (row: CashbookRow) => {
    const sourceId = row.id.slice(row.id.indexOf(":") + 1);
    if (row.source === "mf_repayment" || row.source === "mf_recovery") onNavigate("mfi_collections", { highlightTransactionId: sourceId });
    else if (row.source === "mf_disbursement") onNavigate("mfi_approvals_disbursements", { highlightTransactionId: sourceId });
    else if (row.source === "cashbook_entry") onNavigate("accounting_journal", { cashbookEntryId: sourceId });
    else if (row.source === "modern_gl") onNavigate("accounting_journal", { journalEntryId: row.rawId || sourceId });
    else if (row.source === "receipt") onNavigate("payments", { highlightPaymentId: sourceId });
    else if (row.source === "supplier_payment") onNavigate("purchases_payments", { highlightVendorPaymentId: sourceId });
    else onNavigate("purchases_expenses", { highlightExpenseId: sourceId });
  };

  const exportCsv = () => {
    downloadCsv(`${isMicrofinance?"microfinance":isSchool?"school":"general-business"}-cashbook-${dateFrom}-${dateTo}.csv`, exportRows());
  };
  const exportRows = (): (string|number)[][] => [["Date","Description","Party","Method","Reference","Cash In","Cash Out","Status","Source"],...filteredRows.map(row=>[row.date,row.description,row.party,row.method,row.reference,row.cashIn,row.cashOut,row.approvalStatus||row.status,row.source])];
  const exportExcel = () => downloadXlsx(`${isMicrofinance?"microfinance":isSchool?"school":"general-business"}-cashbook-${dateFrom}-${dateTo}.xlsx`,exportRows(),{companyName:workspaceLabel,sheetName:"Cashbook"});
  const exportPdf = () => exportAccountingPdf({title:`${workspaceLabel} Cashbook`,subtitle:`${dateFrom} to ${dateTo}`,filename:`${isMicrofinance?"microfinance":isSchool?"school":"general-business"}-cashbook-${dateFrom}-${dateTo}.pdf`,sections:[{title:"Cashbook register",head:exportRows()[0].map(String),body:exportRows().slice(1)}]});

  const controlDirectEntry = async (row:CashbookRow,action:"approve"|"correct"|"void") => {
    if(!orgId||!row.rawId)return;
    let error:any=null;
    if(action==="approve") ({error}=await (supabase as any).rpc("approve_general_cashbook_entry",{p_organization_id:orgId,p_entry_id:row.rawId}));
    if(action==="void"){const reason=window.prompt("Reason for voiding this entry:");if(!reason)return;({error}=await (supabase as any).rpc("void_general_cashbook_entry",{p_organization_id:orgId,p_entry_id:row.rawId,p_reason:reason}));}
    if(action==="correct"){const reason=window.prompt("Reason for correction:");if(!reason)return;const description=window.prompt("Corrected description:",row.description);if(description===null)return;const reference=window.prompt("Corrected reference:",row.reference);if(reference===null)return;({error}=await (supabase as any).rpc("correct_general_cashbook_entry",{p_organization_id:orgId,p_entry_id:row.rawId,p_reason:reason,p_description:description,p_reference:reference}));}
    setWarning(error?errorMessage(error):`Entry ${action === "approve" ? "approved" : action === "void" ? "voided with a reversing journal" : "corrected with an audited replacement"}.`);if(!error)await load();
  };

  const pageTitle = view === "entry" ? "Cashbook Entry" : view === "daily" ? "Daily Summary" : "Cashbook Register";
  const pageDescription = view === "entry"
    ? "Record cash, mobile money and bank transactions in a focused AppSheet-style form."
    : view === "daily"
      ? "Review the selected day's payment-method movements and running cash position."
      : "All completed cash, mobile-money and bank movements in one Google-Sheet-style register.";

  return (
    <div className={`cashbook-print mx-auto space-y-5 p-4 sm:p-6 lg:p-8 ${view === "entry" ? "max-w-4xl" : "max-w-[1500px]"}`}>
      <style>{`@media print{.cashbook-print{max-width:none!important;padding:0!important}.cashbook-print .print\\:hidden,.cashbook-print button,.cashbook-print input,.cashbook-print select{display:none!important}.cashbook-print table{min-width:0!important;font-size:9px!important}.cashbook-print th,.cashbook-print td{padding:4px!important}.cashbook-print section{box-shadow:none!important;break-inside:avoid}}`}</style>
      <header>
        <p className="text-xs font-bold uppercase tracking-wider text-brand-700">{workspaceLabel} · Consolidated register</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-7 w-7 text-brand-700" />
            <h1 className="text-3xl font-bold text-slate-900">{pageTitle}</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 text-sm" aria-label={`${workspaceLabel} mode`}>
            <button type="button" onClick={() => { setMode("modern"); onNavigate(routes.dashboard); }} className={`rounded-md px-3 py-1.5 font-semibold ${mode === "modern" ? "bg-brand-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}>Modern</button>
            <button type="button" onClick={() => setMode("cashbook")} className={`rounded-md px-3 py-1.5 font-semibold ${mode === "cashbook" ? "bg-brand-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}>Cashbook</button>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="app-btn-secondary"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
          {canCustomizeAppearance && <button type="button" onClick={() => setAppearanceOpen((open) => !open)} className="app-btn-secondary"><Palette className="h-4 w-4" /> Appearance</button>}
          <button type="button" onClick={() => onNavigate("accounting_bank_reconciliation")} className="app-btn-secondary">Reconcile</button>
          {view !== "entry" && <button type="button" onClick={() => onNavigate(routes.entry)} className="app-btn-primary"><Plus className="h-4 w-4" />Cashbook entry</button>}
          </div>
        </div>
        {(view !== "entry" || cashbookSettings.show_page_description) && <p className="mt-1 text-sm text-slate-600">{view === "entry" ? cashbookSettings.page_description : pageDescription}</p>}
      </header>

      {appearanceOpen && canCustomizeAppearance && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold text-slate-900">Cashbook appearance</h2><p className="mt-1 text-sm text-slate-600">Colors and button shape apply to this organization's Cashbook workspace.</p></div><button type="button" onClick={() => setAppearanceOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close appearance settings"><X className="h-4 w-4" /></button></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Primary color"><input type="color" value={cashbookSettings.primary_color} onChange={(event) => setCashbookSettings((current) => ({ ...current, primary_color: event.target.value }))} className="h-11 w-full cursor-pointer rounded-lg border border-slate-300 bg-white p-1" /></Field>
          <Field label="Accent color"><input type="color" value={cashbookSettings.accent_color} onChange={(event) => setCashbookSettings((current) => ({ ...current, accent_color: event.target.value }))} className="h-11 w-full cursor-pointer rounded-lg border border-slate-300 bg-white p-1" /></Field>
          <Field label={`Button corners (${cashbookSettings.button_radius}px)`}><input type="range" min="0" max="24" value={cashbookSettings.button_radius} onChange={(event) => setCashbookSettings((current) => ({ ...current, button_radius: Number(event.target.value) }))} className="mt-3 w-full accent-brand-700" /></Field>
        </div>
        {canEditHelperText && <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[190px_minmax(0,1fr)]"><label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={cashbookSettings.show_page_description} onChange={(event) => setCashbookSettings((current) => ({ ...current, show_page_description: event.target.checked }))} />Show page subtitle</label><Field label="Page subtitle"><input value={cashbookSettings.page_description} disabled={!cashbookSettings.show_page_description} onChange={(event) => setCashbookSettings((current) => ({ ...current, page_description: event.target.value }))} className="cashbook-input disabled:bg-slate-100" /></Field></div>
          <div className="grid gap-3 sm:grid-cols-[190px_minmax(0,1fr)]"><label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={cashbookSettings.show_helper_text} onChange={(event) => setCashbookSettings((current) => ({ ...current, show_helper_text: event.target.checked }))} />Show posting helper</label><Field label="Posting helper"><input value={cashbookSettings.helper_text} disabled={!cashbookSettings.show_helper_text} onChange={(event) => setCashbookSettings((current) => ({ ...current, helper_text: event.target.value }))} className="cashbook-input disabled:bg-slate-100" /></Field></div>
        </div>}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">{appearanceMessage && <span className="text-sm text-slate-600">{appearanceMessage}</span>}<button type="button" onClick={() => void saveAppearance()} disabled={savingAppearance} className="app-btn-primary disabled:opacity-50" style={{ backgroundColor: cashbookSettings.primary_color, borderRadius: cashbookSettings.button_radius }}>{savingAppearance ? "Saving..." : "Save appearance"}</button></div>
      </section>}

      <nav className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm" aria-label="Cashbook pages">
        <button type="button" onClick={() => onNavigate(routes.entry)} className={view === "entry" ? "app-btn-primary" : "app-btn-secondary"}>Cashbook Entry</button>
        <button type="button" onClick={() => onNavigate(routes.register)} className={view === "register" ? "app-btn-primary" : "app-btn-secondary"}>Cashbook Register</button>
        <button type="button" onClick={() => onNavigate(routes.daily)} className={view === "daily" ? "app-btn-primary" : "app-btn-secondary"}>Daily Summary</button>
      </nav>

      {warning && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 print:hidden"><span>{warning}</span>{warning.includes("page limit") && <button type="button" className="app-btn-secondary" onClick={()=>setRowLimit(limit=>limit+2000)}>Load 2,000 more per source</button>}</div>}
      {queuedDrafts.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><span><strong>{queuedDrafts.length}</strong> offline transaction{queuedDrafts.length === 1 ? "" : "s"} waiting for controlled posting.</span><button type="button" disabled={!online} onClick={() => resumeQueuedDraft(queuedDrafts[0])} className="app-btn-secondary disabled:opacity-50">Resume next</button></div>}

      {view === "entry" && <section id="cashbook-entry" className="rounded-2xl border-2 bg-white p-4 shadow-sm sm:p-6" style={{ borderColor: cashbookSettings.accent_color }}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider" style={{ color: cashbookSettings.primary_color }}>Cash Book entry</p><h2 className="mt-1 text-xl font-bold text-slate-900">Post on this page</h2>{cashbookSettings.show_helper_text && <p className="mt-1 text-sm text-slate-600">{cashbookSettings.helper_text}</p>}</div><button type="button" onClick={toggleComments} className="app-btn-secondary" style={{ borderRadius: cashbookSettings.button_radius }}>Comments: {showComments ? "On" : "Off"}</button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <button type="button" onClick={() => isSchool ? onNavigate(SCHOOL_PAGE.payments) : openEntryFor("sale")} className="flex items-center gap-3 border bg-emerald-50 px-4 py-3 text-left font-semibold text-emerald-900 transition hover:-translate-y-0.5 hover:shadow-md" style={{ borderColor: cashbookSettings.accent_color, borderRadius: cashbookSettings.button_radius }}><span className="rounded-lg bg-emerald-100 p-2"><ShoppingCart className="h-5 w-5" /></span><span>{isSchool?"Receive school fees":"Record sale"}<small className="block font-normal text-emerald-700">{isSchool?"Student fee collection":"Customer income"}</small></span></button>
          <button type="button" onClick={() => isSchool || isMicrofinance ? openEntryFor("purchase") : onNavigate("purchases_bills", { cashPurchaseOpen: true })} className="flex items-center gap-3 border border-amber-200 bg-amber-50 px-4 py-3 text-left font-semibold text-amber-900 transition hover:-translate-y-0.5 hover:shadow-md" style={{ borderRadius: cashbookSettings.button_radius }}><span className="rounded-lg bg-amber-100 p-2"><PackagePlus className="h-5 w-5" /></span><span>{isSchool || isMicrofinance ? "Record purchase" : "Cash stock purchase"}<small className="block font-normal text-amber-700">Receive stock & pay supplier</small></span></button>
          <button type="button" onClick={() => openEntryFor("transfer")} className="flex items-center gap-3 border border-blue-200 bg-blue-50 px-4 py-3 text-left font-semibold text-blue-900 transition hover:-translate-y-0.5 hover:shadow-md" style={{ borderRadius: cashbookSettings.button_radius }}><span className="rounded-lg bg-blue-100 p-2"><ArrowLeftRight className="h-5 w-5" /></span><span>Transfer funds<small className="block font-normal text-blue-700">Cash, bank or MOMO</small></span></button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Transaction date"><input type="date" value={sheetEntry.transactionDate} onChange={(e) => setSheetEntry((v) => ({ ...v, transactionDate: e.target.value }))} className="cashbook-input" /></Field>
          <Field label="Project"><select value={sheetEntry.headquarters} onChange={(e) => setSheetEntry((v) => ({ ...v, headquarters: e.target.value }))} className="cashbook-input"><option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.name}>{project.code ? `${project.code} - ` : ""}{project.name}</option>)}</select></Field>
          <Field label="Payment method"><select value={sheetEntry.paymentMethod} onChange={(e) => setSheetEntry((v) => ({ ...v, paymentMethod: e.target.value }))} className="cashbook-input"><option value="cash">Cash</option><option value="mobile_money">MOMO / mobile money</option><option value="bank_transfer">Bank</option><option value="card">Card</option><option value="wallet">Wallet</option></select></Field>
          <Field label="Reference"><input value={sheetEntry.reference} onChange={(e) => setSheetEntry((v) => ({ ...v, reference: e.target.value }))} placeholder="Receipt or voucher number" className="cashbook-input" /></Field>
          <Field label="Description"><input value={sheetEntry.description} onChange={(e) => setSheetEntry((v) => ({ ...v, description: e.target.value }))} placeholder="Transaction details" className="cashbook-input" /></Field>
          {showComments && <Field label="Comments"><textarea value={sheetEntry.comments} onChange={(e) => setSheetEntry((v) => ({ ...v, comments: e.target.value }))} rows={2} placeholder="Optional internal comment" className="cashbook-input" /></Field>}
          <Field label="Supplier"><select value={sheetEntry.supplier} onChange={(e) => setSheetEntry((v) => ({ ...v, supplier: e.target.value }))} className="cashbook-input"><option value="">No supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.name}>{supplier.name}</option>)}</select></Field>
          <Field label="Customer"><select value={sheetEntry.customer} onChange={(e) => setSheetEntry((v) => ({ ...v, customer: e.target.value }))} className="cashbook-input"><option value="">No customer</option>{customers.map((customer) => <option key={customer.id} value={customer.name}>{customer.name}</option>)}</select></Field>
          <Field label="GL account"><GlAccountPicker value={sheetEntry.counterpartGlId} onChange={(id) => setSheetEntry((v) => ({ ...v, counterpartGlId: id }))} options={counterpartGlOptions} placeholder="Type account name or code, e.g. sta" emptyOption={{ label: "Select income, expense or balance account" }} /></Field>
          <Field label="Cash / bank GL"><GlAccountPicker value={sheetEntry.cashGlId} onChange={(id) => setSheetEntry((v) => ({ ...v, cashGlId: id }))} options={cashGlOptions} placeholder="Type cash, bank or mobile account" emptyOption={{ label: "Select account receiving or paying" }} /></Field>
          <Field label="Cash In"><input type="number" min="0" value={sheetEntry.cashIn} onChange={(e) => setSheetEntry((v) => ({ ...v, cashIn: e.target.value, cashOut: e.target.value ? "" : v.cashOut }))} className="cashbook-input" /></Field>
          <Field label="Cash Out"><input type="number" min="0" value={sheetEntry.cashOut} onChange={(e) => setSheetEntry((v) => ({ ...v, cashOut: e.target.value, cashIn: e.target.value ? "" : v.cashIn }))} className="cashbook-input" /></Field>
          <div className="flex items-end"><button type="button" disabled={postingEntry || !online} onClick={() => void postSheetEntry()} className="app-btn-primary w-full justify-center disabled:opacity-50" style={{ backgroundColor: cashbookSettings.primary_color, borderRadius: cashbookSettings.button_radius }}>{postingEntry ? "Posting…" : "Post cashbook entry"}</button></div>
        </div>
        {entryMessage && <p className={`mt-3 rounded-lg p-3 text-sm ${entryMessage.startsWith("Cashbook entry posted") ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{entryMessage}</p>}
      </section>}

      {view === "register" && <section className="grid gap-3 sm:grid-cols-3">
        <Metric label="Cash in" value={money.format(totals.cashIn)} tone="in" />
        <Metric label="Cash out" value={money.format(totals.cashOut)} tone="out" />
        <Metric label="Net movement" value={money.format(totals.cashIn - totals.cashOut)} tone="net" />
      </section>}

      {view === "daily" && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-wider text-brand-700">Daily summary</p><h2 className="mt-1 text-xl font-bold text-slate-900">Day position</h2></div>
          <div className="flex items-end gap-2"><label className="text-xs font-semibold text-slate-600">Summary date<input type="date" value={summaryDate} onChange={(event) => setSummaryDate(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label><button type="button" onClick={() => window.print()} className="app-btn-secondary"><Printer className="h-4 w-4" />Print</button></div>
        </div>
        {channelPositions.length > 0 && <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{channelPositions.map(position=><SummaryMetric key={position.channel} label={`${readable(position.channel)} closing`} value={money.format(position.closing)} tone={position.closing<0?"negative":"positive"}/>)}</div>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <SummaryMetric label="Opening GL balance" value={glPosition ? money.format(glPosition.opening) : "Not available"} />
          <SummaryMetric label="Cash in" value={money.format(daily.cashIn)} tone="positive" />
          <SummaryMetric label="Cash out" value={money.format(daily.cashOut)} tone="negative" />
          <SummaryMetric label="Register movement" value={money.format(daily.net)} tone={daily.net < 0 ? "negative" : "positive"} />
          <SummaryMetric label="Closing GL balance" value={glPosition ? money.format(glPosition.closing) : "Not available"} tone={glPosition && glPosition.closing < 0 ? "negative" : "positive"} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <SummaryMetric label="Entries" value={String(daily.rows)} />
          <SummaryMetric label="Receipts" value={String(daily.receipts)} />
          <SummaryMetric label="Payments" value={String(daily.payments)} />
        </div>
        {glPosition && Math.abs(glPosition.movement - daily.net) > 0.01 && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">The posted GL moved by {money.format(glPosition.movement)} while this operational register moved by {money.format(daily.net)}. Review unposted, omitted, or journal-only transactions.</p>}
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wide text-white"><tr><th className="px-3 py-3 text-left">Details</th><th className="px-3 py-3 text-left">Trx Date</th><th className="px-3 py-3 text-right">MOMO</th><th className="px-3 py-3 text-right">Bank / wallet</th><th className="px-3 py-3 text-right">Cash In</th><th className="px-3 py-3 text-right">Cash Out</th><th className="px-3 py-3 text-right">Channel balance</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50 font-semibold"><td className="px-3 py-2">Balance b/f</td><td className="px-3 py-2">{summaryDate}</td><td /><td /><td /><td /><td className="px-3 py-2 text-right">{glPosition ? money.format(glPosition.opening) : "—"}</td></tr>
              {dailyLines.map((row) => <tr key={`daily:${row.id}`}><td className="px-3 py-2"><span className="font-medium text-slate-900">{row.description}</span><span className="block text-xs text-slate-500">{row.party} · {readable(row.channel)}</span></td><td className="px-3 py-2">{row.date}</td><SignedCell value={row.momo} /><SignedCell value={row.bank} /><AmountCell value={row.physicalIn} tone="in" /><AmountCell value={row.physicalOut} tone="out" /><td className="px-3 py-2 text-right font-semibold">{money.format(row.channelBalance)}</td></tr>)}
              {dailyLines.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No entries for this date.</td></tr>}
            </tbody>
            <tfoot className="border-t-2 border-slate-300 bg-brand-50 font-bold"><tr><td className="px-3 py-3">Daily totals</td><td className="px-3 py-3">{dailyLines.length} entries</td><SignedCell value={dailyLines.reduce((s,r) => s+r.momo,0)} /><SignedCell value={dailyLines.reduce((s,r) => s+r.bank,0)} /><AmountCell value={dailyLines.reduce((s,r) => s+r.physicalIn,0)} tone="in" /><AmountCell value={dailyLines.reduce((s,r) => s+r.physicalOut,0)} tone="out" /><td className="px-3 py-3 text-right">{glPosition ? money.format(glPosition.closing) : "—"}</td></tr></tfoot>
          </table>
        </div>
      </section>}

      {view === "register" && <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap justify-end gap-2 border-b border-slate-200 p-3 print:hidden"><button type="button" onClick={exportCsv} className="app-btn-secondary"><Download className="h-4 w-4" />CSV</button><button type="button" onClick={exportExcel} className="app-btn-secondary"><FileSpreadsheet className="h-4 w-4" />Excel</button><button type="button" onClick={exportPdf} className="app-btn-secondary"><FileText className="h-4 w-4" />PDF</button><button type="button" onClick={() => window.print()} className="app-btn-secondary"><Printer className="h-4 w-4" />Print</button></div>
        <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-[160px_160px_170px_minmax(220px,1fr)]">
          <label className="text-xs font-semibold text-slate-600">From<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-semibold text-slate-600">To<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-semibold text-slate-600">Direction<select value={direction} onChange={(event) => setDirection(event.target.value as "all" | CashbookDirection)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"><option value="all">Cash in and out</option><option value="in">Cash in</option><option value="out">Cash out</option></select></label>
          <label className="text-xs font-semibold text-slate-600">Search<div className="relative mt-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Description, party, method or reference" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm font-normal" /></div></label>
        </div>

        <div className="overflow-x-auto">
          <table className="boat-mobile-card-table w-full min-w-[1120px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3 text-left">Trx date</th><th className="px-4 py-3 text-left">Description / GL</th><th className="px-4 py-3 text-left">Customer / supplier</th><th className="px-4 py-3 text-left">Pay method</th><th className="px-4 py-3 text-left">Reference / headquarters</th><th className="px-4 py-3 text-right">Cash in</th><th className="px-4 py-3 text-right">Cash out</th><th className="px-4 py-3 text-left">Status / audit</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">Loading cashbook…</td></tr> : filteredRows.length === 0 ? <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">No cash movements match these filters.</td></tr> : filteredRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.date || "—"}</td>
                  <td className="px-4 py-3"><div className="font-semibold text-slate-900">{row.description}</div>{showComments && row.comments && <div className="mt-1 text-xs italic text-slate-500">{row.comments}</div>}<div className="mt-0.5 text-xs text-slate-500">{row.glAccount || row.source.replaceAll("_", " ")}</div></td>
                  <td className="px-4 py-3 text-slate-700">{row.party}</td>
                  <td className="px-4 py-3 capitalize text-slate-700">{row.method}</td>
                  <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs text-slate-600" title={row.reference}>{row.reference}<span className="mt-1 block font-sans text-[10px] text-slate-400">{row.headquarters || "—"}</span></td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-emerald-700">{row.cashIn ? money.format(row.cashIn) : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-rose-700">{row.cashOut ? money.format(row.cashOut) : "—"}</td>
                  <td className="px-4 py-3"><span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs capitalize text-slate-700">{row.approvalStatus || row.status}</span><div className="mt-2 flex flex-wrap gap-1">{row.source === "cashbook_entry" && canControlEntries ? <><button title="Correct" onClick={()=>void controlDirectEntry(row,"correct")} className="rounded p-1 text-brand-700 hover:bg-brand-50"><Pencil className="h-4 w-4" /></button><button title="Void" onClick={()=>void controlDirectEntry(row,"void")} className="rounded p-1 text-rose-700 hover:bg-rose-50"><Ban className="h-4 w-4" /></button>{(row.approvalStatus||"pending") === "pending" && row.createdBy !== user?.id && <button title="Approve" onClick={()=>void controlDirectEntry(row,"approve")} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><CheckCircle2 className="h-4 w-4" /></button>}</> : <button type="button" onClick={() => reviewRow(row)} className="text-xs font-semibold text-brand-700 hover:underline">Review source</button>}</div><span className="mt-1 block text-[10px] text-slate-500">{row.submittedBy || "BOAT workflow"}{row.postedAt ? ` · ${new Date(row.postedAt).toLocaleString()}` : ""}</span><span className="mt-1 block font-mono text-[9px] text-slate-400" title="Source audit identifier">{row.id}</span></td>
                </tr>
              ))}
            </tbody>
            {!loading && filteredRows.length > 0 && <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold"><tr><td colSpan={5} className="px-4 py-3 text-right text-slate-700">Filtered totals · {filteredRows.length} entries</td><td className="whitespace-nowrap px-4 py-3 text-right text-emerald-700">{money.format(totals.cashIn)}</td><td className="whitespace-nowrap px-4 py-3 text-right text-rose-700">{money.format(totals.cashOut)}</td><td /></tr></tfoot>}
          </table>
        </div>
      </section>}

      {entryOpen && <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/35" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEntryOpen(false); }}>
        <aside className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Add cashbook transaction">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4"><div><p className="text-xs font-bold uppercase tracking-wider text-brand-700">Cashbook quick entry</p><h2 className="text-xl font-bold text-slate-900">Add transaction</h2></div><button type="button" onClick={() => setEntryOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button></div>
          <div className="space-y-5 p-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(["money_in", "money_out", "sale", "purchase", "transfer"] as EntryType[]).map((type) => <button key={type} type="button" onClick={() => setDraft((current) => ({ ...current, type, party: "", productId: "", productName: "", quantity: "", unitCost: "", amount: "" }))} className={`rounded-lg border px-3 py-2 text-sm font-semibold capitalize ${draft.type === type ? "border-brand-700 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{type.replaceAll("_", " ")}</button>)}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Transaction date"><input type="date" value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} className="cashbook-input" /></Field>
              <Field label="Payment method"><select value={draft.method} onChange={(event) => setDraft((current) => ({ ...current, method: event.target.value }))} className="cashbook-input"><option value="cash">Cash</option><option value="mtn_mobile_money">MTN Mobile Money</option><option value="airtel_money">Airtel Money</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="wallet">Wallet</option></select></Field>
            </div>
            {draft.type === "money_in" || draft.type === "sale" ? <Field label="Customer"><select value={draft.party} onChange={(event) => setDraft((current) => ({ ...current, party: event.target.value }))} className="cashbook-input"><option value="">Select customer</option>{customers.map((customer) => <option key={customer.id} value={customer.name}>{customer.name}</option>)}</select></Field> : draft.type === "money_out" || draft.type === "purchase" ? <Field label="Supplier / payee"><select value={draft.party} onChange={(event) => setDraft((current) => ({ ...current, party: event.target.value }))} className="cashbook-input"><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.name}>{supplier.name}</option>)}</select></Field> : <Field label="From / to account"><input value={draft.party} onChange={(event) => setDraft((current) => ({ ...current, party: event.target.value }))} placeholder="Account transfer description" className="cashbook-input" /></Field>}
            {(draft.type === "purchase" || draft.type === "sale") && <div className="grid gap-4 sm:grid-cols-3 sm:col-span-2">
              <Field label="Inventory product *"><select value={draft.productId} onChange={(event) => { const product = inventoryProducts.find((item) => item.id === event.target.value); const price = product ? String(Number(draft.type === "sale" ? product.sales_price || 0 : product.cost_price || 0)) : ""; setDraft((current) => ({ ...current, productId: product?.id || "", productName: product?.name || "", unitCost: price, description: current.description || product?.name || "", amount: current.quantity && price ? String(Number(current.quantity) * Number(price)) : current.amount })); }} className="cashbook-input"><option value="">Select stock item</option>{inventoryProducts.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.unit_of_measure || "unit"})</option>)}</select></Field>
              <Field label={draft.type === "sale" ? "Quantity sold *" : "Quantity received *"}><input type="number" min="0" step="0.001" value={draft.quantity} onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value, amount: current.unitCost ? String(Number(event.target.value) * Number(current.unitCost)) : current.amount }))} className="cashbook-input" /></Field>
              <Field label={draft.type === "sale" ? "Unit selling price (UGX)" : "Unit cost (UGX)"}><input type="number" min="0" step="0.01" value={draft.unitCost} onChange={(event) => setDraft((current) => ({ ...current, unitCost: event.target.value, amount: current.quantity ? String(Number(current.quantity) * Number(event.target.value)) : current.amount }))} className="cashbook-input" /></Field>
            </div>}
            <Field label="Project"><select value={draft.project || ""} onChange={(event) => setDraft((current) => ({ ...current, project: event.target.value }))} className="cashbook-input"><option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.name}>{project.code ? `${project.code} - ` : ""}{project.name}</option>)}</select></Field>
            <Field label="Description"><textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} rows={3} placeholder="What was this transaction for?" className="cashbook-input" /></Field>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Amount (UGX)"><input type="number" min="0" step="1" value={draft.amount} readOnly={draft.type === "purchase" || draft.type === "sale"} onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))} className={`cashbook-input ${(draft.type === "purchase" || draft.type === "sale") ? "bg-slate-50" : ""}`} /></Field><Field label="Reference"><input value={draft.reference} onChange={(event) => setDraft((current) => ({ ...current, reference: event.target.value }))} placeholder="Receipt, invoice or transfer ref" className="cashbook-input" /></Field></div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{draft.type === "purchase" ? "One posting will receive stock, create the supplier bill and record payment." : draft.type === "sale" ? "One posting will record the sale, reduce stock and receive customer payment." : "BOAT will open the relevant controlled workflow to complete this transaction."}</div>
            {!online && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Offline: save this transaction to the device queue. It will still pass through BOAT's controlled posting workflow when resumed online.</div>}
            {draftError && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{draftError}</p>}
          </div>
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4"><button type="button" onClick={() => setEntryOpen(false)} disabled={postingQuickTransaction} className="app-btn-secondary">Cancel</button><button type="button" onClick={() => void continueEntry()} disabled={postingQuickTransaction} className="app-btn-primary disabled:opacity-60">{postingQuickTransaction ? "Posting…" : !online ? "Save to offline queue" : draft.type === "purchase" ? "Receive stock & pay" : draft.type === "sale" ? "Complete sale & receive" : "Continue to posting"}</button></div>
        </aside>
      </div>}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "in" | "out" | "net" }) {
  const Icon = tone === "in" ? ArrowDownRight : tone === "out" ? ArrowUpRight : BookOpen;
  const color = tone === "in" ? "text-emerald-700 bg-emerald-100" : tone === "out" ? "text-rose-700 bg-rose-100" : "text-brand-700 bg-brand-100";
  return <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p></div><span className={`rounded-xl p-3 ${color}`}><Icon className="h-5 w-5" /></span></div>;
}

function SummaryMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "neutral" }) {
  const color = tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-rose-700" : "text-slate-900";
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-lg font-bold ${color}`}>{value}</p></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-semibold text-slate-700">{label}<div className="mt-1">{children}</div></label>;
}

function SignedCell({ value }: { value: number }) {
  return <td className={`px-3 py-2 text-right font-semibold ${value > 0 ? "text-emerald-700" : value < 0 ? "text-rose-700" : "text-slate-400"}`}>{value ? money.format(value) : "—"}</td>;
}

function AmountCell({ value, tone }: { value: number; tone: "in" | "out" }) {
  return <td className={`px-3 py-2 text-right font-semibold ${value ? tone === "in" ? "text-emerald-700" : "text-rose-700" : "text-slate-400"}`}>{value ? money.format(value) : "—"}</td>;
}
