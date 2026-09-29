import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Printer, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { SchoolFeeReceiptPreviewModal } from "@/components/school/SchoolFeeReceiptPreviewModal";
import { schoolFeeReceiptDetailFromPayment, type SchoolFeeReceiptDetail } from "@/lib/schoolFeeReceipt";
import { buildSchoolFeesAutoReference } from "@/lib/autoReference";
import { postSchoolFeePaymentAccounting } from "@/lib/schoolFeeJournal";
import { randomUuid } from "@/lib/randomUuid";
import { boatApi } from "@/lib/boatApi";
import { canUseSchoolApi, listSchoolRows, updateSchoolRow } from "@/lib/schoolApiData";
import { DEFAULT_SCHOOL_PAYMENT_METHODS, SCHOOL_PAYMENT_METHODS, normalizeSchoolPaymentMethods, type SchoolPaymentMethod } from "@/lib/schoolPaymentMethods";

type StudentOpt = { id: string; first_name: string; last_name: string; admission_number: string; class_name?: string | null; school_pay_number?: string | null };
type InvOpt = { id: string; invoice_number: string; total_due: number; amount_paid: number; fee_structure_id: string | null; created_at?: string; student_id?: string; status?: string };
type FeeLine = { code?: string; label?: string; amount?: number; priority?: number };
type FeeStructure = { id: string; line_items: FeeLine[] | null };
type PaymentSlice = { invoice_id: string; amount: number; category_code?: string; category_label?: string; priority?: number };
type SchoolPayImportRow = { row: number; schoolPayCode: string; amount: number; reference: string; paidAt: string; student?: StudentOpt; error?: string };

type PayRow = {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  paid_at: string;
  student_id: string;
  receipt_number?: string | null;
  receipt_issued_at?: string | null;
  bank_gl_account_id?: string | null;
  bank_payment_source?: "schoolpay" | "bank_slip" | null;
};
type BankAccount = { id: string; account_code: string; account_name: string; account_type: string; category?: string | null };

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
  const canBulkReverse = user?.isSuperAdmin === true;
  const [rows, setRows] = useState<PayRow[]>([]);
  const [students, setStudents] = useState<StudentOpt[]>([]);
  const [invoices, setInvoices] = useState<InvOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgAddress, setOrgAddress] = useState<string | null>(null);
  const [orgLogoUrl, setOrgLogoUrl] = useState<string | null>(null);
  const [enabledMethods, setEnabledMethods] = useState<SchoolPaymentMethod[]>(DEFAULT_SCHOOL_PAYMENT_METHODS);
  const [receiptPreview, setReceiptPreview] = useState<SchoolFeeReceiptDetail | null>(null);
  const [importRows, setImportRows] = useState<SchoolPayImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ completed: number; total: number }>({ completed: 0, total: 0 });
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [schoolPayImportBankAccountId, setSchoolPayImportBankAccountId] = useState("");
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<string[]>([]);
  const [bulkMethod, setBulkMethod] = useState<SchoolPaymentMethod>("cash");
  const [bulkBankAccountId, setBulkBankAccountId] = useState("");
  const [bulkBankPaymentSource, setBulkBankPaymentSource] = useState<"schoolpay" | "bank_slip">("bank_slip");
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkReversing, setBulkReversing] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [paymentFilters, setPaymentFilters] = useState({ studentId: "", className: "", method: "", from: "", to: "" });
  const [showBankColumn, setShowBankColumn] = useState(true);
  const [form, setForm] = useState({
    student_id: "",
    invoice_id: "",
    amount: "",
    method: "cash" as SchoolPaymentMethod,
    bank_payment_source: "bank_slip" as "schoolpay" | "bank_slip",
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

  const downloadSchoolPayTemplate = () => {
    const sheet = XLSX.utils.json_to_sheet([{ "SchoolPay Code": "1000123456", Amount: 150000, "Transaction Reference": "TXN-123456789", "Payment Date": new Date().toISOString().slice(0, 10) }]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "SchoolPay payments");
    XLSX.writeFile(book, "boat-schoolpay-upload-template.xlsx");
  };

  const parseSchoolPayFile = async (file?: File) => {
    if (!file) return;
    setImportMessage(null);
    try {
      const book = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheetName = book.SheetNames[0];
      if (!sheetName) throw new Error("The file has no worksheet.");
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[sheetName], { defval: "", raw: true });
      const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
      const valueFor = (row: Record<string, unknown>, names: string[]) => {
        const wanted = names.map(normalized);
        const key = Object.keys(row).find((candidate) => wanted.includes(normalized(candidate)));
        return key ? row[key] : "";
      };
      const studentBySchoolPayCode = new Map(students.filter((student) => student.school_pay_number?.trim()).map((student) => [normalized(student.school_pay_number!), student]));
      const parsed = raw.map((row, index): SchoolPayImportRow => {
        const schoolPayCode = String(valueFor(row, ["SchoolPay Code", "SchoolPay Number", "School Pay Code", "School Pay Number", "Payment Code", "PRN"])).trim();
        const amount = Number(String(valueFor(row, ["Amount", "Amount Paid", "Payment Amount"])).replace(/[^0-9.-]/g, ""));
        const reference = String(valueFor(row, ["Transaction Reference", "Transaction ID", "Payment Reference", "Reference", "Receipt Number"])).trim();
        const dateValue = valueFor(row, ["Payment Date", "Paid At", "Transaction Date", "Date"]);
        const date = dateValue instanceof Date ? dateValue : new Date(String(dateValue));
        const student = studentBySchoolPayCode.get(normalized(schoolPayCode));
        let error = "";
        if (!schoolPayCode) error = "SchoolPay code is missing";
        else if (!student) error = "SchoolPay code is not assigned to a student in BOAT";
        else if (!(amount > 0)) error = "Amount must be greater than zero";
        else if (!reference) error = "SchoolPay reference is missing";
        else if (Number.isNaN(date.getTime())) error = "Payment date is invalid";
        return { row: index + 2, schoolPayCode, amount, reference, paidAt: Number.isNaN(date.getTime()) ? "" : date.toISOString(), student, error: error || undefined };
      });
      setImportRows(parsed);
      setImportMessage(parsed.length ? `Checked ${parsed.length} row${parsed.length === 1 ? "" : "s"}. Review the results before importing.` : "No payment rows were found.");
    } catch (error) {
      setImportRows([]);
      setImportMessage(error instanceof Error ? error.message : "The SchoolPay file could not be read.");
    }
  };

  const importSchoolPayRows = async () => {
    const orgId = user?.organization_id;
    const validRows = importRows.filter((row) => !row.error && row.student);
    if (!orgId || !validRows.length || importing) return;
    if (schoolPayImportBankAccountId && !bankAccounts.some((account) => account.id === schoolPayImportBankAccountId)) {
      setImportMessage("Select a valid receiving bank account for this SchoolPay batch.");
      return;
    }
    if (canUseSchoolApi()) {
      setImportMessage("Bulk SchoolPay upload requires the database-backed school connection.");
      return;
    }
    setImporting(true);
    setImportProgress({ completed: 0, total: validRows.length });
    let imported = 0;
    let skipped = 0;
    const paymentMethod = schoolPayImportBankAccountId ? "bank" : "school_pay";
    // One duplicate lookup for the batch avoids a round trip for every spreadsheet row.
    const existingResult = await supabase.from("school_payments").select("reference").eq("organization_id", orgId).in("reference", validRows.map((row) => row.reference));
    if (existingResult.error) {
      setImporting(false);
      setImportMessage(existingResult.error.message);
      return;
    }
    const existingReferences = new Set(((existingResult.data as Array<{ reference: string | null }> | null) || []).map((payment) => payment.reference).filter((reference): reference is string => !!reference));
    let completed = 0;
    const processRow = async (row: SchoolPayImportRow) => {
      if (existingReferences.has(row.reference)) { skipped += 1; return; }
      // Reserve the reference before awaiting so duplicate rows in concurrent queues cannot both post.
      existingReferences.add(row.reference);
      const invoiceResult = await supabase.from("student_invoices").select("id,total_due,amount_paid").eq("organization_id", orgId).eq("student_id", row.student!.id).neq("status", "cancelled").order("created_at", { ascending: true });
      if (invoiceResult.error) { setImportRows((current) => current.map((item) => item.row === row.row ? { ...item, error: invoiceResult.error.message } : item)); return; }
      let remaining = row.amount;
      const allocations: PaymentSlice[] = [];
      const invoiceUpdates: Array<{ id: string; total: number; paid: number }> = [];
      for (const invoice of invoiceResult.data || []) {
        if (remaining <= 0) break;
        const outstanding = Math.max(0, Number(invoice.total_due) - Number(invoice.amount_paid));
        const applied = round2(Math.min(remaining, outstanding));
        if (applied > 0) {
          allocations.push({ invoice_id: invoice.id, amount: applied, category_code: "GENERAL", category_label: "General", priority: 999 });
          invoiceUpdates.push({ id: invoice.id, total: Number(invoice.total_due), paid: round2(Number(invoice.amount_paid) + applied) });
          remaining = round2(remaining - applied);
        }
      }
      if (!allocations.length) { setImportRows((current) => current.map((item) => item.row === row.row ? { ...item, error: "No open invoice found" } : item)); return; }
      if (remaining > 0) allocations[allocations.length - 1].amount = round2(allocations[allocations.length - 1].amount + remaining);
      const paymentResult = await supabase.from("school_payments").insert({ student_id: row.student!.id, amount: row.amount, method: paymentMethod, bank_gl_account_id: schoolPayImportBankAccountId || null, bank_payment_source: schoolPayImportBankAccountId ? "schoolpay" : null, reference: row.reference, paid_at: row.paidAt, recorded_by: user?.id ?? null, invoice_allocations: allocations, notes: "Bulk imported from SchoolPay" }).select("id").single();
      if (paymentResult.error) { setImportRows((current) => current.map((item) => item.row === row.row ? { ...item, error: paymentResult.error.message } : item)); return; }
      const updateResults = await Promise.all(invoiceUpdates.map((invoice) => supabase.from("student_invoices").update({ amount_paid: invoice.paid, status: invoice.paid >= invoice.total ? "paid" : "partial" }).eq("id", invoice.id)));
      const updateError = updateResults.find((result) => result.error)?.error;
      if (updateError) { setImportRows((current) => current.map((item) => item.row === row.row ? { ...item, error: updateError.message } : item)); return; }
      await Promise.all([
        postSchoolFeePaymentAccounting({ organizationId: orgId, staffUserId: user?.id ?? null, paymentId: paymentResult.data.id, amount: row.amount, method: paymentMethod, paidAt: row.paidAt, studentId: row.student!.id, bankGlAccountId: schoolPayImportBankAccountId || null }),
        supabase.from("school_receipts").insert({ school_payment_id: paymentResult.data.id, receipt_number: `SP-${row.reference}`, delivery_channels: ["school_pay"] }),
      ]);
      imported += 1;
    };
    // Different students run in parallel; rows for one student remain ordered so allocations cannot race.
    const queues = [...validRows.reduce((groups, row) => {
      const key = row.student!.id;
      groups.set(key, [...(groups.get(key) || []), row]);
      return groups;
    }, new Map<string, SchoolPayImportRow[]>()).values()];
    const workers = Array.from({ length: Math.min(4, queues.length) }, async () => {
      while (queues.length) {
        const queue = queues.shift();
        if (!queue) return;
        for (const row of queue) {
          try { await processRow(row); }
          catch (error) { setImportRows((current) => current.map((item) => item.row === row.row ? { ...item, error: error instanceof Error ? error.message : "Import failed" } : item)); }
          finally { completed += 1; setImportProgress({ completed, total: validRows.length }); }
        }
      }
    });
    await Promise.all(workers);
    sessionStorage.removeItem(`boat.school.available-funds.${orgId}`);
    setImporting(false);
    setImportProgress({ completed: validRows.length, total: validRows.length });
    setImportRows([]);
    setImportMessage(`Imported ${imported} SchoolPay payment${imported === 1 ? "" : "s"}${skipped ? `; skipped ${skipped} duplicate reference${skipped === 1 ? "" : "s"}` : ""}.`);
    await load();
  };

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = user?.organization_id;
    if (!orgId) {
      setLoading(false);
      return;
    }
    if (canUseSchoolApi()) {
      try {
        const [payments, studentRows] = await Promise.all([
          listSchoolRows<PayRow>("payments", orgId),
          listSchoolRows<StudentOpt>("students", orgId),
        ]);
        setRows(payments);
        setStudents(studentRows);
        setErr(null);
      } catch (error) {
        setErr(error instanceof Error ? error.message : "Failed to load school payments.");
      } finally {
        setLoading(false);
      }
      return;
    }
    const [pRes, sRes] = await Promise.all([
      supabase.from("school_payments").select("*").eq("organization_id", orgId).order("paid_at", { ascending: false }).limit(100),
      supabase.from("students").select("id,first_name,last_name,admission_number,class_name,school_pay_number").eq("organization_id", orgId).order("last_name"),
    ]);
    setErr(pRes.error?.message || sRes.error?.message || null);
    setRows((pRes.data as PayRow[]) || []);
    setStudents((sRes.data as StudentOpt[]) || []);
    setLoading(false);
  }, [user?.organization_id]);

  useEffect(() => {
    if (!user?.organization_id) {
      setBankAccounts([]);
      return;
    }
    void supabase
      .from("gl_accounts")
      .select("id,account_code,account_name,account_type,category")
      .eq("organization_id", user.organization_id)
      .eq("account_type", "asset")
      .order("account_code")
      .then(({ data }) => {
        const accounts = ((data as BankAccount[] | null) || []).filter((account) => /bank/i.test(`${account.account_name} ${account.category || ""}`));
        setBankAccounts(accounts);
      });
  }, [user?.organization_id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!user?.organization_id) {
      setOrgName(null);
      setOrgAddress(null);
      setOrgLogoUrl(null);
      return;
    }
    void supabase
      .from("organizations")
      .select("name,address,logo_url,school_payment_methods")
      .eq("id", user.organization_id)
      .maybeSingle()
      .then(({ data }) => {
        const o = data as { name?: string; address?: string | null; logo_url?: string | null; school_payment_methods?: string[] | null } | null;
        setOrgName(o?.name ?? null);
        setOrgAddress(o?.address?.trim() ? o.address : null);
        setOrgLogoUrl(o?.logo_url?.trim() ? o.logo_url : null);
        const methods = normalizeSchoolPaymentMethods(o?.school_payment_methods);
        setEnabledMethods(methods);
        setForm((f) => methods.includes(f.method) ? f : { ...f, method: methods[0] });
      });
  }, [user?.organization_id]);

  useEffect(() => {
    (async () => {
      if (!form.student_id || !user?.organization_id) {
        setInvoices([]);
        return;
      }
      if (canUseSchoolApi()) {
        try {
          const allInvoices = await listSchoolRows<InvOpt>("invoices", user.organization_id);
          setInvoices(
            allInvoices
              .filter((invoice) => invoice.student_id === form.student_id && invoice.status !== "cancelled")
              .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
          );
        } catch (error) {
          setErr(error instanceof Error ? error.message : "Failed to load student invoices.");
          setInvoices([]);
        }
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
    if (saving) return;
    setSaving(true);
    try {
      await recordPaymentImpl();
    } finally {
      setSaving(false);
    }
  };

  const recordPaymentImpl = async () => {
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
    if (canUseSchoolApi()) {
      if (form.method === "wallet") {
        setErr("Wallet payments are not enabled in server-backed school mode yet. Use cash, mobile money, bank, transfer, or other.");
        return;
      }
      setErr(null);
      try {
        const result = await boatApi.school.recordPayment<{
          payment: PayRow;
          receipt: { receipt_number: string; issued_at: string };
        }>({
          organization_id: orgId,
          student_id: form.student_id,
          invoice_id: form.invoice_id || null,
          amount: amt,
          method: form.method,
          bank_payment_source: (form.method === "bank" || form.method === "transfer") ? form.bank_payment_source : null,
          staff_user_id: user?.id ?? null,
        });
        const payment = result.data.payment;
        const receipt = result.data.receipt;
        const st = students.find((s) => s.id === payment.student_id);
        setReceiptPreview(
          schoolFeeReceiptDetailFromPayment(
            payment,
            receipt.receipt_number,
            receipt.issued_at,
            st ? `${st.admission_number} - ${st.first_name} ${st.last_name}` : payment.student_id,
            orgName,
            orgAddress,
            orgLogoUrl,
            st?.school_pay_number ?? null
          )
        );
        setForm({ student_id: "", invoice_id: "", amount: "", method: enabledMethods[0] || "cash" });
        await load();
      } catch (error) {
        setErr(error instanceof Error ? error.message : "Failed to record payment.");
      }
      return;
    }
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
        p_idempotency_key: randomUuid(),
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
        bank_payment_source: (form.method === "bank" || form.method === "transfer") ? form.bank_payment_source : null,
        reference: autoRef,
        invoice_allocations: allocations,
      })
      .select("id,amount,method,reference,paid_at,student_id")
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
          p_idempotency_key: randomUuid(),
          p_metadata: { source: "school_fees_reversal" },
        });
      }
      setErr(
        error.message.includes("school_payments_method_check")
          ? "This payment method is not enabled in the database yet. Apply migration 20260722151000_fix_school_payment_methods.sql, then try again."
          : error.message
      );
      return;
    }
    const receiptNo = `R-${Date.now().toString(36).toUpperCase()}`;
    if (pay?.id) {
      const paidAtIso = new Date().toISOString();
      const paidByInvoice = new Map<string, number>();
      for (const a of allocations) {
        paidByInvoice.set(a.invoice_id, (paidByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount));
      }
      const invoiceUpdates = targetInvoices.flatMap((inv) => {
        const paidDelta = paidByInvoice.get(inv.id) ?? 0;
        if (paidDelta <= 0) return [];
        const newPaid = round2(Number(inv.amount_paid) + paidDelta);
        return [supabase
          .from("student_invoices")
          .update({ amount_paid: newPaid, status: newPaid >= Number(inv.total_due) ? "paid" : "partial" })
          .eq("id", inv.id)];
      });
      const [accountingResult, invoiceResults, receiptResult] = await Promise.all([
        postSchoolFeePaymentAccounting({
          organizationId: orgId,
          staffUserId: user?.id ?? null,
          paymentId: pay.id as string,
          amount: amt,
          method: form.method,
          paidAt: paidAtIso,
          studentId: form.student_id,
        }),
        Promise.all(invoiceUpdates),
        supabase.from("school_receipts").insert({
          school_payment_id: pay.id,
          receipt_number: receiptNo,
          delivery_channels: ["print"],
        }),
      ]);
      if (accountingResult.journalMessage) console.warn("[school payment journal]", accountingResult.journalMessage);
      const invoiceError = invoiceResults.find((result) => result.error)?.error;
      if (invoiceError) {
        setErr(invoiceError.message);
        return;
      }
      if (receiptResult.error) {
        setErr(receiptResult.error.message);
        return;
      }
    }
    setRows((current) => [{ ...(pay as PayRow), receipt_number: receiptNo }, ...current].slice(0, 100));
    sessionStorage.removeItem(`boat.school.available-funds.${orgId}`);
    setForm({ student_id: "", invoice_id: "", amount: "", method: enabledMethods[0] || "cash", bank_payment_source: "bank_slip" });
  };

  const openPrintReceipt = async (payment: PayRow) => {
    setErr(null);
    if (canUseSchoolApi()) {
      const st = students.find((s) => s.id === payment.student_id);
      setReceiptPreview(
        schoolFeeReceiptDetailFromPayment(
          payment,
          payment.receipt_number || payment.reference || `R-${payment.id.slice(0, 8).toUpperCase()}`,
          payment.receipt_issued_at || payment.paid_at,
          st ? `${st.admission_number} - ${st.first_name} ${st.last_name}` : payment.student_id,
          orgName,
          orgAddress,
          orgLogoUrl,
          st?.school_pay_number ?? null
        )
      );
      return;
    }
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
      schoolFeeReceiptDetailFromPayment(payment, receipt_number, issued_at, studentLabel, orgName, orgAddress, orgLogoUrl, st?.school_pay_number ?? null)
    );
  };

  const applyBulkPaymentEdit = async () => {
    const orgId = user?.organization_id;
    if (!orgId || selectedPaymentIds.length === 0 || bulkUpdating) return;
    const needsBankAccount = bulkMethod === "bank" || bulkMethod === "transfer";
    if (needsBankAccount && !bulkBankAccountId) {
      setErr("Select the bank account receiving these payments.");
      return;
    }
    if (!window.confirm(`Update ${selectedPaymentIds.length} payment${selectedPaymentIds.length === 1 ? "" : "s"} to ${SCHOOL_PAYMENT_METHODS.find((item) => item.code === bulkMethod)?.label || bulkMethod}?`)) return;
    setBulkUpdating(true);
    setBulkMessage(null);
    setErr(null);
    const patch = { method: bulkMethod, bank_gl_account_id: needsBankAccount ? bulkBankAccountId : null, bank_payment_source: needsBankAccount ? bulkBankPaymentSource : null };
    let updated = 0;
    const failures: string[] = [];
    for (const id of selectedPaymentIds) {
      try {
        let payment: PayRow;
        if (canUseSchoolApi()) {
          payment = await updateSchoolRow<PayRow>("payments", orgId, id, patch);
        } else {
          const result = await supabase.from("school_payments").update(patch).eq("organization_id", orgId).eq("id", id).select("*").single();
          if (result.error) throw result.error;
          payment = result.data as PayRow;
          const accounting = await postSchoolFeePaymentAccounting({
            organizationId: orgId,
            staffUserId: user?.id ?? null,
            paymentId: payment.id,
            amount: Number(payment.amount),
            method: payment.method,
            paidAt: payment.paid_at,
            studentId: payment.student_id,
            bankGlAccountId: payment.bank_gl_account_id,
          });
          if (accounting.journalMessage) throw new Error(accounting.journalMessage);
        }
        setRows((current) => current.map((row) => row.id === id ? { ...row, ...payment } : row));
        updated += 1;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : `Payment ${id} could not be updated.`);
      }
    }
    setSelectedPaymentIds([]);
    setBulkUpdating(false);
    setBulkMessage(`Updated ${updated} payment${updated === 1 ? "" : "s"}${failures.length ? `; ${failures.length} failed.` : "."}`);
    if (failures.length) setErr(failures[0]);
  };

  const togglePaymentSelection = (id: string) => {
    setSelectedPaymentIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const reverseSelectedPayments = async () => {
    const orgId = user?.organization_id;
    if (!orgId || !selectedPaymentIds.length || bulkReversing) return;
    if (!window.confirm(`Reverse ${selectedPaymentIds.length} selected fee payment${selectedPaymentIds.length === 1 ? "" : "s"}? This restores invoice balances and cannot be undone.`)) return;
    setBulkReversing(true);
    setErr(null);
    let reversed = 0;
    for (const id of selectedPaymentIds) {
      const result = await supabase.rpc("reverse_school_fee_payment", { p_payment_id: id, p_organization_id: orgId });
      if (result.error) { setErr(result.error.message); break; }
      reversed += 1;
    }
    if (reversed) {
      setRows((current) => current.filter((row) => !selectedPaymentIds.slice(0, reversed).includes(row.id)));
      setSelectedPaymentIds([]);
      setBulkMessage(`Reversed ${reversed} payment${reversed === 1 ? "" : "s"}.`);
    }
    setBulkReversing(false);
  };

  const visiblePayments = useMemo(() => rows.filter((payment) => {
    const day = String(payment.paid_at || "").slice(0, 10);
    return (!paymentFilters.studentId || payment.student_id === paymentFilters.studentId)
      && (!paymentFilters.className || students.find((student) => student.id === payment.student_id)?.class_name === paymentFilters.className)
      && (!paymentFilters.method || payment.method === paymentFilters.method)
      && (!paymentFilters.from || day >= paymentFilters.from)
      && (!paymentFilters.to || day <= paymentFilters.to);
  }), [rows, students, paymentFilters]);

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">School fees</h1>
        <PageNotes ariaLabel="Payments">
          <p>
            Captures cash, mobile money, bank, SchoolPay, wallet, and other methods. Wallet debits the student&apos;s wallet balance (same as the Wallet module).
            Partial payments update invoice balances; a receipt row is created automatically. {refNote}
          </p>
        </PageNotes>
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {!readOnly && (
        <>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-semibold text-slate-900">Bulk upload from SchoolPay</h2><p className="mt-1 text-sm text-slate-600">Upload the updated Excel or CSV list. BOAT matches each payment using the student&apos;s unique SchoolPay code, checks duplicate transaction references, and allocates payments to their oldest open invoices.</p></div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={downloadSchoolPayTemplate} className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800"><Download className="h-4 w-4"/> Template</button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800"><Upload className="h-4 w-4"/> Choose SchoolPay file<input type="file" accept=".xlsx,.xls,.csv,text/csv" className="hidden" onChange={(event) => { void parseSchoolPayFile(event.target.files?.[0]); event.currentTarget.value = ""; }}/></label>
            </div>
          </div>
          <label className="block max-w-md text-sm font-medium text-slate-700">Receiving bank for this SchoolPay batch (optional)
            <select value={schoolPayImportBankAccountId} onChange={(event) => setSchoolPayImportBankAccountId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">Keep as SchoolPay (no bank account)</option>{bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.account_code} — {account.account_name}</option>)}</select>
            <span className="mt-1 block text-xs font-normal text-slate-600">Choose a bank to save each import as <strong>Bank · SchoolPay to bank</strong>. Leave blank for a regular SchoolPay payment.</span>
          </label>
          {importMessage && <p className="text-sm text-slate-700" role="status">{importMessage}</p>}
          {importing && importProgress.total > 0 && <div className="space-y-1" role="status" aria-live="polite"><div className="flex justify-between text-xs font-medium text-slate-700"><span>Importing payments…</span><span>{importProgress.completed} of {importProgress.total}</span></div><div className="h-2 overflow-hidden rounded-full bg-emerald-100"><div className="h-full bg-emerald-600 transition-all" style={{ width: `${Math.round(importProgress.completed / importProgress.total * 100)}%` }} /></div></div>}
          {importRows.length > 0 && <div className="space-y-3"><div className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white"><table className="w-full min-w-[720px] text-sm"><thead className="sticky top-0 bg-slate-50"><tr><th className="p-2 text-left">Row</th><th className="p-2 text-left">SchoolPay code</th><th className="p-2 text-left">Student</th><th className="p-2 text-right">Amount</th><th className="p-2 text-left">Transaction reference</th><th className="p-2 text-left">Result</th></tr></thead><tbody>{importRows.map((row) => <tr key={row.row} className="border-t border-slate-100"><td className="p-2">{row.row}</td><td className="p-2">{row.schoolPayCode || "—"}</td><td className="p-2">{row.student ? `${row.student.first_name} ${row.student.last_name}` : "—"}</td><td className="p-2 text-right">{row.amount > 0 ? row.amount.toLocaleString() : "—"}</td><td className="p-2">{row.reference || "—"}</td><td className={`p-2 ${row.error ? "text-red-600" : "text-emerald-700"}`}>{row.error || "Ready"}</td></tr>)}</tbody></table></div><div className="flex items-center justify-between gap-3"><p className="text-xs text-slate-600">{importRows.filter((row) => !row.error).length} ready · {importRows.filter((row) => row.error).length} need attention</p><button type="button" onClick={() => void importSchoolPayRows()} disabled={importing || !importRows.some((row) => !row.error)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{importing ? "Importing…" : "Import ready payments"}</button></div></div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={form.student_id}
            onChange={(e) => setForm((f) => ({ ...f, student_id: e.target.value, invoice_id: "" }))}
          >
            <option value="">Student</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.admission_number} — {s.first_name} {s.last_name}{s.school_pay_number ? ` · SchoolPay: ${s.school_pay_number}` : ""}
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
            {SCHOOL_PAYMENT_METHODS.filter((method) => enabledMethods.includes(method.code)).map((method) => (
              <option key={method.code} value={method.code}>{method.label}</option>
            ))}
          </select>
          <p className="md:col-span-2 text-xs text-slate-600">{refNote}</p>
          <button type="button" onClick={recordPayment} disabled={saving} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60 w-fit">
            {saving ? "Saving payment..." : "Record school-fee payment"}
          </button>
        </div>
        </>
      )}
      {!readOnly && <section className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
        <div><h2 className="font-semibold text-slate-900">Bulk edit payment routing</h2><p className="mt-1 text-sm text-slate-600">Select recorded payments below, then change their method and, for bank or transfer payments, the bank account that received the money. The related accounting entries are reposted.</p></div>
        <div className="grid gap-3 md:grid-cols-3">
          <select value={bulkMethod} onChange={(event) => setBulkMethod(event.target.value as SchoolPaymentMethod)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            {SCHOOL_PAYMENT_METHODS.filter((method) => enabledMethods.includes(method.code)).map((method) => <option key={method.code} value={method.code}>{method.label}</option>)}
          </select>
          {(form.method === "bank" || form.method === "transfer") && <select className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.bank_payment_source} onChange={(e) => setForm((f) => ({ ...f, bank_payment_source: e.target.value as "schoolpay" | "bank_slip" }))}><option value="bank_slip">Direct bank slip</option><option value="schoolpay">SchoolPay to bank</option></select>}
          {(bulkMethod === "bank" || bulkMethod === "transfer") && <select value={bulkBankAccountId} onChange={(event) => setBulkBankAccountId(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">Select receiving bank account</option>
            {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.account_code} — {account.account_name}</option>)}
          </select>}
          {(bulkMethod === "bank" || bulkMethod === "transfer") && <select value={bulkBankPaymentSource} onChange={(event) => setBulkBankPaymentSource(event.target.value as "schoolpay" | "bank_slip")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="bank_slip">Direct bank slip</option><option value="schoolpay">SchoolPay to bank</option></select>}
          <button type="button" onClick={() => void applyBulkPaymentEdit()} disabled={bulkUpdating || selectedPaymentIds.length === 0} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{bulkUpdating ? "Updating…" : `Update selected (${selectedPaymentIds.length})`}</button>
          {canBulkReverse && <button type="button" onClick={() => void reverseSelectedPayments()} disabled={bulkReversing || selectedPaymentIds.length === 0} className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50">{bulkReversing ? "Reversing…" : `Reverse selected (${selectedPaymentIds.length})`}</button>}
        </div>
        {(bulkMethod === "bank" || bulkMethod === "transfer") && bankAccounts.length === 0 && <p className="text-xs text-amber-800">No bank asset accounts were found. Add the bank account in the chart of accounts first.</p>}
        {bulkMessage && <p className="text-sm text-slate-700" role="status">{bulkMessage}</p>}
      </section>}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <input type="date" aria-label="Payments from date" value={paymentFilters.from} onChange={(event) => setPaymentFilters((filters) => ({ ...filters, from: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input type="date" aria-label="Payments to date" value={paymentFilters.to} onChange={(event) => setPaymentFilters((filters) => ({ ...filters, to: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <select aria-label="Filter payments by student" value={paymentFilters.studentId} onChange={(event) => setPaymentFilters((filters) => ({ ...filters, studentId: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All students</option>{students.map((student) => <option key={student.id} value={student.id}>{student.admission_number} — {student.first_name} {student.last_name}</option>)}</select>
          <select aria-label="Filter payments by class" value={paymentFilters.className} onChange={(event) => setPaymentFilters((filters) => ({ ...filters, className: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All classes</option>{[...new Set(students.map((student) => student.class_name).filter((className): className is string => Boolean(className)))].sort().map((className) => <option key={className} value={className}>{className}</option>)}</select>
          <select aria-label="Filter payments by method" value={paymentFilters.method} onChange={(event) => setPaymentFilters((filters) => ({ ...filters, method: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All methods</option>{SCHOOL_PAYMENT_METHODS.map((method) => <option key={method.code} value={method.code}>{method.label}</option>)}</select>
        </div>
        <div className="mt-3 flex items-center gap-3">{Object.values(paymentFilters).some(Boolean) && <><span className="text-xs text-slate-600">{visiblePayments.length} payment{visiblePayments.length === 1 ? "" : "s"} shown</span><button type="button" onClick={() => setPaymentFilters({ studentId: "", className: "", method: "", from: "", to: "" })} className="text-xs font-semibold text-indigo-700 hover:underline">Clear filters</button></>}<label className="ml-auto text-xs text-slate-700"><input type="checkbox" checked={showBankColumn} onChange={(event) => setShowBankColumn(event.target.checked)} className="mr-1" /> Show deposited-to column</label></div>
      </section>
      <div className="rounded-xl border border-slate-200 overflow-x-auto bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {!readOnly && <th className="w-10 p-3"><input type="checkbox" aria-label="Select all filtered payments" checked={visiblePayments.length > 0 && visiblePayments.every((row) => selectedPaymentIds.includes(row.id))} onChange={(event) => setSelectedPaymentIds(event.target.checked ? [...new Set([...selectedPaymentIds, ...visiblePayments.map((row) => row.id)])] : selectedPaymentIds.filter((id) => !visiblePayments.some((row) => row.id === id)))} /></th>}
              <th className="text-left p-3 font-semibold text-slate-700">When</th>
              <th className="text-left p-3 font-semibold text-slate-700">SchoolPay code</th>
              <th className="text-left p-3 font-semibold text-slate-700">Student</th>
              <th className="text-left p-3 font-semibold text-slate-700">Class</th>
              <th className="text-right p-3 font-semibold text-slate-700">Amount</th>
              <th className="text-left p-3 font-semibold text-slate-700">Method</th>
              {showBankColumn && <th className="text-left p-3 font-semibold text-slate-700">Deposited to</th>}
              <th className="text-left p-3 font-semibold text-slate-700">Reference</th>
              <th className="text-right p-3 font-semibold text-slate-700 whitespace-nowrap print:hidden min-w-[7rem]">
                Receipt
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={(readOnly ? 8 : 9) + (showBankColumn ? 1 : 0)} className="p-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : visiblePayments.length === 0 ? (
              <tr>
                <td colSpan={(readOnly ? 8 : 9) + (showBankColumn ? 1 : 0)} className="p-6 text-slate-500">
                  No payments yet.
                </td>
              </tr>
            ) : (
              visiblePayments.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                   {!readOnly && <td className="p-3"><input type="checkbox" aria-label={`Select payment ${r.reference || r.id}`} checked={selectedPaymentIds.includes(r.id)} onChange={() => togglePaymentSelection(r.id)} /></td>}
                  <td className="p-3 text-slate-700">{new Date(r.paid_at).toLocaleString()}</td>
                    <td className="p-3 font-mono text-slate-700">{students.find((student) => student.id === r.student_id)?.school_pay_number || "—"}</td>
                    <td className="p-3 text-slate-700">{(() => { const student = students.find((item) => item.id === r.student_id); return student ? `${student.first_name} ${student.last_name}` : "—"; })()}</td>
                    <td className="p-3 text-slate-700">{students.find((student) => student.id === r.student_id)?.class_name || "—"}</td>
                  <td className="p-3 text-right font-medium text-slate-900">{Number(r.amount).toLocaleString()}</td>
                   <td className="p-3 capitalize text-slate-600">
                    {r.method === "wallet" ? "Wallet" : r.method.replace("_", " ")}
                   </td>
                   {showBankColumn && <td className="p-3 text-slate-600">{r.bank_gl_account_id ? bankAccounts.find((account) => account.id === r.bank_gl_account_id)?.account_name || "Bank account" : "—"}</td>}
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
