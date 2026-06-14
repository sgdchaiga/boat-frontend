import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { CreditCard, Pencil, Plus, Undo2, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { createJournalForVendorPayment, deleteJournalEntryByReference, reverseJournalEntriesByReference, type VendorPaymentJournalAllocation } from "../../lib/journal";
import { isBillApproved, parseBillAllocationsJson, syncBillStatusInDb } from "../../lib/billStatus";
import { buildStoragePath, uploadSourceDocument, type SourceDocumentRef } from "../../lib/sourceDocuments";
import { useAuth } from "../../contexts/AuthContext";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";
import { PageNotes } from "../common/PageNotes";
import { SourceDocumentsCell } from "../common/SourceDocumentsCell";

interface VendorPayment {
  id: string;
  vendor_id?: string | null;
  bill_id?: string | null;
  bill_allocations?: unknown;
  source_documents?: unknown;
  amount?: number | null;
  payment_date?: string | null;
  payment_method?: string | null;
  reference?: string | null;
  created_at?: string;
  status?: "active" | "reversed" | null;
  reversed_at?: string | null;
  reversal_reason?: string | null;
  vendors?: { name: string } | null;
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

export function VendorPaymentsPage({
  payBillId,
  payVendorId,
  highlightVendorPaymentId,
  readOnly = false,
  onNavigate,
}: VendorPaymentsPageProps = {}) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const isAdmin = user?.role === "admin" || user?.isSuperAdmin === true;
  const [payments, setPayments] = useState<VendorPayment[]>([]);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [vendorId, setVendorId] = useState("");
  /** Per-bill allocation amounts (string for inputs); omitted or empty = not applied */
  const [allocationInputs, setAllocationInputs] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "bank_transfer" | "wallet">("bank_transfer");
  const [reference, setReference] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingPayment, setEditingPayment] = useState<VendorPayment | null>(null);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const vendorPaymentInFlightRef = useRef(false);
  const [outstandingBills, setOutstandingBills] = useState<OutstandingBill[]>([]);
  const [loadingBills, setLoadingBills] = useState(false);
  const hasOpenedForPayBillRef = useRef(false);
  /** Payment selected to show allocation / line details in a modal */
  const [detailPayment, setDetailPayment] = useState<VendorPayment | null>(null);
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
        .select("id, amount, due_date, bill_date, description, approved_at, status, vendors(name)")
        .eq("vendor_id", venId)
        .order("bill_date", { ascending: false });
      if (bErr) throw bErr;
      const rows = (bills || []) as unknown as Array<{
        id: string;
        amount: number;
        due_date: string | null;
        bill_date: string | null;
        description: string | null;
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
  }, []);

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
    setLoading(true);
    try {
      const [payRes, venRes] = await Promise.all([
        supabase.from("vendor_payments").select("*, vendors(name)").order("payment_date", { ascending: false }),
        supabase.from("vendors").select("id, name").order("name"),
      ]);
      if (payRes.error) throw payRes.error;
      setPayments(payRes.data || []);
      setVendors(venRes.data || []);
    } catch (e) {
      console.error("Error fetching vendor payments:", e);
      setPayments([]);
    } finally {
      setLoading(false);
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
    setReference("");
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
    setReference(payment.reference || "");
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
      const savePayload: Record<string, unknown> = {
        vendor_id: vendorId,
        bill_id: useLegacySingleBill ? lines[0].billId : null,
        amount: amt,
        payment_date: payDate,
        payment_method: paymentMethod,
        reference: reference.trim() || null,
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
        <button
          type="button"
          onClick={() => !readOnly && setShowModal(true)}
          disabled={readOnly}
          className="app-btn-primary disabled:cursor-not-allowed"
        >
          <Plus className="w-5 h-5" /> Record Payment
        </button>
      </div>

      {loading ? (
        <p className="text-slate-500 py-4">Loading…</p>
      ) : (
        <div className="app-card overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Vendor</th>
                <th className="text-left p-3">Method</th>
                <th className="text-left p-3">Reference</th>
                <th className="text-right p-3">Amount</th>
                <th className="text-left p-3 w-28">Documents</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr
                  key={p.id}
                  className={`border-t ${p.status === "reversed" ? "bg-rose-50/60 text-slate-500" : ""} ${highlightVendorPaymentId === p.id ? "bg-amber-50 ring-2 ring-inset ring-amber-300/80" : ""}`}
                >
                  <td className="p-3">{p.payment_date ? new Date(p.payment_date).toLocaleDateString() : "—"}</td>
                  <td className="p-3">
                    {p.vendor_id && onNavigate ? (
                      <button
                        type="button"
                        className="text-left text-brand-700 hover:underline font-medium truncate max-w-[220px]"
                        onClick={() => onNavigate("purchases_vendors", { highlightVendorId: p.vendor_id })}
                      >
                        {p.vendors?.name || "—"}
                      </button>
                    ) : (
                      p.vendors?.name || "—"
                    )}
                  </td>
                  <td className="p-3 capitalize">{(p.payment_method || "—").replace("_", " ")}</td>
                  <td className="p-3">{p.reference || "—"}{p.status === "reversed" && <p className="text-xs font-semibold text-rose-700">Reversed</p>}</td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      className="font-semibold text-brand-700 hover:underline tabular-nums"
                      title="View payment line details"
                      onClick={() => setDetailPayment(p)}
                    >
                      {Number(p.amount || 0).toFixed(2)}
                    </button>
                  </td>
                  <td className="p-3 align-top">
                    <SourceDocumentsCell
                      table="vendor_payments"
                      recordId={p.id}
                      organizationId={orgId}
                      rawDocuments={p.source_documents}
                      readOnly={readOnly}
                      onUpdated={fetchData}
                    />
                  </td>
                  <td className="p-3 text-right">
                    {isAdmin && !readOnly && p.status !== "reversed" && (
                      <span className="inline-flex gap-1">
                        <button type="button" onClick={() => void openEdit(p)} className="rounded p-1.5 text-slate-600 hover:bg-slate-100" title="Edit payment">
                          <Pencil className="h-4 w-4" />
                        </button>
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
          {payments.length === 0 && <p className="p-8 text-center text-slate-500">No payments recorded yet.</p>}
        </div>
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
                          <th className="text-left p-2 font-medium">Description</th>
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
                            <td className="p-2 max-w-[200px] truncate" title={b.description || undefined}>
                              {b.description || "—"}
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
                <label className="block text-sm font-medium mb-1">Payment Date</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as "cash" | "card" | "bank_transfer")}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="wallet">Wallet</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Reference / Check #</label>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="Optional"
                />
              </div>
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
