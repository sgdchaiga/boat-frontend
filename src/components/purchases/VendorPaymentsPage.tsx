import { Fragment, useEffect, useState, useRef, useCallback, useMemo } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, CreditCard, Download, Pencil, Plus, Printer, Undo2, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { createJournalForExpenseWithLines, createJournalForVendorPayment, deleteJournalEntryByReference, reverseJournalEntriesByReference, type ExpenseJournalLineInput, type VendorPaymentJournalAllocation } from "../../lib/journal";
import { isBillApproved, parseBillAllocationsJson, syncBillStatusInDb } from "../../lib/billStatus";
import { buildStoragePath, uploadSourceDocument, type SourceDocumentRef } from "../../lib/sourceDocuments";
import { useAuth } from "../../contexts/AuthContext";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";
import { PageNotes } from "../common/PageNotes";
import { SourceDocumentsCell } from "../common/SourceDocumentsCell";
import { SearchableCombobox } from "../common/SearchableCombobox";
import { SchoolFilterBar, type SchoolFilterChip } from "../common/SchoolFilterBar";

interface VendorPayment {
  id: string;
  vendor_id?: string | null;
  bill_id?: string | null;
  bill_allocations?: unknown;
  source_documents?: unknown;
  amount?: number | null;
  payment_date?: string | null;
  payment_method?: string | null;
  cheque_number?: string | null;
  payment_voucher?: string | null;
  bank_name?: string | null;
  import_batch_id?: string | null;
  import_fingerprint?: string | null;
  import_vote?: string | null;
  import_subvote?: string | null;
  reference?: string | null;
  created_at?: string;
  status?: "active" | "reversed" | null;
  reversed_at?: string | null;
  reversal_reason?: string | null;
  vendors?: { name: string } | null;
}

type ReclassificationAccount = { id: string; account_code: string; account_name: string; account_type: string };
type BankAccount = { id: string; account_code: string; account_name: string; category?: string | null };
type ReclassificationSubvote = { id: string; subvote_code: string; subvote_name: string; default_gl_account_id: string | null };
type ReclassificationDraft = {
  payment: VendorPayment;
  destination: "expense" | "petty_cash";
  description: string;
  reason: string;
  expenseGlId: string;
  sourceGlId: string;
  subvoteId: string;
};

function isPettyCashAccount(account: ReclassificationAccount): boolean {
  return /petty cash|imprest|cash drawer|cash on hand|\bfloat\b|\btill\b|\bsafe\b/i.test(`${account.account_name} ${account.account_code}`);
}

/** Lines applied to bills for this payment (legacy single bill or JSON allocations). */
function getVendorPaymentAllocationLines(p: VendorPayment): { bill_id: string; amount: number }[] {
  if (p.status === "reversed") return [];
  const alloc = parseBillAllocationsJson(p.bill_allocations);
  if (alloc.length > 0) return alloc;
  if (p.bill_id) return [{ bill_id: p.bill_id, amount: Number(p.amount) || 0 }];
  return [];
}

type OutstandingBill = {
  id: string;
  amount: number;
  balance: number;
  bill_date: string | null;
  due_date: string | null;
  description: string | null;
  invoice_number: string | null;
  vendors?: { name: string } | null;
};

interface VendorPaymentsPageProps {
  payBillId?: string;
  payVendorId?: string;
  highlightVendorPaymentId?: string;
  readOnly?: boolean;
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
}

function formatSupabaseError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const err = e as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [err.message, err.details, err.hint].filter(Boolean);
    if (parts.length) return parts.join(" — ");
    if (err.code) return `Code ${err.code}`;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function supplierPaymentBatchId(payment: VendorPayment | string | null | undefined): string | null {
  if (payment && typeof payment !== "string" && payment.import_batch_id) return payment.import_batch_id.trim() || null;
  const reference = typeof payment === "string" ? payment : payment?.reference;
  return reference?.match(/\[BATCH:([^\]]+)\]/i)?.[1]?.trim() || null;
}

function referenceWithBank(reference: string | null | undefined, bankName: string): string {
  const withoutBank = String(reference || "").replace(/\s*\/?\s*Bank:\s*[^/\[]+/gi, "").replace(/\s*\/\s*$/, "").trim();
  return bankName.trim() ? [withoutBank, `Bank: ${bankName.trim()}`].filter(Boolean).join(" / ") : withoutBank;
}

function bankNameFromPayment(payment: VendorPayment): string {
  return payment.bank_name?.trim() || payment.reference?.match(/(?:^|\/\s*)Bank:\s*([^/\[]+)/i)?.[1]?.trim() || "";
}

type PaymentColumn = "date" | "recorded" | "vendor" | "method" | "bank" | "cheque" | "voucher" | "vote" | "subvote" | "reference" | "amount" | "documents";
const paymentColumns: Array<{ id: PaymentColumn; label: string }> = [
  { id: "date", label: "Date" }, { id: "recorded", label: "Recorded at" }, { id: "vendor", label: "Vendor" },
  { id: "method", label: "Method" }, { id: "bank", label: "Bank name" }, { id: "cheque", label: "Cheque no." },
  { id: "voucher", label: "PV no." }, { id: "vote", label: "Vote" }, { id: "subvote", label: "Subvote" }, { id: "reference", label: "Reference" }, { id: "amount", label: "Amount" }, { id: "documents", label: "Documents" },
];

export function VendorPaymentsPage({
  payBillId,
  payVendorId,
  highlightVendorPaymentId,
  readOnly = false,
  onNavigate,
}: VendorPaymentsPageProps = {}) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const isAdmin = user?.role === "admin" || user?.role === "super_admin" || user?.isSuperAdmin === true;
  const isSuperAdmin = user?.role === "super_admin" || user?.isSuperAdmin === true;
  const [payments, setPayments] = useState<VendorPayment[]>([]);
  const paymentRequestRef = useRef(0);
  const [paymentPage, setPaymentPage] = useState(0);
  const paymentPageSize = 100;
  const [paymentTotalCount, setPaymentTotalCount] = useState(0);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [vendorId, setVendorId] = useState("");
  /** Per-bill allocation amounts (string for inputs); omitted or empty = not applied */
  const [allocationInputs, setAllocationInputs] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "bank_transfer" | "wallet">("bank_transfer");
  const [bankName, setBankName] = useState("");
  const [reference, setReference] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [paymentVoucher, setPaymentVoucher] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingPayment, setEditingPayment] = useState<VendorPayment | null>(null);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<string[]>([]);
  const [bulkReversing, setBulkReversing] = useState(false);
  const [bulkReverseProgress, setBulkReverseProgress] = useState({ completed: 0, total: 0 });
  const [sortBy, setSortBy] = useState<"payment_date" | "created_at" | "vendor" | "payment_method" | "reference" | "amount">("payment_date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [showReversedPayments, setShowReversedPayments] = useState(false);
  const [vendorFilter, setVendorFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [fromDateFilter, setFromDateFilter] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [bankFilter, setBankFilter] = useState("");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<PaymentColumn>>(() => new Set<PaymentColumn>(["date", "vendor", "method", "bank", "cheque", "voucher", "reference", "amount", "documents"]));
  const [columnOrder, setColumnOrder] = useState<PaymentColumn[]>(() => paymentColumns.map((column) => column.id));
  const [batchEdit, setBatchEdit] = useState<{ id: string; paymentDate: string; paymentMethod: "" | "cash" | "card" | "bank_transfer" | "wallet"; bankName: string } | null>(null);
  const [batchEditing, setBatchEditing] = useState(false);
  const [batchEditProgress, setBatchEditProgress] = useState({ completed: 0, total: 0 });
  const vendorPaymentInFlightRef = useRef(false);
  const [outstandingBills, setOutstandingBills] = useState<OutstandingBill[]>([]);
  const [loadingBills, setLoadingBills] = useState(false);
  const hasOpenedForPayBillRef = useRef(false);
  /** Payment selected to show allocation / line details in a modal */
  const [detailPayment, setDetailPayment] = useState<VendorPayment | null>(null);
  const [reclassifyDraft, setReclassifyDraft] = useState<ReclassificationDraft | null>(null);
  const [reclassifying, setReclassifying] = useState(false);
  const [reclassificationAccounts, setReclassificationAccounts] = useState<ReclassificationAccount[]>([]);
  const [reclassificationSubvotes, setReclassificationSubvotes] = useState<ReclassificationSubvote[]>([]);
  const [detailBillMeta, setDetailBillMeta] = useState<
    Record<string, { description: string | null; bill_date: string | null }>
  >({});

  const loadOutstandingBills = useCallback(async (venId: string, excludePaymentId?: string | null) => {
    if (!venId) {
      setOutstandingBills([]);
      return;
    }
    setLoadingBills(true);
    try {
      const { data: bills, error: bErr } = await supabase
        .from("bills")
        .select("id, amount, due_date, bill_date, description, invoice_number, approved_at, status, vendors(name)")
        .eq("vendor_id", venId)
        .order("bill_date", { ascending: false });
      if (bErr) throw bErr;
      const rows = (bills || []) as unknown as Array<{
        id: string;
        amount: number;
        due_date: string | null;
        bill_date: string | null;
        description: string | null;
        invoice_number: string | null;
        approved_at: string | null;
        status: string | null;
        vendors?: { name: string } | null;
      }>;
      const ids = rows.map((r) => r.id);
      const paidByBill = new Map<string, number>();
      let vpQuery = supabase
        .from("vendor_payments")
        .select("bill_id, amount, bill_allocations")
        .eq("vendor_id", venId);
      if (excludePaymentId) vpQuery = vpQuery.neq("id", excludePaymentId);
      let vpRes = await vpQuery;
      if (vpRes.error && String(vpRes.error.message || "").toLowerCase().includes("bill_allocations")) {
        let fallbackQuery = supabase.from("vendor_payments").select("bill_id, amount").eq("vendor_id", venId);
        if (excludePaymentId) fallbackQuery = fallbackQuery.neq("id", excludePaymentId);
        vpRes = (await fallbackQuery) as typeof vpRes;
      } else if (vpRes.error) throw vpRes.error;

      for (const p of vpRes.data || []) {
        const row = p as { bill_id: string | null; amount?: number; bill_allocations?: unknown };
        const bid = row.bill_id;
        if (bid && ids.includes(bid)) {
          paidByBill.set(bid, (paidByBill.get(bid) || 0) + Number(row.amount || 0));
        }
        for (const s of parseBillAllocationsJson(row.bill_allocations)) {
          if (ids.includes(s.bill_id)) {
            paidByBill.set(s.bill_id, (paidByBill.get(s.bill_id) || 0) + s.amount);
          }
        }
      }

      if (ids.length > 0) {
        const alRes = await supabase.from("vendor_payment_bill_allocations").select("vendor_payment_id,bill_id, amount").in("bill_id", ids);
        if (!alRes.error) {
          for (const p of alRes.data || []) {
            if (excludePaymentId && (p as { vendor_payment_id?: string }).vendor_payment_id === excludePaymentId) continue;
            const bid = (p as { bill_id: string }).bill_id;
            paidByBill.set(bid, (paidByBill.get(bid) || 0) + Number((p as { amount?: number }).amount || 0));
          }
        }
      }

      const out: OutstandingBill[] = [];
      for (const b of rows) {
        if (!isBillApproved(b)) continue;
        const paid = paidByBill.get(b.id) || 0;
        const amt = Number(b.amount || 0);
        const balance = Math.max(0, amt - paid);
        if (balance <= 0.001) continue;
        out.push({
          id: b.id,
          amount: amt,
          balance,
          bill_date: b.bill_date,
          due_date: b.due_date,
          description: b.description,
          invoice_number: b.invoice_number,
          vendors: b.vendors,
        });
      }
      setOutstandingBills(out);
    } catch (e) {
      console.error("Outstanding bills:", e);
      setOutstandingBills([]);
    } finally {
      setLoadingBills(false);
    }
  }, []);

  useEffect(() => {
    if (!payBillId) hasOpenedForPayBillRef.current = false;
  }, [payBillId]);

  useEffect(() => {
    void fetchData();
  }, [orgId, paymentPage, vendorFilter, methodFilter, bankFilter, batchFilter, fromDateFilter, toDateFilter, searchFilter]);

  useEffect(() => {
    setPaymentPage(0);
  }, [vendorFilter, methodFilter, bankFilter, batchFilter, fromDateFilter, toDateFilter, searchFilter]);

  useEffect(() => {
    if (!showModal || !vendorId) {
      if (!showModal) setOutstandingBills([]);
      return;
    }
    void loadOutstandingBills(vendorId, editingPayment?.id);
  }, [showModal, vendorId, editingPayment?.id, loadOutstandingBills]);

  useEffect(() => {
    if (!payBillId || !payVendorId || hasOpenedForPayBillRef.current) return;
    hasOpenedForPayBillRef.current = true;
    void (async () => {
      setVendorId(payVendorId);
      await loadOutstandingBills(payVendorId);
      setAllocationInputs((prev) => ({ ...prev, [payBillId]: prev[payBillId] ?? "" }));
      setShowModal(true);
    })();
  }, [payBillId, payVendorId, loadOutstandingBills]);

  useEffect(() => {
    if (!highlightVendorPaymentId || loading) return;
    const payment = payments.find((row) => row.id === highlightVendorPaymentId);
    if (payment) setDetailPayment(payment);
  }, [highlightVendorPaymentId, loading, payments]);

  useEffect(() => {
    if (!detailPayment) {
      setDetailBillMeta({});
      return;
    }
    const lines = getVendorPaymentAllocationLines(detailPayment);
    const ids = [...new Set(lines.map((l) => l.bill_id))];
    if (ids.length === 0) {
      setDetailBillMeta({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.from("bills").select("id, description, bill_date").in("id", ids);
      if (cancelled || error) return;
      const map: Record<string, { description: string | null; bill_date: string | null }> = {};
      for (const b of data || []) {
        const row = b as { id: string; description: string | null; bill_date: string | null };
        map[row.id] = { description: row.description, bill_date: row.bill_date };
      }
      if (!cancelled) setDetailBillMeta(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [detailPayment]);

  const fetchData = async () => {
    const requestId = ++paymentRequestRef.current;
    setLoading(true);
    try {
      let paymentsQuery = supabase.from("vendor_payments").select("*, vendors(name)", { count: "exact" }).order("payment_date", { ascending: false });
      if (orgId) paymentsQuery = paymentsQuery.eq("organization_id", orgId);
      if (vendorFilter) paymentsQuery = paymentsQuery.eq("vendor_id", vendorFilter);
      if (methodFilter) paymentsQuery = paymentsQuery.eq("payment_method", methodFilter);
      if (fromDateFilter) paymentsQuery = paymentsQuery.gte("payment_date", fromDateFilter);
      if (toDateFilter) paymentsQuery = paymentsQuery.lte("payment_date", toDateFilter);
      // Keep historical payments filterable until their import metadata
      // migration has run: older rows retain these values in Reference.
      if (bankFilter) paymentsQuery = paymentsQuery.or(`bank_name.eq.${bankFilter},reference.ilike.*Bank: ${bankFilter}*`);
      if (batchFilter) paymentsQuery = paymentsQuery.or(`import_batch_id.eq.${batchFilter},reference.ilike.*[BATCH:${batchFilter}]*`);
      if (searchFilter.trim()) paymentsQuery = paymentsQuery.ilike("reference", `%${searchFilter.trim()}%`);
       const [payRes, venRes, accountsRes] = await Promise.all([
        paymentsQuery.range(paymentPage * paymentPageSize, paymentPage * paymentPageSize + paymentPageSize - 1),
        supabase.from("vendors").select("id, name").order("name"),
         orgId
           ? supabase
             .from("gl_accounts")
             .select("id,account_code,account_name,category")
             .eq("organization_id", orgId)
             .eq("is_active", true)
             .order("account_code")
           : Promise.resolve({ data: [], error: null }),
      ]);
      if (requestId !== paymentRequestRef.current) return;
      if (payRes.error) throw payRes.error;
      setPayments(payRes.data || []);
      setPaymentTotalCount(payRes.count || 0);
      setVendors(venRes.data || []);
       if (accountsRes.error) throw accountsRes.error;
       // Bank accounts are maintained in the chart of accounts. Category alone is not
       // sufficient because the school chart also uses "cash" for petty cash and wallets.
       setBankAccounts(
         ((accountsRes.data || []) as BankAccount[]).filter((account) =>
           /\bbank\b/i.test(`${account.account_code} ${account.account_name}`),
         ),
       );
    } catch (e) {
      if (requestId !== paymentRequestRef.current) return;
      console.error("Error fetching vendor payments:", e);
      setPayments([]);
      setPaymentTotalCount(0);
    } finally {
      if (requestId === paymentRequestRef.current) setLoading(false);
    }
  };

  const sumAllocated = useMemo(() => {
    let s = 0;
    for (const b of outstandingBills) {
      const raw = allocationInputs[b.id]?.trim();
      if (!raw) continue;
      const v = parseFloat(raw);
      if (!isNaN(v) && v > 0) s += v;
    }
    return s;
  }, [outstandingBills, allocationInputs]);

  const bankAccountOptions = useMemo(() => {
    const options = bankAccounts.map((account) => ({
      id: account.id,
      label: `${account.account_code} — ${account.account_name}`,
    }));
    // Keep a historic saved value visible when editing, but require the user to
    // choose an active chart account before it can be saved again.
    if (bankName && !options.some((option) => option.id === bankName)) {
      options.unshift({ id: bankName, label: `${bankName} (not in Chart of Accounts)` });
    }
    return options;
  }, [bankAccounts, bankName]);

  const fillPaymentAcrossBills = () => {
    const total = parseFloat(amount);
    if (isNaN(total) || total <= 0) {
      alert("Enter a valid payment amount first.");
      return;
    }
    let remaining = total;
    const next: Record<string, string> = { ...allocationInputs };
    for (const b of outstandingBills) {
      if (remaining <= 0) {
        next[b.id] = "";
        continue;
      }
      const apply = Math.min(b.balance, remaining);
      next[b.id] = apply.toFixed(2);
      remaining -= apply;
    }
    setAllocationInputs(next);
  };

  const clearBillAllocations = () => {
    const cleared: Record<string, string> = {};
    for (const b of outstandingBills) cleared[b.id] = "";
    setAllocationInputs(cleared);
  };

  const resetForm = () => {
    setShowModal(false);
    setEditingPayment(null);
    setVendorId("");
    setAllocationInputs({});
    setAmount("");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentMethod("bank_transfer");
    setBankName("");
    setReference("");
    setChequeNumber("");
    setPaymentVoucher("");
    setAttachmentFiles([]);
    setOutstandingBills([]);
  };

  const loadPaymentAllocationLines = async (payment: VendorPayment): Promise<{ bill_id: string; amount: number }[]> => {
    const byBill = new Map<string, number>();
    if (payment.bill_id) byBill.set(payment.bill_id, Number(payment.amount || 0));
    parseBillAllocationsJson(payment.bill_allocations).forEach((line) => byBill.set(line.bill_id, Math.max(byBill.get(line.bill_id) || 0, line.amount)));
    const { data } = await supabase
      .from("vendor_payment_bill_allocations")
      .select("bill_id,amount")
      .eq("vendor_payment_id", payment.id);
    (data || []).forEach((line: { bill_id: string; amount: number }) =>
      byBill.set(line.bill_id, Math.max(byBill.get(line.bill_id) || 0, Number(line.amount || 0)))
    );
    return [...byBill.entries()].map(([bill_id, lineAmount]) => ({ bill_id, amount: lineAmount }));
  };

  const openEdit = async (payment: VendorPayment) => {
    if (!isAdmin || readOnly || payment.status === "reversed" || !payment.vendor_id) return;
    const lines = await loadPaymentAllocationLines(payment);
    setEditingPayment(payment);
    setVendorId(payment.vendor_id);
    setAmount(String(payment.amount || ""));
    setPaymentDate(payment.payment_date || new Date().toISOString().slice(0, 10));
    setPaymentMethod((payment.payment_method as "cash" | "card" | "bank_transfer" | "wallet") || "bank_transfer");
    const savedBankName = bankNameFromPayment(payment);
    setBankName(bankAccounts.find((account) => account.account_name === savedBankName)?.id || savedBankName);
    setReference((payment.reference || "").replace(/\s*\/?\s*Bank:\s*[^/\[]+/gi, "").replace(/\s*\[(?:IMP|BATCH):[^\]]+\]/gi, "").replace(/\s*\/\s*$/, "").trim());
    setChequeNumber(payment.cheque_number || payment.reference?.match(/\bCHQ\s*(?:NO\.?\s*)?([^/\[]+)/i)?.[1]?.trim() || "");
    setPaymentVoucher(payment.payment_voucher || payment.reference?.match(/\bPV\s*(?:NO\.?\s*)?([^/\[]+)/i)?.[1]?.trim() || "");
    setAllocationInputs(Object.fromEntries(lines.map((line) => [line.bill_id, line.amount.toFixed(2)])));
    await loadOutstandingBills(payment.vendor_id, payment.id);
    setShowModal(true);
  };

  const handleReverse = async (payment: VendorPayment) => {
    if (!isAdmin || readOnly || payment.status === "reversed") return;
    const reason = window.prompt("Reason for reversing this supplier payment:");
    if (!reason?.trim()) return;
    if (!window.confirm("Reverse this payment? Its bill allocations and cash/payable journal will be reversed.")) return;
    setReversingId(payment.id);
    try {
      const oldLines = await loadPaymentAllocationLines(payment);
      const journal = await reverseJournalEntriesByReference("vendor_payment", payment.id, user?.id ?? null, reason.trim());
      if (!journal.ok) throw new Error(journal.error);
      await supabase.from("vendor_payment_bill_allocations").delete().eq("vendor_payment_id", payment.id);
      const { error } = await supabase.from("vendor_payments").update({
        status: "reversed",
        reversed_at: new Date().toISOString(),
        reversed_by: user?.id ?? null,
        reversal_reason: reason.trim(),
        bill_id: null,
        bill_allocations: [],
      }).eq("id", payment.id);
      if (error) throw error;
      await Promise.all([...new Set(oldLines.map((line) => line.bill_id))].map((id) => syncBillStatusInDb(id)));
      setDetailPayment(null);
      await fetchData();
    } catch (e) {
      alert("Failed to reverse payment: " + formatSupabaseError(e));
    } finally {
      setReversingId(null);
    }
  };

  const openReclassify = async (payment: VendorPayment) => {
    if (!isSuperAdmin || readOnly || payment.status === "reversed" || !orgId) return;
    try {
      const [accountsResult, subvotesResult] = await Promise.all([
        supabase.from("gl_accounts").select("id,account_code,account_name,account_type").eq("organization_id", orgId).eq("is_active", true).order("account_code"),
        supabase.from("school_budget_subvotes").select("id,subvote_code,subvote_name,default_gl_account_id").eq("organization_id", orgId).eq("is_active", true).order("subvote_code"),
      ]);
      if (accountsResult.error) throw accountsResult.error;
      // Subvotes are optional for a direct expense and may not be enabled in older school databases.
      setReclassificationAccounts((accountsResult.data || []) as ReclassificationAccount[]);
      setReclassificationSubvotes(subvotesResult.error ? [] : (subvotesResult.data || []) as ReclassificationSubvote[]);
      setReclassifyDraft({
        payment,
        destination: "expense",
        description: payment.reference?.replace(/\s*\[(?:IMP|BATCH):[^\]]+\]/gi, "").trim() || `Reclassified supplier payment — ${payment.vendors?.name || "vendor"}`,
        reason: "",
        expenseGlId: "",
        sourceGlId: "",
        subvoteId: "",
      });
    } catch (error) {
      alert("Unable to prepare reclassification: " + formatSupabaseError(error));
    }
  };

  const completeReclassification = async () => {
    if (!reclassifyDraft || !orgId || !user?.id || reclassifying) return;
    const draft = reclassifyDraft;
    const payment = draft.payment;
    const amountValue = Number(payment.amount || 0);
    if (!draft.reason.trim() || !draft.description.trim() || !draft.expenseGlId || !draft.sourceGlId || amountValue <= 0) {
      alert("Enter a reason, description, expense account, source account, and a valid amount.");
      return;
    }
    if (draft.destination === "petty_cash" && !isPettyCashAccount(reclassificationAccounts.find((account) => account.id === draft.sourceGlId) || { id: "", account_code: "", account_name: "", account_type: "" })) {
      alert("Select a petty-cash, imprest, till, float, or cash-on-hand account.");
      return;
    }
    if (!window.confirm(`Reclassify this supplier payment as ${draft.destination === "petty_cash" ? "a petty-cash entry" : "an expense"}? The original payment will be reversed and linked to the replacement.`)) return;

    setReclassifying(true);
    let replacementId: string | null = null;
    try {
      const linkReference = `${payment.reference || "Supplier payment"} [RECLASSIFIED FROM:vendor_payment:${payment.id}]`;
      if (draft.destination === "expense") {
        const { data: expense, error: expenseError } = await supabase.from("expenses").insert({
          organization_id: orgId,
          vendor_id: payment.vendor_id || null,
          amount: amountValue,
          description: draft.description.trim(),
          expense_date: payment.payment_date || new Date().toISOString().slice(0, 10),
        }).select("id").single();
        if (expenseError || !expense) throw expenseError || new Error("Expense creation did not return an ID.");
        replacementId = expense.id;
        const line = {
          expense_id: expense.id,
          expense_gl_account_id: draft.expenseGlId,
          source_cash_gl_account_id: draft.sourceGlId,
          amount: amountValue,
          bank_charges: 0,
          vat_amount: 0,
          vat_gl_account_id: null,
          bank_charges_gl_account_id: null,
          comment: linkReference,
          quantity: 1,
          sort_order: 0,
          vendor_id: payment.vendor_id || null,
          ...(draft.subvoteId ? { school_subvote_id: draft.subvoteId } : {}),
        };
        const { error: lineError } = await supabase.from("expense_lines").insert(line);
        if (lineError) throw lineError;
        const journal = await createJournalForExpenseWithLines(expense.id, payment.payment_date || new Date().toISOString().slice(0, 10), [line as ExpenseJournalLineInput], user.id);
        if (!journal.ok) throw new Error(journal.error);
      } else {
        const { data, error } = await (supabase as any).rpc("post_school_cashbook_entry", {
          p_organization_id: orgId,
          p_transaction_date: payment.payment_date || new Date().toISOString().slice(0, 10),
          p_headquarters: "",
          p_payment_method: "cash",
          p_description: draft.description.trim(),
          p_supplier_name: payment.vendors?.name || "",
          p_customer_name: "",
          p_counterpart_gl_account_id: draft.expenseGlId,
          p_cash_gl_account_id: draft.sourceGlId,
          p_cash_in: 0,
          p_cash_out: amountValue,
          p_reference: linkReference,
          p_subvote_id: draft.subvoteId || null,
        });
        if (error || !data) throw error || new Error("Petty-cash entry creation did not return an ID.");
        replacementId = String(data);
      }

      const oldLines = await loadPaymentAllocationLines(payment);
      const reversal = await reverseJournalEntriesByReference("vendor_payment", payment.id, user.id, `Reclassified to ${draft.destination}: ${draft.reason.trim()}`);
      if (!reversal.ok) throw new Error(reversal.error);
      await supabase.from("vendor_payment_bill_allocations").delete().eq("vendor_payment_id", payment.id);
      const update = await supabase.from("vendor_payments").update({
        status: "reversed", reversed_at: new Date().toISOString(), reversed_by: user.id,
        reversal_reason: `Reclassified to ${draft.destination}: ${draft.reason.trim()}`,
        bill_id: null, bill_allocations: [],
        reclassified_to_type: draft.destination, reclassified_to_id: replacementId, reclassified_at: new Date().toISOString(), reclassified_by: user.id,
      }).eq("id", payment.id);
      if (update.error && update.error.code !== "PGRST204") throw update.error;
      await Promise.all([...new Set(oldLines.map((line) => line.bill_id))].map((id) => syncBillStatusInDb(id)));
      setReclassifyDraft(null);
      setDetailPayment(null);
      await fetchData();
      if (onNavigate) onNavigate(draft.destination === "petty_cash" ? "school_cashbook_register" : "purchases_expenses", draft.destination === "petty_cash" ? { highlightCashbookEntryId: replacementId } : { highlightExpenseId: replacementId });
    } catch (error) {
      alert("Reclassification failed. The original supplier payment was not intentionally deleted. Check the replacement transaction before trying again: " + formatSupabaseError(error));
    } finally {
      setReclassifying(false);
    }
  };

  const togglePaymentSelection = (paymentId: string) => {
    setSelectedPaymentIds((current) => current.includes(paymentId) ? current.filter((id) => id !== paymentId) : [...current, paymentId]);
  };

  const toggleAllActivePayments = () => {
    const activeIds = payments.filter((payment) => payment.status !== "reversed").map((payment) => payment.id);
    setSelectedPaymentIds((current) => current.length === activeIds.length ? [] : activeIds);
  };

  const handleBulkReverse = async () => {
    if (!isSuperAdmin || readOnly || bulkReversing) return;
    const selected = payments.filter((payment) => selectedPaymentIds.includes(payment.id) && payment.status !== "reversed");
    if (!selected.length) return;
    const reason = window.prompt(`Reason for cancelling ${selected.length} supplier payment${selected.length === 1 ? "" : "s"}:`);
    if (!reason?.trim()) return;
    if (!window.confirm(`Cancel ${selected.length} supplier payment${selected.length === 1 ? "" : "s"}? Their bill allocations and journals will be reversed.`)) return;
    setBulkReversing(true);
    setBulkReverseProgress({ completed: 0, total: selected.length });
    const failures: string[] = [];
    let cancelled = 0;
    try {
      const reverseOne = async (payment: VendorPayment) => {
        try {
          const oldLines = await loadPaymentAllocationLines(payment);
          const journal = await reverseJournalEntriesByReference("vendor_payment", payment.id, user?.id ?? null, reason.trim());
          if (!journal.ok) throw new Error(journal.error);
          // Keep parity with single-payment reversal on older deployments where
          // the optional allocation table has not been installed.
          await supabase.from("vendor_payment_bill_allocations").delete().eq("vendor_payment_id", payment.id);
          const { error } = await supabase.from("vendor_payments").update({
            status: "reversed",
            reversed_at: new Date().toISOString(),
            reversed_by: user?.id ?? null,
            reversal_reason: reason.trim(),
            bill_id: null,
            bill_allocations: [],
          }).eq("id", payment.id);
          if (error) throw error;
          await Promise.all([...new Set(oldLines.map((line) => line.bill_id))].map((id) => syncBillStatusInDb(id)));
          cancelled += 1;
        } catch (error) {
          failures.push(`${payment.reference || payment.id.slice(0, 8)}: ${formatSupabaseError(error)}`);
        } finally {
          setBulkReverseProgress((progress) => ({ ...progress, completed: progress.completed + 1 }));
        }
      };
      const concurrentReversals = 4;
      for (let start = 0; start < selected.length; start += concurrentReversals) {
        await Promise.all(selected.slice(start, start + concurrentReversals).map(reverseOne));
      }
      setSelectedPaymentIds([]);
      await fetchData();
      alert(`Cancelled ${cancelled} payment${cancelled === 1 ? "" : "s"}.${failures.length ? ` ${failures.length} could not be cancelled:\n${failures.slice(0, 5).join("\n")}` : ""}`);
    } finally {
      setBulkReversing(false);
      setBulkReverseProgress({ completed: 0, total: 0 });
    }
  };

  const applyBatchEdit = async () => {
    if (!batchEdit || readOnly || batchEditing) return;
    if (!batchEdit.paymentDate && !batchEdit.paymentMethod && !batchEdit.bankName.trim()) {
      alert("Choose a payment date, payment method, or bank name to update.");
      return;
    }
    if (batchEdit.paymentMethod === "bank_transfer" && !batchEdit.bankName.trim()) {
      alert("Enter a bank name when setting the payment method to Bank Transfer.");
      return;
    }
    const batchPayments = payments.filter((payment) => supplierPaymentBatchId(payment) === batchEdit.id && payment.status !== "reversed");
    if (!batchPayments.length) return;
    if (!window.confirm(`Update ${batchPayments.length} active payment${batchPayments.length === 1 ? "" : "s"} in batch ${batchEdit.id}?`)) return;
    setBatchEditing(true);
    setBatchEditProgress({ completed: 0, total: batchPayments.length });
    const failures: string[] = [];
    try {
      for (const payment of batchPayments) {
        try {
          const paymentDate = batchEdit.paymentDate || payment.payment_date || new Date().toISOString().slice(0, 10);
          const paymentMethod = batchEdit.paymentMethod || payment.payment_method || "bank_transfer";
          const { error } = await supabase.from("vendor_payments").update({ payment_date: paymentDate, payment_method: paymentMethod, bank_name: batchEdit.bankName.trim() || payment.bank_name || null }).eq("id", payment.id);
          if (error) throw error;
          if (batchEdit.paymentDate) {
            const journalUpdate = await supabase.from("journal_entries").update({ entry_date: paymentDate }).eq("reference_type", "vendor_payment").eq("reference_id", payment.id);
            if (journalUpdate.error) throw journalUpdate.error;
          }
        } catch (error) {
          failures.push(`${payment.reference || payment.id.slice(0, 8)}: ${formatSupabaseError(error)}`);
        } finally {
          setBatchEditProgress((progress) => ({ ...progress, completed: progress.completed + 1 }));
        }
      }
      await fetchData();
      if (failures.length) alert(`Batch updated with ${failures.length} issue${failures.length === 1 ? "" : "s"}:\n${failures.slice(0, 5).join("\n")}`);
      else setBatchEdit(null);
    } finally {
      setBatchEditing(false);
      setBatchEditProgress({ completed: 0, total: 0 });
    }
  };

  const handleAdd = async () => {
    if (readOnly) return;
    if (!vendorId) {
      alert("Select a vendor.");
      return;
    }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      alert("Enter a valid amount.");
      return;
    }
    if (paymentMethod === "bank_transfer" && !bankName.trim()) {
      alert("Select the bank account for this bank payment.");
      return;
    }
    if (paymentMethod === "bank_transfer" && !bankAccounts.some((account) => account.id === bankName)) {
      alert("Select an active bank account from the Chart of Accounts.");
      return;
    }

    const lines: { billId: string; amt: number }[] = [];
    for (const b of outstandingBills) {
      const raw = allocationInputs[b.id]?.trim();
      if (!raw) continue;
      const v = parseFloat(raw);
      if (isNaN(v) || v <= 0) continue;
      if (v > b.balance + 0.01) {
        alert(`Amount for a bill cannot exceed its balance (${b.balance.toFixed(2)}).`);
        return;
      }
      lines.push({ billId: b.id, amt: Math.round(v * 100) / 100 });
    }

    const sumAlloc = lines.reduce((s, l) => s + l.amt, 0);
    if (sumAlloc > amt + 0.02) {
      alert("Total allocated to bills cannot exceed the payment amount.");
      return;
    }

    const payableAmount = sumAlloc;
    const unearnedExcessAmount = Math.max(0, Math.round((amt - sumAlloc) * 100) / 100);

    if (unearnedExcessAmount > 0.001) {
      const ok = window.confirm(
        "This excess payment will be recorded under unearned income.\n\nDo you want to continue?"
      );
      if (!ok) return;
    }

    const allocation: VendorPaymentJournalAllocation | undefined =
      unearnedExcessAmount > 0.001 || payableAmount < amt - 0.02
        ? { payableAmount, unearnedExcessAmount }
        : undefined;

    if (vendorPaymentInFlightRef.current) return;
    vendorPaymentInFlightRef.current = true;

    /** One full payment to a single bill — use legacy bill_id (no allocations table). */
    const useLegacySingleBill = lines.length === 1 && unearnedExcessAmount <= 0.001;
    const needsAllocationRows = lines.length > 0 && !useLegacySingleBill;

    setSaving(true);
    try {
      const payDate = paymentDate || new Date().toISOString().slice(0, 10);
      const paymentReference = reference.trim().replace(/\s*\/?\s*Bank:\s*[^/]+/gi, "").replace(/\s*\/\s*$/, "").trim();
      const savePayload: Record<string, unknown> = {
        vendor_id: vendorId,
        bill_id: useLegacySingleBill ? lines[0].billId : null,
        amount: amt,
        payment_date: payDate,
        payment_method: paymentMethod,
        cheque_number: chequeNumber.trim() || null,
        payment_voucher: paymentVoucher.trim() || null,
        bank_name: paymentMethod === "bank_transfer"
          ? bankAccounts.find((account) => account.id === bankName)?.account_name || null
          : null,
        reference: paymentReference || null,
      };
      if (needsAllocationRows) {
        savePayload.bill_allocations = lines.map((l) => ({ bill_id: l.billId, amount: l.amt }));
      } else {
        savePayload.bill_allocations = [];
      }

      const oldLines = editingPayment ? await loadPaymentAllocationLines(editingPayment) : [];
      const saveQuery = editingPayment
        ? supabase.from("vendor_payments").update(savePayload).eq("id", editingPayment.id)
        : supabase.from("vendor_payments").insert(savePayload);
      const { data: inserted, error } = await saveQuery.select("id, payment_date").single();
      if (error) {
        const msg = formatSupabaseError(error);
        if (msg.toLowerCase().includes("bill_allocations")) {
          throw new Error(
            `${msg}\n\nAdd column: run migration 20260325000000_vendor_payments_bill_allocations_jsonb.sql in Supabase SQL Editor.`
          );
        }
        throw error;
      }
      const paymentId = (inserted as { id: string }).id;

      if (editingPayment) {
        await supabase.from("vendor_payment_bill_allocations").delete().eq("vendor_payment_id", paymentId);
        const retired = await deleteJournalEntryByReference("vendor_payment", paymentId, orgId);
        if (!retired.ok) throw new Error(`Payment was updated, but its old journal could not be retired: ${retired.error}`);
      }
      const jr = await createJournalForVendorPayment(
        paymentId,
        amt,
        (inserted as { payment_date: string }).payment_date ?? payDate,
        user?.id ?? null,
        allocation
      );
      if (!jr.ok) {
        alert(`Payment saved but journal was not posted: ${jr.error}`);
      }

      const billIdsToSync = [...new Set([...oldLines.map((line) => line.bill_id), ...lines.map((line) => line.billId)])];
      await Promise.all(billIdsToSync.map((id) => syncBillStatusInDb(id)));

      if (attachmentFiles.length > 0 && orgId) {
        const next: SourceDocumentRef[] = [];
        for (const file of attachmentFiles) {
          const path = buildStoragePath(orgId, "vendor_payments", paymentId, file.name);
          const up = await uploadSourceDocument(file, path);
          if (!up.error) next.push({ path, name: file.name });
        }
        if (next.length) {
          await supabase.from("vendor_payments").update({ source_documents: next }).eq("id", paymentId);
        }
      }

      resetForm();
      fetchData();
    } catch (e) {
      console.error("Error recording payment:", e);
      alert("Failed: " + formatSupabaseError(e));
    } finally {
      vendorPaymentInFlightRef.current = false;
      setSaving(false);
    }
  };

  const paymentNum = parseFloat(amount);
  const showUnearnedHint =
    vendorId && !isNaN(paymentNum) && paymentNum > 0 && sumAllocated < paymentNum - 0.001;
  const showOverHint =
    vendorId && !isNaN(paymentNum) && paymentNum > 0 && sumAllocated > paymentNum + 0.001;

  const filteredPayments = useMemo(() => {
    const search = searchFilter.trim().toLowerCase();
    return payments.filter((payment) => {
      if (!showReversedPayments && payment.status === "reversed") return false;
      if (vendorFilter && payment.vendor_id !== vendorFilter) return false;
      if (methodFilter && payment.payment_method !== methodFilter) return false;
      if (bankFilter && bankNameFromPayment(payment) !== bankFilter) return false;
      if (batchFilter && supplierPaymentBatchId(payment) !== batchFilter) return false;
      if (fromDateFilter && String(payment.payment_date || "") < fromDateFilter) return false;
      if (toDateFilter && String(payment.payment_date || "") > toDateFilter) return false;
      if (search && !`${payment.vendors?.name || ""} ${payment.reference || ""}`.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [payments, showReversedPayments, vendorFilter, methodFilter, bankFilter, batchFilter, fromDateFilter, toDateFilter, searchFilter]);

  const hasPaymentFilters = Boolean(searchFilter.trim() || vendorFilter || methodFilter || bankFilter || batchFilter || fromDateFilter || toDateFilter);
  // Reversed payments remain visible for audit purposes, but never contribute to the active-payment total.
  const filteredPaymentTotal = useMemo(() => filteredPayments
    .filter((payment) => payment.status !== "reversed")
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0), [filteredPayments]);
  const importBatches = useMemo(() => [...new Set(payments.map((payment) => supplierPaymentBatchId(payment)).filter((value): value is string => Boolean(value)))].sort().reverse(), [payments]);
  const paymentBanks = useMemo(() => [...new Set(payments.map(bankNameFromPayment).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [payments]);
  const clearPaymentFilters = () => { setSearchFilter(""); setVendorFilter(""); setMethodFilter(""); setBankFilter(""); setBatchFilter(""); setFromDateFilter(""); setToDateFilter(""); };
  const activePaymentFilters = useMemo<SchoolFilterChip[]>(() => [
    searchFilter.trim() && { key: "search", label: `Search: ${searchFilter.trim()}`, onRemove: () => setSearchFilter("") },
    vendorFilter && { key: "vendor", label: `Supplier: ${vendors.find((vendor) => vendor.id === vendorFilter)?.name || "Selected"}`, onRemove: () => setVendorFilter("") },
    methodFilter && { key: "method", label: `Method: ${methodFilter.replace("_", " ")}`, onRemove: () => setMethodFilter("") },
    bankFilter && { key: "bank", label: `Bank: ${bankFilter}`, onRemove: () => setBankFilter("") },
    batchFilter && { key: "batch", label: `Batch: ${batchFilter}`, onRemove: () => setBatchFilter("") },
    fromDateFilter && { key: "from", label: `From: ${fromDateFilter}`, onRemove: () => setFromDateFilter("") },
    toDateFilter && { key: "to", label: `To: ${toDateFilter}`, onRemove: () => setToDateFilter("") },
  ].filter(Boolean) as SchoolFilterChip[], [searchFilter, vendorFilter, methodFilter, bankFilter, batchFilter, fromDateFilter, toDateFilter, vendors]);

  const sortedPayments = useMemo(() => filteredPayments.slice().sort((left, right) => {
    const vendorName = (payment: VendorPayment) => payment.vendors?.name || "";
    const leftValue = sortBy === "vendor" ? vendorName(left) : sortBy === "amount" ? Number(left.amount || 0) : String(left[sortBy] || "");
    const rightValue = sortBy === "vendor" ? vendorName(right) : sortBy === "amount" ? Number(right.amount || 0) : String(right[sortBy] || "");
    const compared = typeof leftValue === "number" && typeof rightValue === "number" ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" });
    return sortDirection === "asc" ? compared : -compared;
  }), [filteredPayments, sortBy, sortDirection]);
  const paymentPageCount = Math.max(1, Math.ceil(paymentTotalCount / paymentPageSize));
  const paymentRangeStart = paymentTotalCount === 0 ? 0 : paymentPage * paymentPageSize + 1;
  const paymentRangeEnd = Math.min(paymentTotalCount, (paymentPage + 1) * paymentPageSize);

  const changeSort = (column: typeof sortBy) => {
    if (sortBy === column) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else { setSortBy(column); setSortDirection(column === "payment_date" || column === "created_at" || column === "amount" ? "desc" : "asc"); }
  };
  const toggleColumn = (column: PaymentColumn) => setVisibleColumns((current) => {
    const next = new Set(current);
    if (next.has(column)) next.delete(column); else next.add(column);
    return next;
  });
  const moveColumn = (column: PaymentColumn, direction: -1 | 1) => setColumnOrder((current) => {
    const index = current.indexOf(column); const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= current.length) return current;
    const next = [...current]; [next[index], next[destination]] = [next[destination], next[index]];
    return next;
  });
  const orderedVisibleColumns = columnOrder.filter((id) => visibleColumns.has(id)).map((id) => paymentColumns.find((column) => column.id === id)!).filter(Boolean);
  const csvValue = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const columnValue = (payment: VendorPayment, column: PaymentColumn) => {
    if (column === "date") return payment.payment_date || "";
    if (column === "recorded") return payment.created_at || "";
    if (column === "vendor") return payment.vendors?.name || "";
    if (column === "method") return (payment.payment_method || "").replace("_", " ");
    if (column === "bank") return bankNameFromPayment(payment);
    if (column === "cheque") return payment.cheque_number || payment.reference?.match(/\bCHQ\s*(?:NO\.?\s*)?([^/\[]+)/i)?.[1]?.trim() || "";
    if (column === "voucher") return payment.payment_voucher || payment.reference?.match(/\bPV\s*(?:NO\.?\s*)?([^/\[]+)/i)?.[1]?.trim() || "";
    if (column === "vote") return payment.import_vote || "";
    if (column === "subvote") return payment.import_subvote || "";
    if (column === "reference") return payment.reference || "";
    if (column === "amount") return Number(payment.amount || 0).toFixed(2);
    return "";
  };
  const exportPayments = () => {
    const columns = orderedVisibleColumns.filter((column) => column.id !== "documents");
    const csv = [columns.map((column) => csvValue(column.label)).join(","), ...sortedPayments.map((payment) => columns.map((column) => csvValue(columnValue(payment, column.id))).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "supplier-payments.csv"; link.click(); URL.revokeObjectURL(url);
  };
  const printPayments = () => {
    const columns = orderedVisibleColumns.filter((column) => column.id !== "documents");
    const escape = (value: unknown) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] || character);
    const page = window.open("", "_blank", "noopener,noreferrer");
    if (!page) return alert("Allow pop-ups to print the supplier-payment register.");
    page.document.write(`<!doctype html><title>Supplier payments</title><style>body{font-family:Arial;padding:24px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:7px;text-align:left}th{background:#f1f5f9}h1{font-size:20px}</style><h1>Supplier payments</h1><p>Filtered total: ${escape(filteredPaymentTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}))}</p><table><thead><tr>${columns.map((column) => `<th>${escape(column.label)}</th>`).join("")}</tr></thead><tbody>${sortedPayments.map((payment) => `<tr>${columns.map((column) => `<td>${escape(columnValue(payment, column.id))}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
    page.document.close(); page.focus(); page.print();
  };

  const sortHeader = (column: typeof sortBy, label: string, align: "left" | "right" = "left") => <th className={`p-0 text-${align}`}><button type="button" onClick={() => changeSort(column)} className={`inline-flex w-full items-center gap-1 px-3 py-3 font-semibold hover:bg-slate-100 ${align === "right" ? "justify-end" : "justify-start"}`}><span>{label}</span>{sortBy === column ? sortDirection === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />}</button></th>;
  const renderPaymentHeader = (column: PaymentColumn) => {
    if (column === "date") return sortHeader("payment_date", "Date");
    if (column === "vendor") return sortHeader("vendor", "Vendor");
    if (column === "method") return sortHeader("payment_method", "Method");
    if (column === "reference") return sortHeader("reference", "Reference");
    if (column === "amount") return sortHeader("amount", "Amount", "right");
    return <th className={`p-3 text-left ${column === "documents" ? "min-w-20" : "whitespace-nowrap"}`}>{paymentColumns.find((item) => item.id === column)?.label}</th>;
  };
  const renderPaymentCell = (payment: VendorPayment, column: PaymentColumn) => {
    if (column === "date") return <td className="p-3 whitespace-nowrap">{payment.payment_date ? new Date(payment.payment_date).toLocaleDateString() : "—"}</td>;
    if (column === "recorded") return <td className="p-3 whitespace-nowrap text-xs text-slate-600">{payment.created_at ? new Date(payment.created_at).toLocaleString() : "—"}</td>;
    if (column === "vendor") return <td className="p-3 min-w-40">{payment.vendor_id && onNavigate ? <button type="button" className="block max-w-56 truncate text-left font-medium text-brand-700 hover:underline" onClick={() => onNavigate("purchases_vendors", { highlightVendorId: payment.vendor_id })}>{payment.vendors?.name || "—"}</button> : payment.vendors?.name || "—"}</td>;
    if (column === "method") return <td className="p-3 whitespace-nowrap capitalize">{(payment.payment_method || "—").replace("_", " ")}</td>;
    if (column === "bank") return <td className="p-3 min-w-44 whitespace-nowrap">{bankNameFromPayment(payment) || "—"}</td>;
    if (column === "cheque") return <td className="p-3 whitespace-nowrap">{columnValue(payment, "cheque") || "—"}</td>;
    if (column === "voucher") return <td className="p-3 whitespace-nowrap">{columnValue(payment, "voucher") || "—"}</td>;
    if (column === "vote") return <td className="p-3 min-w-48">{payment.import_vote || "—"}</td>;
    if (column === "subvote") return <td className="p-3 min-w-48">{payment.import_subvote || "—"}</td>;
    if (column === "reference") return <td className="p-3 min-w-64 max-w-96"><p className="break-words" title={payment.reference || "—"}>{payment.reference || "—"}</p>{supplierPaymentBatchId(payment) && <p className="mt-1 text-xs font-medium text-indigo-700">Batch: {supplierPaymentBatchId(payment)}</p>}{payment.status === "reversed" && <p className="text-xs font-semibold text-rose-700">Reversed</p>}</td>;
    if (column === "amount") return <td className="p-3 whitespace-nowrap text-right"><button type="button" className="font-semibold text-brand-700 hover:underline tabular-nums" title="View payment line details" onClick={() => setDetailPayment(payment)}>{Number(payment.amount || 0).toFixed(2)}</button></td>;
    return <td className="p-3 align-top"><SourceDocumentsCell table="vendor_payments" recordId={payment.id} organizationId={orgId} rawDocuments={payment.source_documents} readOnly={readOnly} onUpdated={fetchData} /></td>;
  };

  return (
    <div className="p-6 md:p-8">
      {readOnly && <ReadOnlyNotice />}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Payments Made</h1>
            <PageNotes ariaLabel="Vendor payments help">
              <p>Record and track payments to vendors — one payment can clear several bills.</p>
            </PageNotes>
          </div>
        </div>
        <div className="flex items-center gap-2"><button type="button" onClick={() => setShowReversedPayments((show) => !show)} className="app-btn-secondary text-sm">{showReversedPayments ? "Hide reversed" : "Show reversed"}</button><button
          type="button"
          onClick={() => !readOnly && setShowModal(true)}
          disabled={readOnly}
          className="app-btn-primary disabled:cursor-not-allowed"
        >
          <Plus className="w-5 h-5" /> Record Payment
        </button></div>
      </div>

      <SchoolFilterBar
        search={<input value={searchFilter} onChange={(event) => setSearchFilter(event.target.value)} placeholder="Search vendor or reference" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />}
        period={<><input type="date" aria-label="Payments from date" value={fromDateFilter} onChange={(event) => setFromDateFilter(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /><span className="text-sm text-slate-400">to</span><input type="date" aria-label="Payments to date" value={toDateFilter} onChange={(event) => setToDateFilter(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></>}
        activeFilters={activePaymentFilters}
        onClearAll={clearPaymentFilters}
        resultSummary={<>Showing {paymentRangeStart}–{paymentRangeEnd} of {paymentTotalCount} payments</>}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-medium text-slate-600">Supplier<select value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">All suppliers</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label>
          <label className="text-xs font-medium text-slate-600">Payment method<select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">All methods</option>{[...new Set(payments.map((payment) => payment.payment_method).filter(Boolean))].sort().map((method) => <option key={method} value={method!}>{String(method).replace("_", " ")}</option>)}</select></label>
          <label className="text-xs font-medium text-slate-600">Bank<select value={bankFilter} onChange={(event) => setBankFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">All banks</option>{paymentBanks.map((bank) => <option key={bank} value={bank}>{bank}</option>)}</select></label>
          <label className="text-xs font-medium text-slate-600">Upload batch<select value={batchFilter} onChange={(event) => setBatchFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">All upload batches</option>{importBatches.map((batch) => <option key={batch} value={batch}>{batch}</option>)}</select></label>
        </div>
      </SchoolFilterBar>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">Showing {paymentRangeStart}–{paymentRangeEnd} of {paymentTotalCount} supplier payment{paymentTotalCount === 1 ? "" : "s"} · Page total: <span className="font-semibold tabular-nums text-slate-700">{filteredPaymentTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></p><div className="flex flex-wrap gap-2">{batchFilter && isAdmin && !readOnly && <button type="button" onClick={() => setBatchEdit({ id: batchFilter, paymentDate: "", paymentMethod: "", bankName: "" })} className="app-btn-secondary text-sm">Edit batch {batchFilter}</button>}<button type="button" onClick={() => setShowColumnPicker((open) => !open)} className="app-btn-secondary text-sm"><Columns3 className="h-4 w-4" />Columns</button><button type="button" onClick={exportPayments} className="app-btn-secondary text-sm"><Download className="h-4 w-4" />Export CSV</button><button type="button" onClick={printPayments} className="app-btn-secondary text-sm"><Printer className="h-4 w-4" />Print</button></div></div>
      {showColumnPicker && <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"><p className="mb-2 font-medium text-slate-700">Show columns and set their left-to-right order:</p><div className="flex flex-wrap gap-2">{columnOrder.map((id, index) => { const column = paymentColumns.find((item) => item.id === id)!; return <div key={id} className="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1.5"><label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={visibleColumns.has(id)} onChange={() => toggleColumn(id)} />{column.label}</label><button type="button" aria-label={`Move ${column.label} left`} disabled={index === 0} onClick={() => moveColumn(id, -1)} className="ml-1 rounded px-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30">←</button><button type="button" aria-label={`Move ${column.label} right`} disabled={index === columnOrder.length - 1} onClick={() => moveColumn(id, 1)} className="rounded px-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30">→</button></div>; })}</div></div>}

      {isSuperAdmin && !readOnly && selectedPaymentIds.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <div><p className="text-sm font-medium text-rose-900">{selectedPaymentIds.length} supplier payment{selectedPaymentIds.length === 1 ? "" : "s"} selected</p>{bulkReversing && bulkReverseProgress.total > 0 && <div className="mt-2 w-64 max-w-full"><div className="mb-1 flex justify-between text-xs text-rose-800"><span>Cancelling payments…</span><span>{bulkReverseProgress.completed} / {bulkReverseProgress.total}</span></div><div className="h-2 overflow-hidden rounded-full bg-rose-200"><div className="h-full bg-rose-700 transition-all" style={{ width: `${Math.round(bulkReverseProgress.completed / bulkReverseProgress.total * 100)}%` }} /></div></div>}</div>
          <div className="flex gap-2"><button type="button" onClick={() => setSelectedPaymentIds([])} disabled={bulkReversing} className="app-btn-secondary">Clear selection</button><button type="button" onClick={() => void handleBulkReverse()} disabled={bulkReversing} className="inline-flex items-center gap-2 rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-50"><Undo2 className="h-4 w-4" />{bulkReversing ? "Cancelling…" : "Cancel selected"}</button></div>
        </div>
      )}

      {loading ? (
        <p className="text-slate-500 py-4">Loading…</p>
      ) : (
        <>
        <div className="app-card overflow-x-auto">
          <table className="min-w-max text-sm">
            <thead className="bg-slate-50">
              <tr>
                {isSuperAdmin && !readOnly && <th className="p-3 text-left"><input type="checkbox" aria-label="Select all active supplier payments" checked={payments.filter((payment) => payment.status !== "reversed").length > 0 && selectedPaymentIds.length === payments.filter((payment) => payment.status !== "reversed").length} onChange={toggleAllActivePayments} /></th>}
                {orderedVisibleColumns.map((column) => <Fragment key={column.id}>{renderPaymentHeader(column.id)}</Fragment>)}
                <th className="w-24 p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedPayments.map((p) => (
                <tr
                  key={p.id}
                  className={`border-t ${p.status === "reversed" ? "bg-rose-50/60 text-slate-500" : ""} ${highlightVendorPaymentId === p.id ? "bg-amber-50 ring-2 ring-inset ring-amber-300/80" : ""}`}
                >
                  {isSuperAdmin && !readOnly && <td className="p-3"><input type="checkbox" aria-label={`Select payment ${p.reference || p.id}`} disabled={p.status === "reversed" || bulkReversing} checked={selectedPaymentIds.includes(p.id)} onChange={() => togglePaymentSelection(p.id)} /></td>}
                  {orderedVisibleColumns.map((column) => <Fragment key={column.id}>{renderPaymentCell(p, column.id)}</Fragment>)}
                  <td className="p-3 text-right">
                    {isAdmin && !readOnly && p.status !== "reversed" && (
                      <span className="inline-flex gap-1">
                        <button type="button" onClick={() => void openEdit(p)} className="rounded p-1.5 text-slate-600 hover:bg-slate-100" title="Edit payment">
                          <Pencil className="h-4 w-4" />
                        </button>
                        {isSuperAdmin && <button type="button" onClick={() => void openReclassify(p)} className="rounded px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50" title="Reclassify to expense or petty cash">Reclassify</button>}
                        <button type="button" onClick={() => void handleReverse(p)} disabled={reversingId === p.id} className="rounded p-1.5 text-rose-700 hover:bg-rose-50 disabled:opacity-50" title="Reverse payment">
                          <Undo2 className="h-4 w-4" />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sortedPayments.length === 0 && <p className="p-8 text-center text-slate-500">{payments.length === 0 ? "No payments recorded yet." : hasPaymentFilters ? "No supplier payments match these filters. Clear or adjust the search, supplier, method, or date range." : !showReversedPayments ? "No active payments. Show reversed payments to view the audit trail." : "No supplier payments to display."}</p>}
        </div>
        {paymentTotalCount > paymentPageSize && <div className="mt-4 flex items-center justify-between gap-3"><p className="text-sm text-slate-600">Page {paymentPage + 1} of {paymentPageCount}</p><div className="flex gap-2"><button type="button" disabled={paymentPage === 0 || loading} onClick={() => setPaymentPage((page) => Math.max(0, page - 1))} className="app-btn-secondary disabled:opacity-50">Previous</button><button type="button" disabled={paymentPage >= paymentPageCount - 1 || loading} onClick={() => setPaymentPage((page) => Math.min(paymentPageCount - 1, page + 1))} className="app-btn-secondary disabled:opacity-50">Next</button></div></div>}
        </>
      )}

      {detailPayment && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
          onClick={() => setDetailPayment(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start gap-3 mb-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Payment details</h2>
                <p className="text-xs text-slate-500 font-mono mt-1">{detailPayment.id}</p>
              </div>
              <button type="button" onClick={() => setDetailPayment(null)} className="p-1 text-slate-500 hover:text-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-4">
              <dt className="text-slate-500">Date</dt>
              <dd className="font-medium text-slate-900">
                {detailPayment.payment_date ? new Date(detailPayment.payment_date).toLocaleDateString() : "—"}
              </dd>
              <dt className="text-slate-500">Vendor</dt>
              <dd className="font-medium text-slate-900">{detailPayment.vendors?.name || "—"}</dd>
              <dt className="text-slate-500">Method</dt>
              <dd className="capitalize text-slate-900">{(detailPayment.payment_method || "—").replace("_", " ")}</dd>
              <dt className="text-slate-500">Reference</dt>
              <dd className="text-slate-900">{detailPayment.reference || "—"}</dd>
              <dt className="text-slate-500">Total</dt>
              <dd className="font-semibold tabular-nums text-slate-900">{Number(detailPayment.amount || 0).toFixed(2)}</dd>
              <dt className="text-slate-500">Status</dt>
              <dd className={detailPayment.status === "reversed" ? "font-semibold text-rose-700" : "font-semibold text-emerald-700"}>
                {detailPayment.status === "reversed" ? "Reversed" : "Active"}
              </dd>
              {detailPayment.status === "reversed" && detailPayment.reversal_reason && (
                <>
                  <dt className="text-slate-500">Reversal reason</dt>
                  <dd className="text-rose-700">{detailPayment.reversal_reason}</dd>
                </>
              )}
            </dl>
            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-2">Applied to bills (line items)</h3>
              {(() => {
                const lines = getVendorPaymentAllocationLines(detailPayment);
                const allocated = lines.reduce((s, l) => s + l.amount, 0);
                const unallocated = Math.max(0, Number(detailPayment.amount) - allocated);
                if (lines.length === 0) {
                  return (
                    <p className="text-sm text-slate-600">
                      No bill split recorded — full payment is treated as unallocated (e.g. unearned / on-account).
                    </p>
                  );
                }
                return (
                  <>
                    <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="text-left p-2 font-medium">Bill / GRN</th>
                          <th className="text-left p-2 font-medium">Date</th>
                          <th className="text-right p-2 font-medium">Applied</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line, idx) => {
                          const meta = detailBillMeta[line.bill_id];
                          return (
                            <tr key={`${line.bill_id}-${idx}`} className="border-t border-slate-100">
                              <td className="p-2 align-top">
                                <span className="font-mono text-xs">
                                  {line.bill_id.slice(0, 8)}…
                                </span>
                                {meta?.description ? (
                                  <p className="text-slate-700 mt-0.5 line-clamp-2">{meta.description}</p>
                                ) : null}
                                {onNavigate ? (
                                  <button
                                    type="button"
                                    className="text-xs text-brand-700 hover:underline mt-1"
                                    onClick={() => {
                                      setDetailPayment(null);
                                      onNavigate("purchases_bills", { highlightBillId: line.bill_id });
                                    }}
                                  >
                                    Open in Bills
                                  </button>
                                ) : null}
                              </td>
                              <td className="p-2 whitespace-nowrap">
                                {meta?.bill_date ? new Date(meta.bill_date).toLocaleDateString() : "—"}
                              </td>
                              <td className="p-2 text-right tabular-nums font-medium">{line.amount.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {unallocated > 0.01 ? (
                      <p className="text-xs text-amber-800 mt-2">
                        Unallocated on this payment: <span className="font-semibold tabular-nums">{unallocated.toFixed(2)}</span>{" "}
                        (on-account / unearned portion)
                      </p>
                    ) : null}
                  </>
                );
              })()}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              {isAdmin && !readOnly && detailPayment.status !== "reversed" && (
                <>
                  <button type="button" className="app-btn-secondary" onClick={() => { const payment = detailPayment; setDetailPayment(null); void openEdit(payment); }}>
                    <Pencil className="h-4 w-4" /> Edit
                  </button>
                  {isSuperAdmin && <button type="button" className="app-btn-secondary" onClick={() => { const payment = detailPayment; setDetailPayment(null); void openReclassify(payment); }}>Reclassify</button>}
                  <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50" onClick={() => void handleReverse(detailPayment)}>
                    <Undo2 className="h-4 w-4" /> Reverse
                  </button>
                </>
              )}
              <button type="button" className="app-btn-secondary" onClick={() => setDetailPayment(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {reclassifyDraft && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => !reclassifying && setReclassifyDraft(null)}><div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">Reclassify supplier payment</h2><p className="mt-1 text-sm text-slate-500">Original payment: {Number(reclassifyDraft.payment.amount || 0).toLocaleString()} · {reclassifyDraft.payment.vendors?.name || "Unknown vendor"}</p></div><button type="button" disabled={reclassifying} onClick={() => setReclassifyDraft(null)} className="text-slate-500 hover:text-slate-800"><X className="h-5 w-5" /></button></div>
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This creates the replacement first, then reverses the supplier payment and its journal. The original remains in the audit trail.</div>
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-slate-700">Destination<select value={reclassifyDraft.destination} onChange={(event) => setReclassifyDraft({ ...reclassifyDraft, destination: event.target.value as "expense" | "petty_cash", sourceGlId: "" })} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="expense">Expense</option><option value="petty_cash">Petty-cash entry</option></select></label>
          <label className="block text-sm font-medium text-slate-700">Description<input value={reclassifyDraft.description} onChange={(event) => setReclassifyDraft({ ...reclassifyDraft, description: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="block text-sm font-medium text-slate-700">Expense account<SearchableCombobox value={reclassifyDraft.expenseGlId} onChange={(expenseGlId) => setReclassifyDraft({ ...reclassifyDraft, expenseGlId })} options={reclassificationAccounts.filter((account) => account.account_type === "expense").map((account) => ({ id: account.id, label: `${account.account_code} — ${account.account_name}` }))} placeholder="Type to find an expense account…" emptyOption={{ label: "Select expense account" }} inputAriaLabel="Search expense account" clearable /></label>
          <label className="block text-sm font-medium text-slate-700">{reclassifyDraft.destination === "petty_cash" ? "Petty-cash account" : "Source of funds"}<SearchableCombobox value={reclassifyDraft.sourceGlId} onChange={(sourceGlId) => setReclassifyDraft({ ...reclassifyDraft, sourceGlId })} options={reclassificationAccounts.filter((account) => reclassifyDraft.destination !== "petty_cash" || isPettyCashAccount(account)).map((account) => ({ id: account.id, label: `${account.account_code} — ${account.account_name}` }))} placeholder={reclassifyDraft.destination === "petty_cash" ? "Type to find petty cash…" : "Type to find source of funds…"} emptyOption={{ label: "Select source account" }} inputAriaLabel="Search source of funds" clearable /></label>
          {reclassificationSubvotes.length > 0 && <label className="block text-sm font-medium text-slate-700">Subvote (optional)<SearchableCombobox value={reclassifyDraft.subvoteId} onChange={(subvoteId) => { const subvote = reclassificationSubvotes.find((item) => item.id === subvoteId); setReclassifyDraft({ ...reclassifyDraft, subvoteId, expenseGlId: subvote?.default_gl_account_id || reclassifyDraft.expenseGlId }); }} options={reclassificationSubvotes.map((subvote) => ({ id: subvote.id, label: `${subvote.subvote_code} — ${subvote.subvote_name}` }))} placeholder="Type to find a subvote…" emptyOption={{ label: "No subvote" }} inputAriaLabel="Search subvote" clearable /></label>}
          <label className="block text-sm font-medium text-slate-700">Reason for reclassification<textarea value={reclassifyDraft.reason} onChange={(event) => setReclassifyDraft({ ...reclassifyDraft, reason: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2" placeholder="Why was the original transaction type incorrect?" /></label>
        </div>
        <div className="mt-6 flex justify-end gap-2"><button type="button" disabled={reclassifying} onClick={() => setReclassifyDraft(null)} className="app-btn-secondary">Cancel</button><button type="button" disabled={reclassifying} onClick={() => void completeReclassification()} className="app-btn-primary">{reclassifying ? "Reclassifying…" : "Create replacement and reverse original"}</button></div>
      </div></div>}

      {batchEdit && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => !batchEditing && setBatchEdit(null)}><div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">Edit imported batch</h2><p className="mt-1 text-sm text-slate-500">{batchEdit.id} · {payments.filter((payment) => supplierPaymentBatchId(payment) === batchEdit.id && payment.status !== "reversed").length} active payment(s)</p></div><button type="button" onClick={() => !batchEditing && setBatchEdit(null)} className="text-slate-500 hover:text-slate-800"><X className="h-5 w-5" /></button></div><p className="mt-4 text-sm text-slate-600">Leave a field blank to keep its current value across the batch.</p><div className="mt-4 space-y-3"><label className="block text-sm font-medium text-slate-700">Payment date<input type="date" value={batchEdit.paymentDate} onChange={(event) => setBatchEdit({ ...batchEdit, paymentDate: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="block text-sm font-medium text-slate-700">Payment method<select value={batchEdit.paymentMethod} onChange={(event) => setBatchEdit({ ...batchEdit, paymentMethod: event.target.value as typeof batchEdit.paymentMethod })} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">Keep current method</option><option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank Transfer</option><option value="wallet">Wallet</option></select></label><label className="block text-sm font-medium text-slate-700">Bank name<input value={batchEdit.bankName} onChange={(event) => setBatchEdit({ ...batchEdit, bankName: event.target.value })} placeholder="Leave blank to keep current bank" className="mt-1 w-full rounded-lg border px-3 py-2" /></label></div>{batchEditing && batchEditProgress.total > 0 && <div className="mt-4"><div className="mb-1 flex justify-between text-xs text-slate-600"><span>Updating batch…</span><span>{batchEditProgress.completed} / {batchEditProgress.total}</span></div><div className="h-2 overflow-hidden rounded-full bg-indigo-100"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${Math.round(batchEditProgress.completed / batchEditProgress.total * 100)}%` }} /></div></div>}<div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setBatchEdit(null)} disabled={batchEditing} className="app-btn-secondary">Cancel</button><button type="button" onClick={() => void applyBatchEdit()} disabled={batchEditing} className="app-btn-primary">{batchEditing ? "Updating…" : "Update batch"}</button></div></div></div>}

      {showModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => {
            if (!saving) {
              setShowModal(false);
              setAttachmentFiles([]);
            }
          }}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">{editingPayment ? "Edit Payment" : "Record Payment"}</h2>
              <button
                type="button"
                onClick={() => {
                  if (!saving) {
                    setShowModal(false);
                    setAttachmentFiles([]);
                  }
                }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Vendor *</label>
                <select
                  value={vendorId}
                  onChange={(e) => {
                    setVendorId(e.target.value);
                    setAllocationInputs({});
                  }}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="">Select vendor</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">Outstanding GRN/Bills load below for allocation.</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Payment amount *</label>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="0.00"
                />
              </div>

              <div className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium mb-1">Payment date</label>
                  <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Payment method</label>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as "cash" | "card" | "bank_transfer")} className="w-full border rounded-lg px-3 py-2">
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="wallet">Wallet</option>
                  </select>
                </div>
                {paymentMethod === "bank_transfer" && <div>
                  <label className="block text-sm font-medium mb-1">Bank account *</label>
                  <SearchableCombobox
                    value={bankName}
                    onChange={setBankName}
                    options={bankAccountOptions}
                    placeholder="Search active bank accounts…"
                    emptyOption={{ label: "Select bank account" }}
                    inputAriaLabel="Search bank accounts from chart of accounts"
                    clearable
                  />
                  {bankAccounts.length === 0 && <p className="mt-1 text-xs text-amber-700">No active bank account was found in the Chart of Accounts. Add or activate a bank account first.</p>}
                </div>}
                <div>
                  <label className="block text-sm font-medium mb-1">Cheque number</label>
                  <input value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} className="w-full border rounded-lg px-3 py-2" placeholder="For example, 007380" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Payment voucher no.</label>
                  <input value={paymentVoucher} onChange={(e) => setPaymentVoucher(e.target.value)} className="w-full border rounded-lg px-3 py-2" placeholder="For example, PV-11427" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Reference</label>
                  <input value={reference} onChange={(e) => setReference(e.target.value)} className="w-full border rounded-lg px-3 py-2" placeholder="Optional" />
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <label className="block text-sm font-medium">Apply to GRN/Bills (optional)</label>
                  {vendorId && outstandingBills.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={fillPaymentAcrossBills}
                        disabled={!vendorId || loadingBills}
                        className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Fill payment across bills
                      </button>
                      <button
                        type="button"
                        onClick={clearBillAllocations}
                        className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
                      >
                        Clear bill amounts
                      </button>
                    </div>
                  )}
                </div>
                {vendorId && loadingBills ? (
                  <p className="text-sm text-slate-500 py-2">Loading bills…</p>
                ) : vendorId && outstandingBills.length === 0 ? (
                  <p className="text-xs text-amber-800">No outstanding bills for this vendor. The full payment can still be recorded as unearned income.</p>
                ) : (
                  <div className="rounded-lg border border-slate-200 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="text-left p-2 font-medium">Bill date</th>
                          <th className="text-left p-2 font-medium">Invoice No.</th>
                          <th className="text-right p-2 font-medium">Balance</th>
                          <th className="text-right p-2 font-medium w-32">Apply</th>
                        </tr>
                      </thead>
                      <tbody>
                        {outstandingBills.map((b) => (
                          <tr key={b.id} className="border-t border-slate-100">
                            <td className="p-2 whitespace-nowrap">
                              {b.bill_date ? new Date(b.bill_date).toLocaleDateString() : "—"}
                            </td>
                            <td className="p-2 max-w-[200px] truncate" title={b.invoice_number || b.description || undefined}>
                              {b.invoice_number || b.description || "—"}
                            </td>
                            <td className="p-2 text-right tabular-nums">{b.balance.toFixed(2)}</td>
                            <td className="p-2 text-right">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max={b.balance}
                                value={allocationInputs[b.id] ?? ""}
                                onChange={(e) =>
                                  setAllocationInputs((prev) => ({ ...prev, [b.id]: e.target.value }))
                                }
                                className="w-full border rounded px-2 py-1 text-right tabular-nums"
                                placeholder="0"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {vendorId && outstandingBills.length > 0 && (
                  <p className="text-xs text-slate-600 mt-2">
                    Allocated to bills: <span className="font-semibold tabular-nums">{sumAllocated.toFixed(2)}</span>
                    {amount && !isNaN(parseFloat(amount)) && (
                      <>
                        {" "}
                        / payment <span className="tabular-nums">{parseFloat(amount).toFixed(2)}</span>
                      </>
                    )}
                  </p>
                )}
              </div>

              {showOverHint && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  Allocated total exceeds the payment amount. Reduce bill amounts or increase the payment.
                </div>
              )}
              {showUnearnedHint && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  This excess payment will be recorded under unearned income.
                </div>
              )}
              {!showUnearnedHint && vendorId && parseFloat(amount) > 0 && sumAllocated <= 0.001 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  No amount applied to bills — the full payment will be recorded under unearned income.
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">Attachments (optional)</label>
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf,.doc,.docx"
                  className="w-full text-sm text-slate-700 file:mr-2 file:rounded file:border file:border-slate-300 file:px-2 file:py-1"
                  onChange={(e) => setAttachmentFiles(Array.from(e.target.files || []))}
                />
                {attachmentFiles.length > 0 ? (
                  <p className="text-xs text-slate-600 mt-1">{attachmentFiles.map((f) => f.name).join(", ")}</p>
                ) : null}
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={handleAdd}
                disabled={readOnly || saving || Boolean(showOverHint)}
                className="app-btn-primary flex-1 py-2"
              >
                <CreditCard className="w-4 h-4" />
                {saving ? "Saving…" : "Record"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!saving) {
                    setShowModal(false);
                    setAttachmentFiles([]);
                  }
                }}
                className="px-4 py-2 border rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
