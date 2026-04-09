import { useCallback, useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { SchoolFeeReceiptPreviewModal } from "@/components/school/SchoolFeeReceiptPreviewModal";
import { schoolFeeReceiptDetailFromPayment, type SchoolFeeReceiptDetail } from "@/lib/schoolFeeReceipt";
import { buildSchoolFeesAutoReference } from "@/lib/autoReference";

type StudentOpt = { id: string; first_name: string; last_name: string; admission_number: string };
type InvOpt = { id: string; invoice_number: string; total_due: number; amount_paid: number; fee_structure_id: string | null; created_at?: string };
type FeeLine = { code?: string; label?: string; amount?: number; priority?: number };
type FeeStructure = { id: string; line_items: FeeLine[] | null };
type PaymentSlice = { invoice_id: string; amount: number; category_code?: string; category_label?: string; priority?: number };

type PayRow = {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  paid_at: string;
  student_id: string;
};

type Props = {
  readOnly?: boolean;
  /** Deep-link from reports (e.g. School Defaulters) — pre-fills student and optional invoice. */
  initialStudentId?: string;
  initialInvoiceId?: string;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeFeeLines(lines: FeeLine[] | null | undefined): Array<{ code: string; label: string; amount: number; priority: number }> {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((l, i) => ({
      code: String(l.code ?? "").trim() || `LINE_${i + 1}`,
      label: String(l.label ?? "").trim() || String(l.code ?? "").trim() || `Line ${i + 1}`,
      amount: Math.max(0, Number(l.amount) || 0),
      priority: Math.max(1, Number(l.priority) || i + 1),
    }))
    .filter((l) => l.amount > 0)
    .sort((a, b) => a.priority - b.priority);
}

export function SchoolFeePaymentsPage({ readOnly, initialStudentId, initialInvoiceId }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<PayRow[]>([]);
  const [students, setStudents] = useState<StudentOpt[]>([]);
  const [invoices, setInvoices] = useState<InvOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgAddress, setOrgAddress] = useState<string | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<SchoolFeeReceiptDetail | null>(null);
  const [form, setForm] = useState({
    student_id: "",
    invoice_id: "",
    amount: "",
    method: "cash" as "cash" | "mobile_money" | "bank" | "transfer" | "other" | "wallet",
  });

  useEffect(() => {
    if (!initialStudentId?.trim()) return;
    setForm((f) => ({
      ...f,
      student_id: initialStudentId.trim(),
      invoice_id: initialInvoiceId?.trim() ?? "",
    }));
  }, [initialStudentId, initialInvoiceId]);

  const refNote =
    "Reference is auto-generated: 01-YYYYMMDD-NNN (page 01 · UTC date · Nth school-fee payment that day).";

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = user?.organization_id;
    if (!orgId) {
      setLoading(false);
      return;
    }
    const [pRes, sRes] = await Promise.all([
      supabase.from("school_payments").select("*").eq("organization_id", orgId).order("paid_at", { ascending: false }),
      supabase.from("students").select("id,first_name,last_name,admission_number").eq("organization_id", orgId).order("last_name"),
    ]);
    setErr(pRes.error?.message || sRes.error?.message || null);
    setRows((pRes.data as PayRow[]) || []);
    setStudents((sRes.data as StudentOpt[]) || []);
    setLoading(false);
  }, [user?.organization_id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!user?.organization_id) {
      setOrgName(null);
      setOrgAddress(null);
      return;
    }
    void supabase
      .from("organizations")
      .select("name,address")
      .eq("id", user.organization_id)
      .maybeSingle()
      .then(({ data }) => {
        const o = data as { name?: string; address?: string | null } | null;
        setOrgName(o?.name ?? null);
        setOrgAddress(o?.address?.trim() ? o.address : null);
      });
  }, [user?.organization_id]);

  useEffect(() => {
    (async () => {
      if (!form.student_id || !user?.organization_id) {
        setInvoices([]);
        return;
      }
      const { data } = await supabase
        .from("student_invoices")
        .select("id,invoice_number,total_due,amount_paid,fee_structure_id,created_at")
        .eq("organization_id", user.organization_id)
        .eq("student_id", form.student_id)
        .neq("status", "cancelled")
        .order("created_at", { ascending: true });
      setInvoices((data as InvOpt[]) || []);
    })();
  }, [form.student_id, user?.organization_id]);

  const recordPayment = async () => {
    if (readOnly) return;
    if (!form.student_id || !form.amount) {
      setErr("Student and amount are required.");
      return;
    }
    const amt = Number(form.amount);
    if (!(amt > 0)) {
      setErr("Amount must be positive.");
      return;
    }
    const orgId = user?.organization_id;
    if (!orgId) return;
    const targetInvoices = form.invoice_id
      ? invoices.filter((i) => i.id === form.invoice_id)
      : invoices.filter((i) => Number(i.total_due) > Number(i.amount_paid));
    if (targetInvoices.length === 0) {
      setErr("No open invoice found for this student.");
      return;
    }

    const feeStructureIds = [...new Set(targetInvoices.map((i) => i.fee_structure_id).filter(Boolean))] as string[];
    const feeStructuresById = new Map<string, FeeStructure>();
    if (feeStructureIds.length > 0) {
      const { data: feeData, error: feeErr } = await supabase
        .from("fee_structures")
        .select("id,line_items")
        .eq("organization_id", orgId)
        .in("id", feeStructureIds);
      if (feeErr) {
        setErr(feeErr.message);
        return;
      }
      for (const row of ((feeData as FeeStructure[]) || [])) feeStructuresById.set(row.id, row);
    }

    const allocations: PaymentSlice[] = [];
    let remaining = amt;
    for (const inv of targetInvoices) {
      if (remaining <= 0) break;
      const invOutstanding = round2(Math.max(0, Number(inv.total_due) - Number(inv.amount_paid)));
      if (invOutstanding <= 0) continue;
      const applyOnInvoice = Math.min(remaining, invOutstanding);
      const fee = inv.fee_structure_id ? feeStructuresById.get(inv.fee_structure_id) : undefined;
      const normalized = normalizeFeeLines(fee?.line_items);
      const subtotal = normalized.reduce((s, l) => s + l.amount, 0);
      let allocLeft = applyOnInvoice;

      if (normalized.length > 0 && subtotal > 0) {
        for (let idx = 0; idx < normalized.length; idx += 1) {
          const line = normalized[idx];
          const rawShare = idx === normalized.length - 1 ? allocLeft : round2((applyOnInvoice * line.amount) / subtotal);
          const share = Math.min(allocLeft, Math.max(0, rawShare));
          if (share > 0) {
            allocations.push({
              invoice_id: inv.id,
              amount: share,
              category_code: line.code,
              category_label: line.label,
              priority: line.priority,
            });
            allocLeft = round2(allocLeft - share);
          }
          if (allocLeft <= 0) break;
        }
      }

      if (allocLeft > 0) {
        allocations.push({ invoice_id: inv.id, amount: allocLeft, category_code: "GENERAL", category_label: "General", priority: 999 });
      }
      remaining = round2(remaining - applyOnInvoice);
    }

    if (remaining > 0 && allocations.length > 0) {
      allocations[allocations.length - 1].amount = round2(allocations[allocations.length - 1].amount + remaining);
      remaining = 0;
    }

    if (allocations.length === 0) {
      setErr("Could not allocate this payment to any open invoice.");
      return;
    }
    setErr(null);

    let autoRef: string;
    try {
      autoRef = await buildSchoolFeesAutoReference(supabase, orgId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not generate payment reference.");
      return;
    }

    let walletIdForReverse: string | null = null;
    if (form.method === "wallet") {
      const { data: wRow, error: wErr } = await supabase
        .from("wallets")
        .select("id")
        .eq("organization_id", orgId)
        .eq("student_id", form.student_id)
        .maybeSingle();
      if (wErr) {
        setErr(wErr.message);
        return;
      }
      let walletId = (wRow as { id: string } | null)?.id ?? null;
      if (!walletId) {
        const ins = await supabase
          .from("wallets")
          .insert({
            organization_id: orgId,
            customer_kind: "student",
            student_id: form.student_id,
            wallet_number: `W-S-${form.student_id.replace(/-/g, "").slice(0, 8).toUpperCase()}`,
          })
          .select("id")
          .single();
        if (ins.error) {
          setErr(ins.error.message);
          return;
        }
        walletId = (ins.data as { id: string }).id;
      }
      const { data: balRow, error: balErr } = await supabase
        .from("wallet_balances")
        .select("current_balance")
        .eq("wallet_id", walletId)
        .maybeSingle();
      if (balErr) {
        setErr(balErr.message);
        return;
      }
      const bal = Number((balRow as { current_balance?: number } | null)?.current_balance ?? 0);
      if (bal < amt) {
        setErr(`Insufficient wallet balance (${bal.toLocaleString()} available).`);
        return;
      }
      const staffId = user?.id;
      if (!staffId) {
        setErr("You must be signed in as staff to pay from wallet.");
        return;
      }
      const wPay = await supabase.rpc("wallet_post_transaction", {
        p_wallet_id: walletId,
        p_txn_type: "payment",
        p_amount: amt,
        p_counterparty_wallet_id: null,
        p_reference: autoRef,
        p_narration: `School fees (${targetInvoices.map((i) => i.invoice_number).join(", ") || "invoice"})`,
        p_created_by: staffId,
        p_idempotency_key: crypto.randomUUID(),
        p_metadata: { source: "school_fees" },
      });
      if (wPay.error) {
        setErr(wPay.error.message);
        return;
      }
      walletIdForReverse = walletId;
    }

    const { data: pay, error } = await supabase
      .from("school_payments")
      .insert({
        student_id: form.student_id,
        amount: amt,
        method: form.method,
        reference: autoRef,
        invoice_allocations: allocations,
      })
      .select("id")
      .single();
    if (error) {
      if (walletIdForReverse && user?.id) {
        await supabase.rpc("wallet_post_transaction", {
          p_wallet_id: walletIdForReverse,
          p_txn_type: "deposit",
          p_amount: amt,
          p_counterparty_wallet_id: null,
          p_reference: null,
          p_narration: "Reversal: school fee record failed",
          p_created_by: user.id,
          p_idempotency_key: crypto.randomUUID(),
          p_metadata: { source: "school_fees_reversal" },
        });
      }
      setErr(error.message);
      return;
    }
    if (pay?.id) {
      const paidByInvoice = new Map<string, number>();
      for (const a of allocations) {
        paidByInvoice.set(a.invoice_id, (paidByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount));
      }
      for (const inv of targetInvoices) {
        const paidDelta = paidByInvoice.get(inv.id) ?? 0;
        if (paidDelta <= 0) continue;
        const newPaid = round2(Number(inv.amount_paid) + paidDelta);
        const totalDue = Number(inv.total_due);
        await supabase
          .from("student_invoices")
          .update({
            amount_paid: newPaid,
            status: newPaid >= totalDue ? "paid" : "partial",
          })
          .eq("id", inv.id);
      }
    }
    const receiptNo = `R-${Date.now().toString(36).toUpperCase()}`;
    const rIns = await supabase.from("school_receipts").insert({
      school_payment_id: pay.id,
      receipt_number: receiptNo,
      delivery_channels: ["print"],
    });
    if (rIns.error) {
      setErr(rIns.error.message);
      return;
    }
    setForm({ student_id: "", invoice_id: "", amount: "", method: "cash" });
    load();
  };

  const openPrintReceipt = async (payment: PayRow) => {
    setErr(null);
    const { data: existingRows, error: fetchErr } = await supabase
      .from("school_receipts")
      .select("receipt_number,issued_at")
      .eq("school_payment_id", payment.id)
      .order("issued_at", { ascending: false })
      .limit(1);
    if (fetchErr) {
      setErr(fetchErr.message);
      return;
    }
    const existing = existingRows?.[0] as { receipt_number: string; issued_at: string } | undefined;
    let receipt_number = existing?.receipt_number;
    let issued_at = existing?.issued_at;
    if (!receipt_number || !issued_at) {
      const receiptNo = `R-${Date.now().toString(36).toUpperCase()}`;
      const ins = await supabase
        .from("school_receipts")
        .insert({
          school_payment_id: payment.id,
          receipt_number: receiptNo,
          delivery_channels: ["print"],
        })
        .select("receipt_number,issued_at")
        .single();
      if (ins.error) {
        setErr(ins.error.message);
        return;
      }
      receipt_number = (ins.data as { receipt_number: string }).receipt_number;
      issued_at = (ins.data as { issued_at: string }).issued_at;
    }
    const st = students.find((s) => s.id === payment.student_id);
    const studentLabel = st
      ? `${st.admission_number} — ${st.first_name} ${st.last_name}`
      : payment.student_id;
    setReceiptPreview(
      schoolFeeReceiptDetailFromPayment(payment, receipt_number, issued_at, studentLabel, orgName, orgAddress)
    );
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">School fees</h1>
        <PageNotes ariaLabel="Payments">
          <p>
            Captures cash, mobile money, bank, wallet, and other methods. Wallet debits the student&apos;s wallet balance (same as the Wallet module).
            Partial payments update invoice balances; a receipt row is created automatically. {refNote}
          </p>
        </PageNotes>
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {!readOnly && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={form.student_id}
            onChange={(e) => setForm((f) => ({ ...f, student_id: e.target.value, invoice_id: "" }))}
          >
            <option value="">Student</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.admission_number} — {s.first_name} {s.last_name}
              </option>
            ))}
          </select>
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={form.invoice_id}
            onChange={(e) => setForm((f) => ({ ...f, invoice_id: e.target.value }))}
          >
            <option value="">Allocate to one invoice (optional)</option>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoice_number} — due {Number(i.total_due - i.amount_paid).toLocaleString()}
              </option>
            ))}
          </select>
          <input
            type="number"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Amount"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={form.method}
            onChange={(e) => setForm((f) => ({ ...f, method: e.target.value as typeof form.method }))}
          >
            <option value="cash">Cash</option>
            <option value="mobile_money">Mobile money</option>
            <option value="bank">Bank</option>
            <option value="transfer">Transfer</option>
            <option value="wallet">Wallet</option>
            <option value="other">Other</option>
          </select>
          <p className="md:col-span-2 text-xs text-slate-600">{refNote}</p>
          <button type="button" onClick={recordPayment} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 w-fit">
            Record school-fee payment
          </button>
        </div>
      )}
      <div className="rounded-xl border border-slate-200 overflow-x-auto bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3 font-semibold text-slate-700">When</th>
              <th className="text-right p-3 font-semibold text-slate-700">Amount</th>
              <th className="text-left p-3 font-semibold text-slate-700">Method</th>
              <th className="text-left p-3 font-semibold text-slate-700">Reference</th>
              <th className="text-right p-3 font-semibold text-slate-700 whitespace-nowrap print:hidden min-w-[7rem]">
                Receipt
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="p-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-slate-500">
                  No payments yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                  <td className="p-3 text-slate-700">{new Date(r.paid_at).toLocaleString()}</td>
                  <td className="p-3 text-right font-medium text-slate-900">{Number(r.amount).toLocaleString()}</td>
                  <td className="p-3 capitalize text-slate-600">
                    {r.method === "wallet" ? "Wallet" : r.method.replace("_", " ")}
                  </td>
                  <td className="p-3 text-slate-600">{r.reference ?? "—"}</td>
                  <td className="p-3 text-right whitespace-nowrap print:hidden min-w-[7rem]">
                    <button
                      type="button"
                      onClick={() => void openPrintReceipt(r)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm font-medium shadow-sm hover:bg-slate-50"
                    >
                      <Printer className="w-4 h-4 shrink-0" aria-hidden />
                      Print receipt
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {receiptPreview && (
        <SchoolFeeReceiptPreviewModal
          detail={receiptPreview}
          onClose={() => setReceiptPreview(null)}
        />
      )}
    </div>
  );
}
