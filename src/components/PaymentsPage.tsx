import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DollarSign, CreditCard, X, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { createJournalForPayment } from "../lib/journal";
import {
  type ActiveStayOption,
  type PaymentWithCustomer,
  type BillingRangePreset,
  billingRangeToDates,
  guestDisplayName,
  paymentReceivedCustomerLabel,
} from "../lib/billingShared";
import { parseInvoiceAllocationsJson, totalAllocatedToInvoice } from "../lib/invoicePaymentAllocations";
import {
  formatPaymentMethodLabel,
  insertPaymentWithMethodCompat,
  PAYMENT_METHOD_SELECT_OPTIONS,
  type PaymentMethodCode,
} from "../lib/paymentMethod";
import { isDebtorPayment } from "../lib/paymentClassification";
import { ReadOnlyNotice } from "./common/ReadOnlyNotice";
import { PageNotes } from "./common/PageNotes";
import { SearchableCombobox } from "./common/SearchableCombobox";
import { SourceDocumentsCell } from "./common/SourceDocumentsCell";
import { buildStoragePath, uploadSourceDocument, type SourceDocumentRef } from "../lib/sourceDocuments";

interface PaymentsPageProps {
  readOnly?: boolean;
  /** Deep-link from invoices: scroll to and highlight this payment row. */
  highlightPaymentId?: string;
}

type PaymentSortKey = "customer" | "transaction_id" | "amount" | "payment_method" | "payment_status" | "paid_at";

type OutstandingInvoice = {
  id: string;
  invoice_number: string;
  total: number;
  balance: number;
  issue_date: string;
  customer_name: string;
};

function stayOptionLabel(s: ActiveStayOption): string {
  const room = s.rooms?.room_number ?? "—";
  const guest = guestDisplayName(s.hotel_customers ?? null) || "Guest";
  const shortId = s.id.slice(0, 8);
  const checkIn = s.actual_check_in
    ? new Date(s.actual_check_in).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "";
  return `Stay ${shortId} · Room ${room} · ${guest}${checkIn ? ` · since ${checkIn}` : ""}`;
}

function getPaymentInvoiceAllocationLines(p: PaymentWithCustomer): { invoice_id: string; amount: number }[] {
  return parseInvoiceAllocationsJson(p.invoice_allocations);
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

function parseCustomerKey(key: string): { kind: "hc" | "rc"; id: string } | null {
  if (key.startsWith("hc:")) return { kind: "hc", id: key.slice(3) };
  if (key.startsWith("rc:")) return { kind: "rc", id: key.slice(3) };
  return null;
}

/**
 * Avoid PostgREST embeds on `payments.property_customer_id` / `retail_customer_id` (they break if
 * migration not applied or FK hint differs). Batch-load names by id instead.
 */
async function enrichPaymentsWithCustomerLabels(
  rows: PaymentWithCustomer[],
  orgId: string | null,
  superAdmin: boolean
): Promise<PaymentWithCustomer[]> {
  const hcIds = [...new Set(rows.map((r) => r.property_customer_id).filter(Boolean))] as string[];
  const rcIds = [...new Set(rows.map((r) => r.retail_customer_id).filter(Boolean))] as string[];
  if (hcIds.length === 0 && rcIds.length === 0) return rows;

  const [hcRes, rcRes] = await Promise.all([
    hcIds.length > 0
      ? filterByOrganizationId(
          supabase.from("hotel_customers").select("id, first_name, last_name").in("id", hcIds),
          orgId ?? undefined,
          superAdmin
        )
      : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[], error: null }),
    rcIds.length > 0
      ? filterByOrganizationId(
          supabase.from("retail_customers").select("id, name").in("id", rcIds),
          orgId ?? undefined,
          superAdmin
        )
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);

  if (hcRes.error) console.warn("enrich hotel_customers:", formatSupabaseError(hcRes.error));
  if (rcRes.error) console.warn("enrich retail_customers:", formatSupabaseError(rcRes.error));

  const hcMap = new Map(
    (hcRes.data || []).map((r) => [r.id, { first_name: r.first_name, last_name: r.last_name }])
  );
  const rcMap = new Map((rcRes.data || []).map((r) => [r.id, { name: r.name }]));

  return rows.map((p) => ({
    ...p,
    property_customer: p.property_customer_id ? hcMap.get(p.property_customer_id) ?? p.property_customer : p.property_customer,
    retail_customer: p.retail_customer_id ? rcMap.get(p.retail_customer_id) ?? p.retail_customer : p.retail_customer,
  }));
}

export function PaymentsPage({ readOnly = false, highlightPaymentId }: PaymentsPageProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;
  const [payments, setPayments] = useState<PaymentWithCustomer[]>([]);
  const [activeStays, setActiveStays] = useState<ActiveStayOption[]>([]);
  const [hotelCustomers, setHotelCustomers] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [retailCustomers, setRetailCustomers] = useState<{ id: string; name: string }[]>([]);
  const [loadingCustomersList, setLoadingCustomersList] = useState(false);
  const [customerListError, setCustomerListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [customerKey, setCustomerKey] = useState("");
  const [paymentStayId, setPaymentStayId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [allocationInputs, setAllocationInputs] = useState<Record<string, string>>({});
  const [outstandingInvoices, setOutstandingInvoices] = useState<OutstandingInvoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodCode>("cash");
  const [transactionId, setTransactionId] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [savingPayment, setSavingPayment] = useState(false);

  const [detailPayment, setDetailPayment] = useState<PaymentWithCustomer | null>(null);
  const [detailInvoiceMeta, setDetailInvoiceMeta] = useState<
    Record<string, { invoice_number: string; issue_date: string | null; customer_name: string | null }>
  >({});

  const [paymentSort, setPaymentSort] = useState<{ key: PaymentSortKey; dir: "asc" | "desc" } | null>(null);
  const highlightDismissed = useRef(false);
  const [paymentRange, setPaymentRange] = useState<BillingRangePreset>("all");
  const { from: paymentDateFrom, to: paymentDateTo } = useMemo(
    () => billingRangeToDates(paymentRange),
    [paymentRange]
  );

  const customerParsed = useMemo(() => parseCustomerKey(customerKey), [customerKey]);

  const staysForCustomer = useMemo(() => {
    if (!customerParsed || customerParsed.kind !== "hc") return [];
    return activeStays.filter((s) => s.property_customer_id === customerParsed.id);
  }, [activeStays, customerParsed]);

  const stayComboboxOptions = useMemo(
    () => staysForCustomer.map((s) => ({ id: s.id, label: stayOptionLabel(s) })),
    [staysForCustomer]
  );

  const customerComboboxOptions = useMemo(() => {
    const hc = hotelCustomers.map((c) => ({
      id: `hc:${c.id}`,
      label: `${guestDisplayName(c)} (Hotel)`,
    }));
    const rc = retailCustomers.map((c) => ({
      id: `rc:${c.id}`,
      label: `${c.name} (Retail)`,
    }));
    return [...hc, ...rc];
  }, [hotelCustomers, retailCustomers]);

  const loadOutstandingInvoices = useCallback(
    async (kind: "hc" | "rc", customerId: string) => {
      if (!customerId) {
        setOutstandingInvoices([]);
        return;
      }
      setLoadingInvoices(true);
      try {
        let invQ = filterByOrganizationId(
          supabase
            .from("retail_invoices")
            .select("id, invoice_number, total, issue_date, customer_name, status, customer_id, property_customer_id"),
          orgId ?? undefined,
          superAdmin
        );
        if (kind === "hc") invQ = invQ.eq("property_customer_id", customerId);
        else invQ = invQ.eq("customer_id", customerId);

        const invRes = await invQ.order("issue_date", { ascending: false });

        const payQ = filterByOrganizationId(
          supabase.from("payments").select("invoice_allocations, payment_status"),
          orgId ?? undefined,
          superAdmin
        );
        const payRes = await payQ;

        if (invRes.error) throw invRes.error;
        if (payRes.error) throw payRes.error;

        const payRows = (payRes.data || []) as Array<{ invoice_allocations?: unknown; payment_status?: string }>;

        const out: OutstandingInvoice[] = [];
        for (const row of invRes.data || []) {
          const inv = row as {
            id: string;
            invoice_number: string;
            total: number;
            issue_date: string;
            customer_name: string;
            status: string;
          };
          if (inv.status === "void" || inv.status === "paid") continue;
          const paid = totalAllocatedToInvoice(payRows, inv.id);
          const total = Number(inv.total) || 0;
          const balance = Math.max(0, Math.round((total - paid) * 100) / 100);
          if (balance <= 0.001) continue;
          out.push({
            id: inv.id,
            invoice_number: inv.invoice_number,
            total,
            balance,
            issue_date: inv.issue_date,
            customer_name: inv.customer_name,
          });
        }
        setOutstandingInvoices(out);
      } catch (e) {
        console.error("Outstanding invoices:", e);
        setOutstandingInvoices([]);
      } finally {
        setLoadingInvoices(false);
      }
    },
    [orgId, superAdmin]
  );

  useEffect(() => {
    if (!showRecordPayment || !customerParsed) {
      if (!showRecordPayment) setOutstandingInvoices([]);
      return;
    }
    void loadOutstandingInvoices(customerParsed.kind, customerParsed.id);
  }, [showRecordPayment, customerParsed, loadOutstandingInvoices]);

  useEffect(() => {
    if (!detailPayment) {
      setDetailInvoiceMeta({});
      return;
    }
    const lines = getPaymentInvoiceAllocationLines(detailPayment);
    const ids = [...new Set(lines.map((l) => l.invoice_id))];
    if (ids.length === 0) {
      setDetailInvoiceMeta({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("retail_invoices")
        .select("id, invoice_number, issue_date, customer_name")
        .in("id", ids);
      if (cancelled || error) return;
      const map: Record<string, { invoice_number: string; issue_date: string | null; customer_name: string | null }> = {};
      for (const b of data || []) {
        const row = b as {
          id: string;
          invoice_number: string;
          issue_date: string | null;
          customer_name: string | null;
        };
        map[row.id] = {
          invoice_number: row.invoice_number,
          issue_date: row.issue_date,
          customer_name: row.customer_name,
        };
      }
      if (!cancelled) setDetailInvoiceMeta(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [detailPayment]);

  /** Invoices, guest folio, and manual customer receipts — excludes POS cash (see Cash receipts page). */
  const debtorPayments = useMemo(() => payments.filter(isDebtorPayment), [payments]);

  const filteredPayments = useMemo(() => {
    if (!paymentDateFrom && !paymentDateTo) return debtorPayments;
    return debtorPayments.filter((p) => {
      const t = new Date(p.paid_at).getTime();
      if (paymentDateFrom) {
        const start = new Date(`${paymentDateFrom}T00:00:00`).getTime();
        if (t < start) return false;
      }
      if (paymentDateTo) {
        const end = new Date(`${paymentDateTo}T23:59:59.999`).getTime();
        if (t > end) return false;
      }
      return true;
    });
  }, [debtorPayments, paymentDateFrom, paymentDateTo]);

  const sortedPayments = useMemo(() => {
    if (!paymentSort) return filteredPayments;
    const { key, dir } = paymentSort;
    const m = dir === "asc" ? 1 : -1;
    return [...filteredPayments].sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case "customer": {
          const na = paymentReceivedCustomerLabel(a) || "\uffff";
          const nb = paymentReceivedCustomerLabel(b) || "\uffff";
          cmp = na.localeCompare(nb, undefined, { sensitivity: "base" });
          break;
        }
        case "transaction_id":
          cmp = (a.transaction_id || "").localeCompare(b.transaction_id || "");
          break;
        case "amount":
          cmp = Number(a.amount) - Number(b.amount);
          break;
        case "payment_method":
          cmp = (a.payment_method || "").localeCompare(b.payment_method || "");
          break;
        case "payment_status":
          cmp = (a.payment_status || "").localeCompare(b.payment_status || "");
          break;
        case "paid_at":
          cmp = new Date(a.paid_at).getTime() - new Date(b.paid_at).getTime();
          break;
        default:
          cmp = 0;
      }
      return cmp * m;
    });
  }, [filteredPayments, paymentSort]);

  const togglePaymentSort = (key: PaymentSortKey) => {
    setPaymentSort((prev) => {
      if (prev?.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      const defaultDesc = key === "amount" || key === "paid_at";
      return { key, dir: defaultDesc ? "desc" : "asc" };
    });
  };

  const SortIcon = ({ active, dir }: { active: boolean; dir: "asc" | "desc" }) => {
    if (!active) return <ArrowUpDown className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />;
    return dir === "asc" ? (
      <ArrowUp className="w-4 h-4 text-slate-800 shrink-0" aria-hidden />
    ) : (
      <ArrowDown className="w-4 h-4 text-slate-800 shrink-0" aria-hidden />
    );
  };

  /** Load customers for the modal: include legacy hotel rows with NULL organization_id (strict .eq org was hiding them). */
  const loadModalCustomers = useCallback(async () => {
    setCustomerListError(null);
    setLoadingCustomersList(true);
    try {
      let hcQ = supabase.from("hotel_customers").select("id, first_name, last_name").order("first_name");
      let rcQ = supabase.from("retail_customers").select("id, name").order("name");
      if (orgId) {
        hcQ = hcQ.eq("organization_id", orgId);
        rcQ = rcQ.eq("organization_id", orgId);
      }
      const [hcRes, rcRes] = await Promise.all([hcQ, rcQ]);
      if (hcRes.error) throw hcRes.error;
      if (rcRes.error) throw rcRes.error;
      setHotelCustomers((hcRes.data || []) as { id: string; first_name: string; last_name: string }[]);
      setRetailCustomers((rcRes.data || []) as { id: string; name: string }[]);
    } catch (e) {
      console.error("Load customers:", e);
      setCustomerListError(formatSupabaseError(e));
      setHotelCustomers([]);
      setRetailCustomers([]);
    } finally {
      setLoadingCustomersList(false);
    }
  }, [orgId]);

  const fetchData = useCallback(async () => {
    try {
      setPaymentError(null);
      const paymentsQuery = filterByOrganizationId(
        supabase
          .from("payments")
          .select(`*, stays(rooms(room_number), hotel_customers(first_name, last_name))`)
          .order("paid_at", { ascending: false }),
        orgId ?? undefined,
        superAdmin
      );

      const [paymentsResult, staysResult] = await Promise.all([
        paymentsQuery,
        filterByOrganizationId(
          supabase
            .from("stays")
            .select(
              "id, room_id, property_customer_id, actual_check_in, rooms(room_number), hotel_customers(first_name, last_name)"
            )
            .is("actual_check_out", null)
            .order("actual_check_in", { ascending: false }),
          orgId ?? undefined,
          superAdmin
        ),
      ]);

      if (paymentsResult.error) {
        const pe = paymentsResult.error;
        console.error("payments fetch:", formatSupabaseError(pe), pe);
        throw pe;
      }
      if (staysResult.error) {
        const se = staysResult.error;
        console.error("stays fetch:", formatSupabaseError(se), se);
        throw se;
      }

      const raw = (paymentsResult.data || []) as PaymentWithCustomer[];
      const enriched = await enrichPaymentsWithCustomerLabels(raw, orgId, superAdmin);
      setPayments(enriched);
      setActiveStays((staysResult.data || []) as unknown as ActiveStayOption[]);
    } catch (error) {
      const msg = formatSupabaseError(error);
      console.error("Error fetching payments:", msg, error);
      setPaymentError(msg || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [orgId, superAdmin]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    highlightDismissed.current = false;
  }, [highlightPaymentId]);

  useEffect(() => {
    if (!highlightPaymentId || highlightDismissed.current || loading) return;
    const el = document.getElementById(`payment-row-${highlightPaymentId}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    highlightDismissed.current = true;
  }, [highlightPaymentId, loading, debtorPayments]);

  useEffect(() => {
    if (!showRecordPayment) return;
    void loadModalCustomers();
  }, [showRecordPayment, loadModalCustomers]);

  const sumAllocated = useMemo(() => {
    let s = 0;
    for (const inv of outstandingInvoices) {
      const raw = allocationInputs[inv.id]?.trim();
      if (!raw) continue;
      const v = parseFloat(raw);
      if (!isNaN(v) && v > 0) s += v;
    }
    return Math.round(s * 100) / 100;
  }, [outstandingInvoices, allocationInputs]);

  const paymentNum = parseFloat(paymentAmount);
  const showUnearnedHint =
    customerParsed && !isNaN(paymentNum) && paymentNum > 0 && sumAllocated < paymentNum - 0.001;
  const showOverHint =
    customerParsed && !isNaN(paymentNum) && paymentNum > 0 && sumAllocated > paymentNum + 0.001;

  const fillPaymentAcrossInvoices = () => {
    const total = parseFloat(paymentAmount);
    if (isNaN(total) || total <= 0) {
      alert("Enter a valid payment amount first.");
      return;
    }
    let remaining = total;
    const next: Record<string, string> = { ...allocationInputs };
    for (const inv of outstandingInvoices) {
      if (remaining <= 0) {
        next[inv.id] = "";
        continue;
      }
      const apply = Math.min(inv.balance, remaining);
      next[inv.id] = apply.toFixed(2);
      remaining -= apply;
    }
    setAllocationInputs(next);
  };

  const clearInvoiceAllocations = () => {
    const cleared: Record<string, string> = {};
    for (const inv of outstandingInvoices) cleared[inv.id] = "";
    setAllocationInputs(cleared);
  };

  const payTh = (key: PaymentSortKey, label: string, align: "left" | "right" = "left") => (
    <th className={`${align === "right" ? "text-right" : "text-left"} p-0`}>
      <button
        type="button"
        onClick={() => togglePaymentSort(key)}
        className={`w-full flex items-center gap-1.5 p-3 font-semibold text-slate-700 hover:bg-slate-100 transition ${
          align === "right" ? "justify-end" : "justify-start"
        }`}
      >
        {label}
        <SortIcon active={paymentSort?.key === key} dir={paymentSort?.dir ?? "asc"} />
      </button>
    </th>
  );

  const handleRecordPayment = async () => {
    if (readOnly) return;
    const parsed = parseCustomerKey(customerKey);
    if (!parsed) {
      alert("Please select a customer.");
      return;
    }
    if (!paymentAmount || Number(paymentAmount) <= 0) {
      alert("Enter a valid amount.");
      return;
    }

    const amt = parseFloat(paymentAmount);
    if (isNaN(amt) || amt <= 0) {
      alert("Enter a valid amount.");
      return;
    }

    const lines: { invoiceId: string; amt: number }[] = [];
    for (const inv of outstandingInvoices) {
      const raw = allocationInputs[inv.id]?.trim();
      if (!raw) continue;
      const v = parseFloat(raw);
      if (isNaN(v) || v <= 0) continue;
      if (v > inv.balance + 0.01) {
        alert(`Amount for an invoice cannot exceed its balance (${inv.balance.toFixed(2)}).`);
        return;
      }
      lines.push({ invoiceId: inv.id, amt: Math.round(v * 100) / 100 });
    }

    const sumAlloc = lines.reduce((s, l) => s + l.amt, 0);
    if (sumAlloc > amt + 0.02) {
      alert("Total allocated to invoices cannot exceed the payment amount.");
      return;
    }

    const unearnedExcessAmount = Math.max(0, Math.round((amt - sumAlloc) * 100) / 100);
    if (unearnedExcessAmount > 0.001) {
      const ok = window.confirm(
        "The portion not applied to invoices will be recorded as on-account / unearned (same as vendor payments).\n\nContinue?"
      );
      if (!ok) return;
    }

    if (parsed.kind === "hc" && paymentStayId) {
      const stay = activeStays.find((s) => s.id === paymentStayId);
      if (stay && stay.property_customer_id && stay.property_customer_id !== parsed.id) {
        alert("Selected stay does not belong to this customer.");
        return;
      }
    }

    setSavingPayment(true);
    setPaymentError(null);
    try {
      const { data: staffRow } = await supabase.from("staff").select("id").eq("id", user?.id).maybeSingle();

      const insertPayload: Record<string, unknown> = {
        stay_id: parsed.kind === "hc" && paymentStayId ? paymentStayId : null,
        property_customer_id: parsed.kind === "hc" ? parsed.id : null,
        retail_customer_id: parsed.kind === "rc" ? parsed.id : null,
        payment_source: "debtor",
        ...(orgId ? { organization_id: orgId } : {}),
        amount: amt,
        payment_status: "completed",
        transaction_id: transactionId.trim() || null,
        processed_by: staffRow?.id ?? null,
      };

      if (lines.length > 0) {
        insertPayload.invoice_allocations = lines.map((l) => ({ invoice_id: l.invoiceId, amount: l.amt }));
      }

      const { data: inserted, error } = await insertPaymentWithMethodCompat(supabase, insertPayload, paymentMethod);

      if (error) {
        const msg = formatSupabaseError(error);
        if (msg.toLowerCase().includes("property_customer") || msg.toLowerCase().includes("invoice_allocations")) {
          throw new Error(
            `${msg}\n\nRun migration 20260403000000_payments_customer_invoice_allocations.sql in Supabase SQL Editor.`
          );
        }
        if (msg.toLowerCase().includes("payment_source")) {
          throw new Error(`${msg}\n\nRun migration 20260421130000_payments_payment_source.sql in Supabase SQL Editor.`);
        }
        throw error;
      }
      if (inserted) {
        const paymentId = (inserted as { id: string }).id;
        const paidAt = (inserted as { paid_at?: string }).paid_at ?? new Date().toISOString();
        const jr = await createJournalForPayment(paymentId, amt, paidAt, user?.id ?? null);
        if (!jr.ok) {
          alert(`Payment saved but journal was not posted: ${jr.error}`);
        }

        if (attachmentFiles.length > 0 && orgId) {
          const next: SourceDocumentRef[] = [];
          for (const file of attachmentFiles) {
            const path = buildStoragePath(orgId, "payments_received", paymentId, file.name);
            const up = await uploadSourceDocument(file, path);
            if (!up.error) next.push({ path, name: file.name });
          }
          if (next.length) {
            await supabase.from("payments").update({ source_documents: next }).eq("id", paymentId);
          }
        }
      }

      setCustomerKey("");
      setPaymentStayId("");
      setPaymentAmount("");
      setAllocationInputs({});
      setTransactionId("");
      setAttachmentFiles([]);
      setShowRecordPayment(false);
      fetchData();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && "message" in err
            ? String((err as { message?: string }).message)
            : err && typeof err === "object" && "details" in err
              ? String((err as { details?: string }).details)
              : "Failed to record payment";
      setPaymentError(msg);
      alert("Failed to record payment: " + msg);
      console.error("Error recording payment:", err);
    } finally {
      setSavingPayment(false);
    }
  };

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  const paymentDateFilterActive = paymentRange !== "all";
  const totalPayments = filteredPayments
    .filter((p) => p.payment_status === "completed")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const totalPaymentsAllTime = debtorPayments
    .filter((p) => p.payment_status === "completed")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const recordDisabled =
    readOnly ||
    savingPayment ||
    !customerKey ||
    !paymentAmount ||
    Number(paymentAmount) <= 0 ||
    Boolean(showOverHint);

  return (
    <div className="p-6 md:p-8">
      {readOnly && <ReadOnlyNotice />}

      <div className="flex justify-between items-start mb-8 flex-wrap gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold">Debtor payments</h1>
            <PageNotes ariaLabel="Debtor payments help">
              <p>
                Receipts against invoices, guest folios, and customer accounts — not POS cash (see <strong>Cash receipts</strong>).
              </p>
            </PageNotes>
          </div>
        </div>

        <button
          onClick={() => {
            if (readOnly) return;
            setCustomerKey("");
            setPaymentStayId("");
            setAllocationInputs({});
            setShowRecordPayment(true);
          }}
          disabled={readOnly}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <CreditCard className="w-5 h-5" />
          Record payment
        </button>
      </div>

      {paymentError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm whitespace-pre-wrap">
          {paymentError}
        </div>
      )}

      <div className="bg-white p-6 rounded-xl border mb-4 max-w-md">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="w-5 h-5 text-green-600" />
          <p>Total debtor receipts</p>
        </div>
        <p className="text-2xl font-bold">{totalPayments.toFixed(2)}</p>
        {paymentDateFilterActive && (
          <p className="text-xs text-slate-500 mt-1">In range (completed) · All time: {totalPaymentsAllTime.toFixed(2)}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-b border-slate-200 mb-4 pb-2">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <span className="whitespace-nowrap">Date range</span>
          <select
            value={paymentRange}
            onChange={(e) => setPaymentRange(e.target.value as BillingRangePreset)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white max-w-[11rem]"
          >
            <option value="all">All dates</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="this_month">This month</option>
            <option value="last_month">Last month</option>
          </select>
        </label>
      </div>

      {debtorPayments.length === 0 ? (
        <p className="text-slate-500 py-6">
          {payments.length === 0
            ? "No debtor payments yet. Use Record payment for invoices, guest accounts, or optional stay link."
            : "No debtor payments in the list yet — recorded takings may all be POS cash (see Cash receipts)."}
        </p>
      ) : sortedPayments.length === 0 ? (
        <p className="text-slate-500 py-8 text-center border rounded-lg bg-slate-50">
          No payments in this date range. Change the date range or choose All dates.
        </p>
      ) : (
        <table className="w-full border">
          <thead className="bg-slate-50">
            <tr>
              {payTh("customer", "Customer")}
              {payTh("transaction_id", "Transaction ID")}
              {payTh("amount", "Amount", "right")}
              {payTh("payment_method", "Method")}
              {payTh("payment_status", "Status")}
              {payTh("paid_at", "Date")}
              <th className="text-left p-3 font-semibold text-slate-700">Docs</th>
            </tr>
          </thead>
          <tbody>
            {sortedPayments.map((p) => (
              <tr
                key={p.id}
                id={`payment-row-${p.id}`}
                className={`border-t ${
                  highlightPaymentId === p.id ? "bg-amber-50 ring-2 ring-inset ring-amber-300/80" : ""
                }`}
              >
                <td className="p-3">
                  <div className="flex flex-col gap-0.5">
                    <span>{paymentReceivedCustomerLabel(p)}</span>
                    {p.stay_id && p.stays?.rooms ? (
                      <span className="text-xs text-slate-500">
                        Stay · Room {p.stays.rooms.room_number ?? "—"}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="p-3 font-mono text-sm">{p.transaction_id || "—"}</td>
                <td className="p-3 text-right">
                  <button
                    type="button"
                    className="font-semibold text-emerald-800 hover:underline tabular-nums"
                    title="View invoice allocation"
                    onClick={() => setDetailPayment(p)}
                  >
                    {Number(p.amount).toFixed(2)}
                  </button>
                </td>
                <td className="p-3">{formatPaymentMethodLabel(p.payment_method)}</td>
                <td className="p-3">{p.payment_status}</td>
                <td className="p-3">{new Date(p.paid_at).toLocaleDateString()}</td>
                <td className="p-3 align-top">
                  <SourceDocumentsCell
                    table="payments"
                    recordId={p.id}
                    organizationId={p.organization_id ?? orgId}
                    rawDocuments={p.source_documents}
                    readOnly={readOnly}
                    onUpdated={fetchData}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
              <dt className="text-slate-500">Customer</dt>
              <dd className="font-medium text-slate-900">{paymentReceivedCustomerLabel(detailPayment)}</dd>
              <dt className="text-slate-500">Method</dt>
              <dd className="text-slate-900">{formatPaymentMethodLabel(detailPayment.payment_method)}</dd>
              <dt className="text-slate-500">Transaction ID</dt>
              <dd className="text-slate-900">{detailPayment.transaction_id || "—"}</dd>
              <dt className="text-slate-500">Total</dt>
              <dd className="font-semibold tabular-nums text-slate-900">{Number(detailPayment.amount || 0).toFixed(2)}</dd>
            </dl>
            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-2">Applied to invoices</h3>
              {(() => {
                const lines = getPaymentInvoiceAllocationLines(detailPayment);
                const allocated = lines.reduce((s, l) => s + l.amount, 0);
                const unallocated = Math.max(0, Number(detailPayment.amount) - allocated);
                if (lines.length === 0) {
                  return (
                    <p className="text-sm text-slate-600">
                      No invoice split recorded — full amount is treated as on-account / unallocated.
                    </p>
                  );
                }
                return (
                  <>
                    <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="text-left p-2 font-medium">Invoice</th>
                          <th className="text-left p-2 font-medium">Date</th>
                          <th className="text-right p-2 font-medium">Applied</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line, idx) => {
                          const meta = detailInvoiceMeta[line.invoice_id];
                          return (
                            <tr key={`${line.invoice_id}-${idx}`} className="border-t border-slate-100">
                              <td className="p-2 align-top">
                                <span className="font-mono text-xs">{meta?.invoice_number ?? line.invoice_id.slice(0, 8) + "…"}</span>
                                {meta?.customer_name ? (
                                  <p className="text-slate-700 mt-0.5 line-clamp-2 text-xs">{meta.customer_name}</p>
                                ) : null}
                              </td>
                              <td className="p-2 whitespace-nowrap">
                                {meta?.issue_date ? new Date(meta.issue_date).toLocaleDateString() : "—"}
                              </td>
                              <td className="p-2 text-right tabular-nums font-medium">{line.amount.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {unallocated > 0.01 ? (
                      <p className="text-xs text-amber-800 mt-2">
                        Unallocated on this payment: <span className="font-semibold tabular-nums">{unallocated.toFixed(2)}</span>
                      </p>
                    ) : null}
                  </>
                );
              })()}
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50" onClick={() => setDetailPayment(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecordPayment && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-10 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between mb-4">
              <h2 className="text-lg font-semibold">Record payment</h2>
              <X
                className="cursor-pointer shrink-0"
                onClick={() => {
                  if (!savingPayment) {
                    setShowRecordPayment(false);
                    setAttachmentFiles([]);
                  }
                }}
              />
            </div>

            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Link the payment to a <strong>customer</strong>. Optionally attach an <strong>active stay</strong> for hotel guests, and split the
                amount across open <strong>retail invoices</strong>.
              </p>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Customer (required)</label>
                {loadingCustomersList ? (
                  <p className="text-sm text-slate-500 py-2">Loading customers…</p>
                ) : customerListError ? (
                  <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{customerListError}</p>
                ) : (
                  <SearchableCombobox
                    value={customerKey}
                    onChange={(id) => {
                      setCustomerKey(id);
                      setPaymentStayId("");
                      setAllocationInputs({});
                    }}
                    options={customerComboboxOptions}
                    placeholder="Search hotel or retail customer…"
                    emptyOption={{ label: "Choose a customer…" }}
                    disabled={readOnly}
                    inputAriaLabel="Select customer for payment"
                    className="w-full"
                  />
                )}
                {!loadingCustomersList && !customerListError && customerComboboxOptions.length === 0 ? (
                  <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                    No customers found for this organization. Add them under <strong>Customers</strong> or <strong>Retail customers</strong> first.
                  </p>
                ) : null}
              </div>

              {customerParsed?.kind === "hc" ? (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Active stay (optional)</label>
                  {staysForCustomer.length === 0 ? (
                    <p className="text-sm text-slate-600 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50">
                      No active stay for this customer. You can still record the payment against the customer and invoices.
                    </p>
                  ) : (
                    <SearchableCombobox
                      value={paymentStayId}
                      onChange={(id) => setPaymentStayId(id)}
                      options={stayComboboxOptions}
                      placeholder="Link to a stay (optional)…"
                      emptyOption={{ label: "No stay linked" }}
                      disabled={readOnly}
                      inputAriaLabel="Select stay for payment"
                      className="w-full"
                    />
                  )}
                </div>
              ) : customerParsed?.kind === "rc" ? (
                <p className="text-xs text-slate-500">Retail customers are not linked to hotel stays.</p>
              ) : null}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                />
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <label className="block text-sm font-medium text-slate-700">Apply to invoices (optional)</label>
                  {customerParsed && outstandingInvoices.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={fillPaymentAcrossInvoices}
                        disabled={loadingInvoices}
                        className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Fill across invoices
                      </button>
                      <button
                        type="button"
                        onClick={clearInvoiceAllocations}
                        className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
                      >
                        Clear amounts
                      </button>
                    </div>
                  )}
                </div>
                {!customerParsed ? (
                  <p className="text-xs text-slate-500">Select a customer to load open invoices.</p>
                ) : loadingInvoices ? (
                  <p className="text-sm text-slate-500 py-2">Loading invoices…</p>
                ) : outstandingInvoices.length === 0 ? (
                  <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    No open retail invoices for this customer. The full amount can still be recorded as on-account.
                  </p>
                ) : (
                  <div className="rounded-lg border border-slate-200 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="text-left p-2 font-medium">Invoice #</th>
                          <th className="text-left p-2 font-medium">Issued</th>
                          <th className="text-right p-2 font-medium">Balance</th>
                          <th className="text-right p-2 font-medium w-32">Apply</th>
                        </tr>
                      </thead>
                      <tbody>
                        {outstandingInvoices.map((inv) => (
                          <tr key={inv.id} className="border-t border-slate-100">
                            <td className="p-2 font-mono text-xs">{inv.invoice_number}</td>
                            <td className="p-2 whitespace-nowrap">
                              {inv.issue_date ? new Date(inv.issue_date).toLocaleDateString() : "—"}
                            </td>
                            <td className="p-2 text-right tabular-nums">{inv.balance.toFixed(2)}</td>
                            <td className="p-2 text-right">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max={inv.balance}
                                value={allocationInputs[inv.id] ?? ""}
                                onChange={(e) => setAllocationInputs((prev) => ({ ...prev, [inv.id]: e.target.value }))}
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
                {customerParsed && outstandingInvoices.length > 0 && (
                  <p className="text-xs text-slate-600 mt-2">
                    Allocated to invoices: <span className="font-semibold tabular-nums">{sumAllocated.toFixed(2)}</span>
                    {paymentAmount && !isNaN(parseFloat(paymentAmount)) && (
                      <>
                        {" "}
                        / payment <span className="tabular-nums">{parseFloat(paymentAmount).toFixed(2)}</span>
                      </>
                    )}
                  </p>
                )}
              </div>

              {showOverHint && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  Allocated total exceeds the payment amount. Reduce invoice amounts or increase the payment.
                </div>
              )}
              {showUnearnedHint && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  The remainder will be recorded as on-account / unearned (not applied to specific invoices).
                </div>
              )}
              {!showUnearnedHint && customerParsed && parseFloat(paymentAmount) > 0 && sumAllocated <= 0.001 && outstandingInvoices.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  No amount applied to invoices — the full payment will be recorded as on-account.
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Method</label>
                <select
                  className="w-full border border-slate-200 rounded-lg px-3 py-2"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethodCode)}
                >
                  {PAYMENT_METHOD_SELECT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Transaction ID (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. card ref"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2"
                  value={transactionId}
                  onChange={(e) => setTransactionId(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Attachments (optional)</label>
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf,.doc,.docx"
                  className="w-full text-sm file:mr-2 file:rounded file:border file:border-slate-300 file:px-2 file:py-1"
                  onChange={(e) => setAttachmentFiles(Array.from(e.target.files || []))}
                />
                {attachmentFiles.length > 0 ? (
                  <p className="text-xs text-slate-600 mt-1">{attachmentFiles.map((f) => f.name).join(", ")}</p>
                ) : null}
              </div>

              <button
                onClick={() => void handleRecordPayment()}
                disabled={recordDisabled}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white w-full py-2 rounded-lg font-medium"
              >
                {savingPayment ? "Saving..." : "Save Payment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
