import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowDownUp, ArrowUp, Download, FolderOpen, Pencil, Printer, Upload, X } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { SearchableCombobox } from "@/components/common/SearchableCombobox";
import { SchoolFeeReceiptPreviewModal } from "@/components/school/SchoolFeeReceiptPreviewModal";
import { schoolFeeReceiptDetailFromPayment, type SchoolFeeReceiptDetail } from "@/lib/schoolFeeReceipt";
import { buildSchoolFeesAutoReference } from "@/lib/autoReference";
import { postSchoolFeePaymentAccounting } from "@/lib/schoolFeeJournal";
import { randomUuid } from "@/lib/randomUuid";
import { boatApi } from "@/lib/boatApi";
import { canUseSchoolApi, listSchoolRows, updateSchoolRow } from "@/lib/schoolApiData";
import { DEFAULT_SCHOOL_PAYMENT_METHODS, SCHOOL_PAYMENT_METHODS, normalizeSchoolPaymentMethods, type SchoolPaymentMethod } from "@/lib/schoolPaymentMethods";
import { fetchAllPages } from "@/lib/supabasePagination";
import { matchStudentStatement, type MatchableStudent } from "@/lib/schoolStudentMatching";

type StudentOpt = MatchableStudent & { class_name?: string | null };
type InvOpt = { id: string; invoice_number: string; total_due: number; amount_paid: number; fee_structure_id: string | null; academic_year?: string | null; term_name?: string | null; created_at?: string; student_id?: string; status?: string };
type FeeLine = { code?: string; label?: string; amount?: number; priority?: number };
type FeeStructure = { id: string; line_items: FeeLine[] | null };
type PaymentSlice = { invoice_id: string; amount: number; category_code?: string; category_label?: string; priority?: number };
type SchoolPayImportRow = { row: number; schoolPayCode: string; amount: number; reference: string; paidAt: string; student?: StudentOpt; error?: string };
type DirectBankImportRow = { row: number; sourceFileName: string; bank: string; bankAccount: BankAccount; admissionNumber: string; statementDescription: string; matchEvidence: string; matchBasis?: string; feeType: string; amount: number; reference: string; paidAt: string; notes: string; student?: StudentOpt; error?: string };

type PayRow = {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  paid_at: string;
  notes?: string | null;
  student_id: string;
  receipt_number?: string | null;
  receipt_issued_at?: string | null;
  bank_gl_account_id?: string | null;
  bank_payment_source?: "schoolpay" | "bank_slip" | null;
  invoice_allocations?: PaymentSlice[] | null;
};
type BankAccount = { id: string; account_code: string; account_name: string; account_type: string; category?: string | null };
type BudgetIncomeLine = { line_label: string };
type PaymentFilters = { studentId: string; className: string; method: string; bankAccountId: string; incomeType: string; from: string; to: string; month: string };
type PaymentSortKey = "paid_at" | "schoolpay" | "student" | "class" | "income" | "amount" | "method" | "bank" | "upload" | "reference";

const DEFAULT_INCOME_TYPES = [
  "School Fees",
  "Mock Fees",
  "UNEB Fees",
  "Examination Fees",
  "Registration Fees",
  "Development Fees",
  "Transport Fees",
  "Meals Fees",
  "Uniform Fees",
  "Boarding Fees",
];

const SCHOOL_FEES_ALIASES = new Set([
  "general",
  "utilities",
  "ict",
  "church fund",
  "sesemat",
  "asshu",
  "co-curricular",
  "co curricular",
  "plant maintainance",
  "plant maintenance",
  "unsa",
  "boarding fees",
  "materials",
  "tuition day",
  "tuition boarding",
]);

function normalizeIncomeType(value: string | null | undefined): string {
  const label = String(value || "").trim();
  return SCHOOL_FEES_ALIASES.has(label.toLocaleLowerCase()) ? "School Fees" : label || "School Fees";
}

function uploadFileFromNotes(notes: string | null | undefined): string | null {
  const match = String(notes || "").match(/(?:^|\s·\s)Upload file:\s*([^·]+?)(?=\s·\s|$)/i);
  return match?.[1]?.trim() || null;
}

function paymentLocalDay(value: string | null | undefined): string {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return String(value || "").slice(0, 10);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function monthBounds(month: string): { from: string; toExclusive: string } | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  return { from: month + "-01", toExclusive: new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10) };
}

function paymentBatchKey(payment: PayRow): string | null {
  const tagged = String(payment.notes || "").match(/(?:^|\s·\s)Batch:\s*([^·]+?)(?=\s·\s|$)/i)?.[1]?.trim();
  if (tagged) return "batch:" + tagged;
  const file = uploadFileFromNotes(payment.notes);
  return file ? "file:" + file : null;
}

function paymentBatchLabel(payment: PayRow): string | null {
  const key = paymentBatchKey(payment);
  if (!key) return null;
  return key.startsWith("file:") ? uploadFileFromNotes(payment.notes) || "Imported file" : key.slice("batch:".length);
}

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
  const canEditBatches = user?.isSuperAdmin === true || user?.role === "admin" || user?.role === "super_admin";
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
  const [directBankImportRows, setDirectBankImportRows] = useState<DirectBankImportRow[]>([]);
  const [directBankImporting, setDirectBankImporting] = useState(false);
  const [directBankImportProgress, setDirectBankImportProgress] = useState({ completed: 0, total: 0 });
  const [directBankImportMessage, setDirectBankImportMessage] = useState<string | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [budgetIncomeTypes, setBudgetIncomeTypes] = useState<string[]>([]);
  const [studentAliases, setStudentAliases] = useState<Array<{ student_id: string; alias: string }>>([]);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<string[]>([]);
  const [bulkMethod, setBulkMethod] = useState<SchoolPaymentMethod>("cash");
  const [bulkBankAccountId, setBulkBankAccountId] = useState("");
  const [bulkBankPaymentSource, setBulkBankPaymentSource] = useState<"schoolpay" | "bank_slip">("bank_slip");
  const [bulkEditTab, setBulkEditTab] = useState<"routing" | "income_type">("routing");
  const [bulkIncomeType, setBulkIncomeType] = useState("");
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkUpdateProgress, setBulkUpdateProgress] = useState({ completed: 0, total: 0 });
  const [bulkReversing, setBulkReversing] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [paymentFilters, setPaymentFilters] = useState<PaymentFilters>({ studentId: "", className: "", method: "", bankAccountId: "", incomeType: "", from: "", to: "", month: "" });
  const [showBankColumn, setShowBankColumn] = useState(true);
  const [paymentSort, setPaymentSort] = useState<{ key: PaymentSortKey; direction: "asc" | "desc" }>({ key: "paid_at", direction: "desc" });
  const [openBatchKey, setOpenBatchKey] = useState<string | null>(null);
  const [editingPayment, setEditingPayment] = useState<PayRow | null>(null);
  const [editPaidDate, setEditPaidDate] = useState("");
  const [savingPaymentEdit, setSavingPaymentEdit] = useState(false);
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
    const batchLabel = `SchoolPay ${new Date().toISOString().replace(/[:.]/g, "-")}`;
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
      if (existingReferences.has(row.reference)) {
        skipped += 1;
        setImportRows((current) => current.map((item) => item.row === row.row ? { ...item, error: "Duplicate reference — not imported" } : item));
        return;
      }
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
          allocations.push({ invoice_id: invoice.id, amount: applied, category_code: "GENERAL", category_label: "School Fees", priority: 999 });
          invoiceUpdates.push({ id: invoice.id, total: Number(invoice.total_due), paid: round2(Number(invoice.amount_paid) + applied) });
          remaining = round2(remaining - applied);
        }
      }
      if (!allocations.length) { setImportRows((current) => current.map((item) => item.row === row.row ? { ...item, error: "No open invoice found" } : item)); return; }
      if (remaining > 0) allocations[allocations.length - 1].amount = round2(allocations[allocations.length - 1].amount + remaining);
      const paymentResult = await supabase.from("school_payments").insert({ student_id: row.student!.id, amount: row.amount, method: paymentMethod, bank_gl_account_id: schoolPayImportBankAccountId || null, bank_payment_source: schoolPayImportBankAccountId ? "schoolpay" : null, reference: row.reference, paid_at: row.paidAt, recorded_by: user?.id ?? null, invoice_allocations: allocations, notes: `Bulk imported from SchoolPay · Batch: ${batchLabel}` }).select("id").single();
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

  const parseDirectBankFile = async (file?: File) => {
    if (!file) return;
    setDirectBankImportMessage(null);
    try {
      const book = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheetName = book.SheetNames[0];
      if (!sheetName) throw new Error("The file has no worksheet.");
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[sheetName], { defval: "", raw: true });
      const normalized = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const valueFor = (row: Record<string, unknown>, names: string[]) => {
        const wanted = names.map(normalized);
        const key = Object.keys(row).find((candidate) => wanted.includes(normalized(candidate)));
        return key ? row[key] : "";
      };
      const studentByAdmission = new Map(students.map((student) => [normalized(student.admission_number), student]));
      const accountByName = new Map<string, BankAccount>();
      bankAccounts.forEach((account) => {
        [account.account_code, account.account_name, `${account.account_code} ${account.account_name}`].forEach((value) => accountByName.set(normalized(value), account));
      });
      const parsed = raw.map((row, index): DirectBankImportRow => {
        const admissionNumber = String(valueFor(row, ["Student Admission Number", "Admission Number", "Admission No", "Student Number"])).trim();
        const statementDescription = String(valueFor(row, ["Statement Description", "Description", "Narration", "Details"])).trim();
        const studentName = String(valueFor(row, ["Student Name", "Payer Name", "Customer Name", "Depositor Name"])).trim();
        const schoolPayCode = String(valueFor(row, ["SchoolPay Code", "SchoolPay Number", "School Pay Code", "Payment Code", "PRN"])).trim();
        const bank = String(valueFor(row, ["Bank", "Bank Name"])).trim();
        const accountText = String(valueFor(row, ["Bank Account", "Receiving Bank Account", "Account"])).trim();
        const reference = String(valueFor(row, ["Bank Slip / Transaction Reference", "Bank Slip", "Transaction Reference", "Reference"])).trim();
        const rawFeeType = String(valueFor(row, ["Fee Type", "Payment Type"])).trim();
        const feeType = normalizeIncomeType(rawFeeType);
        const amount = Number(String(valueFor(row, ["Amount (UGX)", "Amount", "Payment Amount"])).replace(/[^0-9.-]/g, ""));
        const dateValue = valueFor(row, ["Payment Date", "Paid At", "Transaction Date", "Date"]);
        const date = dateValue instanceof Date ? dateValue : new Date(String(dateValue));
        const matchEvidence = [statementDescription, studentName, schoolPayCode, reference].filter(Boolean).join(" · ");
        const admissionMatch = admissionNumber ? studentByAdmission.get(normalized(admissionNumber)) : undefined;
        const statementMatch = !admissionMatch && matchEvidence ? matchStudentStatement(matchEvidence, students, studentAliases) : undefined;
        const student = admissionMatch || (["schoolpay_code", "schoolpay_and_name"].includes(statementMatch?.basis || "") ? statementMatch?.student as StudentOpt : undefined);
        const bankAccount = accountByName.get(normalized(accountText));
        const notes = String(valueFor(row, ["Notes", "Note", "Description"])).trim();
        let error = "";
        if (admissionNumber && !admissionMatch) error = "Student admission number was not found in BOAT";
        else if (!admissionNumber && !matchEvidence) error = "Provide a student admission number, SchoolPay code, name, or statement description";
        else if (statementMatch?.basis === "exact_name") error = "Exact name match found; review and confirm the student before posting";
        else if (statementMatch?.basis === "conflict") error = "SchoolPay code conflicts with the name; review before posting";
        else if (statementMatch?.basis === "ambiguous") error = "More than one student may match this statement description; review before posting";
        else if (!student) error = "No student match found in BOAT";
        else if (!bank) error = "Bank is missing";
        else if (!accountText) error = "Bank account is missing";
        else if (!bankAccount) error = "Bank account does not match a BOAT bank account";
        else if (!(amount > 0)) error = "Amount must be greater than zero";
        else if (!reference) error = "Bank slip or transaction reference is missing";
        else if (!rawFeeType) error = "Fee type is missing";
        else if (Number.isNaN(date.getTime())) error = "Payment date is invalid";
        const matchBasis = admissionMatch
          ? `Admission number: ${admissionNumber}`
          : statementMatch?.basis === "schoolpay_and_name"
            ? `SchoolPay and student name agree: ${matchEvidence}`
            : statementMatch?.basis === "schoolpay_code"
              ? `Exact SchoolPay code: ${matchEvidence}`
            : statementMatch?.basis === "exact_name"
              ? `Exact name - review: ${matchEvidence}`
              : statementMatch?.basis
                ? `${statementMatch.basis}: ${matchEvidence}`
                : matchEvidence
                  ? `No student match in: ${matchEvidence}`
                  : "No matching details supplied";
        return { row: index + 2, sourceFileName: file.name, bank, bankAccount: bankAccount as BankAccount, admissionNumber, statementDescription, matchEvidence, matchBasis, feeType, amount, reference, paidAt: Number.isNaN(date.getTime()) ? "" : date.toISOString(), notes, student, error: error || undefined };
      });
      setDirectBankImportRows(parsed);
      setDirectBankImportMessage(parsed.length ? `Checked ${parsed.length} direct-bank row${parsed.length === 1 ? "" : "s"}. Review the results before importing.` : "No payment rows were found.");
    } catch (error) {
      setDirectBankImportRows([]);
      setDirectBankImportMessage(error instanceof Error ? error.message : "The direct-bank file could not be read.");
    }
  };

  const importDirectBankRows = async () => {
    const orgId = user?.organization_id;
    const validRows = directBankImportRows.filter((row) => !row.error && row.student);
    if (!orgId || !validRows.length || directBankImporting) return;
    if (canUseSchoolApi()) { setDirectBankImportMessage("Bulk direct-bank upload requires the database-backed school connection."); return; }
    setDirectBankImporting(true);
    setDirectBankImportProgress({ completed: 0, total: validRows.length });
    let imported = 0;
    let skipped = 0;
    const importedReferences = new Set<string>();
    const batchLabel = `Direct bank ${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const existingResult = await supabase.from("school_payments").select("reference").eq("organization_id", orgId).in("reference", validRows.map((row) => row.reference));
    if (existingResult.error) { setDirectBankImporting(false); setDirectBankImportMessage(existingResult.error.message); return; }
    const existingReferences = new Set(((existingResult.data as Array<{ reference: string | null }> | null) || []).map((payment) => payment.reference).filter((reference): reference is string => !!reference));
    let completed = 0;
    const processRow = async (row: DirectBankImportRow) => {
      if (existingReferences.has(row.reference)) {
        skipped += 1;
        setDirectBankImportRows((current) => current.map((item) => item.row === row.row ? { ...item, error: "Duplicate reference — not imported" } : item));
        return;
      }
      existingReferences.add(row.reference);
      const invoiceResult = await supabase.from("student_invoices").select("id,total_due,amount_paid").eq("organization_id", orgId).eq("student_id", row.student!.id).neq("status", "cancelled").order("created_at", { ascending: true });
      if (invoiceResult.error) { setDirectBankImportRows((current) => current.map((item) => item.row === row.row ? { ...item, error: invoiceResult.error.message } : item)); return; }
      let remaining = row.amount;
      const allocations: PaymentSlice[] = [];
      const invoiceUpdates: Array<{ id: string; total: number; paid: number }> = [];
      for (const invoice of invoiceResult.data || []) {
        if (remaining <= 0) break;
        const outstanding = Math.max(0, Number(invoice.total_due) - Number(invoice.amount_paid));
        const applied = round2(Math.min(remaining, outstanding));
        if (applied > 0) {
          allocations.push({ invoice_id: invoice.id, amount: applied, category_code: "DIRECT_BANK", category_label: row.feeType, priority: 999 });
          invoiceUpdates.push({ id: invoice.id, total: Number(invoice.total_due), paid: round2(Number(invoice.amount_paid) + applied) });
          remaining = round2(remaining - applied);
        }
      }
      if (!allocations.length) { setDirectBankImportRows((current) => current.map((item) => item.row === row.row ? { ...item, error: "No open invoice found" } : item)); return; }
      if (remaining > 0) allocations[allocations.length - 1].amount = round2(allocations[allocations.length - 1].amount + remaining);
      const notes = [`Bulk imported direct bank slip`, `Batch: ${batchLabel}`, `Upload file: ${row.sourceFileName}`, `Bank: ${row.bank}`, `Fee type: ${row.feeType}`, row.notes].filter(Boolean).join(" · ");
      const paymentNotes = [notes, row.matchBasis ? `Student match: ${row.matchBasis}` : ""].filter(Boolean).join(" · ");
      const paymentResult = await supabase.from("school_payments").insert({ student_id: row.student!.id, amount: row.amount, method: "bank", bank_gl_account_id: row.bankAccount.id, bank_payment_source: "bank_slip", reference: row.reference, paid_at: row.paidAt, recorded_by: user?.id ?? null, invoice_allocations: allocations, notes: paymentNotes }).select("id").single();
      if (paymentResult.error) { setDirectBankImportRows((current) => current.map((item) => item.row === row.row ? { ...item, error: paymentResult.error.message } : item)); return; }
      const updateResults = await Promise.all(invoiceUpdates.map((invoice) => supabase.from("student_invoices").update({ amount_paid: invoice.paid, status: invoice.paid >= invoice.total ? "paid" : "partial" }).eq("id", invoice.id)));
      const updateError = updateResults.find((result) => result.error)?.error;
      if (updateError) { setDirectBankImportRows((current) => current.map((item) => item.row === row.row ? { ...item, error: updateError.message } : item)); return; }
      await Promise.all([
        postSchoolFeePaymentAccounting({ organizationId: orgId, staffUserId: user?.id ?? null, paymentId: paymentResult.data.id, amount: row.amount, method: "bank", paidAt: row.paidAt, studentId: row.student!.id, bankGlAccountId: row.bankAccount.id }),
        supabase.from("school_receipts").insert({ school_payment_id: paymentResult.data.id, receipt_number: `BK-${row.reference}`, delivery_channels: ["bank"] }),
      ]);
      imported += 1;
      importedReferences.add(row.reference);
    };
    const queues = [...validRows.reduce((groups, row) => {
      const key = row.student!.id;
      groups.set(key, [...(groups.get(key) || []), row]);
      return groups;
    }, new Map<string, DirectBankImportRow[]>()).values()];
    const workers = Array.from({ length: Math.min(4, queues.length) }, async () => {
      while (queues.length) {
        const queue = queues.shift();
        if (!queue) return;
        for (const row of queue) {
          try { await processRow(row); }
          catch (error) { setDirectBankImportRows((current) => current.map((item) => item.row === row.row ? { ...item, error: error instanceof Error ? error.message : "Import failed" } : item)); }
          finally { completed += 1; setDirectBankImportProgress({ completed, total: validRows.length }); }
        }
      }
    });
    await Promise.all(workers);
    sessionStorage.removeItem(`boat.school.available-funds.${orgId}`);
    setDirectBankImporting(false);
    setDirectBankImportProgress({ completed: validRows.length, total: validRows.length });
    setDirectBankImportRows((current) => current.filter((row) => !importedReferences.has(row.reference)));
    setDirectBankImportMessage(`Imported ${imported} direct-bank payment${imported === 1 ? "" : "s"}${skipped ? `; ${skipped} duplicate reference${skipped === 1 ? " was" : "s were"} not imported` : ""}. Any remaining rows below need attention and were not imported.`);
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
    const selectedMonth = monthBounds(paymentFilters.month);
    const fromDate = paymentFilters.from || selectedMonth?.from;
    const toExclusive = paymentFilters.to
      ? new Date(new Date(paymentFilters.to + "T00:00:00").getTime() + 86_400_000).toISOString().slice(0, 10)
      : selectedMonth?.toExclusive;
    const [pRes, studentResult] = await Promise.all([
      fetchAllPages<PayRow>((from, to) => {
        let paymentsQuery = supabase.from("school_payments").select("*").eq("organization_id", orgId).order("paid_at", { ascending: false }).range(from, to);
        if (paymentFilters.studentId) paymentsQuery = paymentsQuery.eq("student_id", paymentFilters.studentId);
        if (fromDate) paymentsQuery = paymentsQuery.gte("paid_at", fromDate);
        if (toExclusive) paymentsQuery = paymentsQuery.lt("paid_at", toExclusive);
        return paymentsQuery;
      }).then((data) => ({ data, error: null })).catch((error: unknown) => ({ data: null, error })),
      fetchAllPages<StudentOpt>((from, to) => supabase
        .from("students")
        .select("id,first_name,other_names,last_name,admission_number,class_name,school_pay_number")
        .eq("organization_id", orgId)
        .order("last_name")
        .range(from, to))
        .then((data) => ({ data, error: null }))
        .catch((error: unknown) => ({ data: null, error })),
    ]);
    setErr(pRes.error?.message || (studentResult.error instanceof Error ? studentResult.error.message : studentResult.error ? String(studentResult.error) : null));
    setRows((pRes.data as PayRow[]) || []);
    setStudents(studentResult.data || []);
    setLoading(false);
  }, [user?.organization_id, paymentFilters.studentId, paymentFilters.from, paymentFilters.to, paymentFilters.month]);

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
    const orgId = user?.organization_id;
    if (!orgId || canUseSchoolApi()) {
      setBudgetIncomeTypes([]);
      return;
    }
    void supabase
      .from("budget_lines")
      .select("line_label,budgets!inner(organization_id)")
      .eq("budget_type", "income")
      .eq("budgets.organization_id", orgId)
      .then(({ data, error }) => {
        if (error) return;
        setBudgetIncomeTypes(((data as BudgetIncomeLine[] | null) || [])
          .map((line) => line.line_label?.trim())
          .filter((label): label is string => Boolean(label)));
      });
  }, [user?.organization_id]);

  useEffect(() => {
    const orgId = user?.organization_id;
    if (!orgId || canUseSchoolApi()) { setStudentAliases([]); return; }
    void supabase.from("school_student_name_aliases").select("student_id,alias").eq("organization_id", orgId)
      .then(({ data, error }) => { if (!error) setStudentAliases((data as Array<{ student_id: string; alias: string }> | null) || []); });
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
        .select("id,invoice_number,total_due,amount_paid,fee_structure_id,academic_year,term_name,created_at")
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
              category_label: normalizeIncomeType(line.label),
              priority: line.priority,
            });
            allocLeft = round2(allocLeft - share);
          }
          if (allocLeft <= 0) break;
        }
      }

      if (allocLeft > 0) {
        allocations.push({ invoice_id: inv.id, amount: allocLeft, category_code: "GENERAL", category_label: "School Fees", priority: 999 });
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
    setRows((current) => [{ ...(pay as PayRow), receipt_number: receiptNo }, ...current].slice(0, 1000));
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

  const downloadDirectBankTemplate = () => {
    const sheet = XLSX.utils.json_to_sheet([{
      "Payment Date": new Date().toISOString().slice(0, 10), Bank: "Bank name", "Bank Account": "Account code or account name", "Bank Slip / Transaction Reference": "SLIP-123456", "Student Admission Number": "Optional when a SchoolPay code is in the statement description", "Statement Description": "SchoolPay 00123456 Jane Mary Doe", "Amount (UGX)": 150000, "Fee Type": "School fees", "Academic Year": new Date().getFullYear(), Term: "Term 1", Notes: "",
    }]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Direct bank payments");
    XLSX.writeFile(book, "boat-direct-bank-fee-payments-template.xlsx");
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
    const paymentIds = [...selectedPaymentIds];
    setBulkUpdating(true);
    setBulkUpdateProgress({ completed: 0, total: paymentIds.length });
    setBulkMessage(null);
    setErr(null);
    const patch = { method: bulkMethod, bank_gl_account_id: needsBankAccount ? bulkBankAccountId : null, bank_payment_source: needsBankAccount ? bulkBankPaymentSource : null };
    let updated = 0;
    const failures: string[] = [];
    const updateOne = async (id: string) => {
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
      } finally {
        setBulkUpdateProgress((progress) => ({ ...progress, completed: progress.completed + 1 }));
      }
    };
    // A small concurrency limit substantially reduces waiting time without overwhelming the API or database.
    const concurrentUpdates = 6;
    for (let offset = 0; offset < paymentIds.length; offset += concurrentUpdates) {
      await Promise.all(paymentIds.slice(offset, offset + concurrentUpdates).map(updateOne));
    }
    setSelectedPaymentIds([]);
    setBulkUpdating(false);
    setBulkMessage(`Updated ${updated} payment${updated === 1 ? "" : "s"}${failures.length ? `; ${failures.length} failed.` : "."}`);
    if (failures.length) setErr(failures[0]);
  };

  const applyBulkIncomeTypeEdit = async () => {
    const orgId = user?.organization_id;
    const incomeType = bulkIncomeType.trim();
    if (!orgId || selectedPaymentIds.length === 0 || bulkUpdating) return;
    if (!incomeType) {
      setErr("Select an income type.");
      return;
    }
    if (!window.confirm(`Change the income type for ${selectedPaymentIds.length} selected payment${selectedPaymentIds.length === 1 ? "" : "s"} to ${incomeType}?`)) return;
    const selected = rows.filter((row) => selectedPaymentIds.includes(row.id));
    setBulkUpdating(true);
    setBulkUpdateProgress({ completed: 0, total: selected.length });
    setBulkMessage(null);
    setErr(null);
    let updated = 0;
    const failures: string[] = [];
    for (const payment of selected) {
      try {
        const existingAllocations = payment.invoice_allocations || [];
        if (!existingAllocations.length) throw new Error(`Payment ${payment.reference || payment.id} has no invoice allocation to classify.`);
        const invoice_allocations: PaymentSlice[] = existingAllocations.map((allocation) => ({ ...allocation, category_label: normalizeIncomeType(incomeType) }));
        let saved: PayRow;
        if (canUseSchoolApi()) {
          saved = await updateSchoolRow<PayRow>("payments", orgId, payment.id, { invoice_allocations });
        } else {
          const result = await supabase.from("school_payments").update({ invoice_allocations }).eq("organization_id", orgId).eq("id", payment.id).select("*").single();
          if (result.error) throw result.error;
          saved = result.data as PayRow;
        }
        setRows((current) => current.map((row) => row.id === payment.id ? { ...row, ...saved } : row));
        updated += 1;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : `Payment ${payment.id} could not be updated.`);
      } finally {
        setBulkUpdateProgress((progress) => ({ ...progress, completed: progress.completed + 1 }));
      }
    }
    setSelectedPaymentIds([]);
    setBulkUpdating(false);
    setBulkMessage(`Updated the income type on ${updated} payment${updated === 1 ? "" : "s"}${failures.length ? `; ${failures.length} failed.` : "."}`);
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

  const beginPaymentEdit = (payment: PayRow) => {
    setEditingPayment(payment);
    setEditPaidDate(paymentLocalDay(payment.paid_at));
  };

  const savePaymentDate = async () => {
    const orgId = user?.organization_id;
    if (!editingPayment || !orgId || !editPaidDate || savingPaymentEdit) return;
    setSavingPaymentEdit(true);
    setErr(null);
    try {
      const prior = new Date(editingPayment.paid_at);
      const replacement = new Date(editPaidDate + "T12:00:00");
      if (Number.isNaN(replacement.getTime())) throw new Error("Enter a valid payment date.");
      replacement.setHours(Number.isNaN(prior.getTime()) ? 12 : prior.getHours(), Number.isNaN(prior.getTime()) ? 0 : prior.getMinutes(), 0, 0);
      const patch = { paid_at: replacement.toISOString() };
      let saved: PayRow;
      if (canUseSchoolApi()) saved = await updateSchoolRow<PayRow>("payments", orgId, editingPayment.id, patch);
      else {
        const result = await supabase.from("school_payments").update(patch).eq("organization_id", orgId).eq("id", editingPayment.id).select("*").single();
        if (result.error) throw result.error;
        saved = result.data as PayRow;
        const accounting = await postSchoolFeePaymentAccounting({ organizationId: orgId, staffUserId: user?.id ?? null, paymentId: saved.id, amount: Number(saved.amount), method: saved.method, paidAt: saved.paid_at, studentId: saved.student_id, bankGlAccountId: saved.bank_gl_account_id });
        if (accounting.journalMessage) throw new Error(accounting.journalMessage);
      }
      setRows((current) => current.map((payment) => payment.id === saved.id ? { ...payment, ...saved } : payment));
      setEditingPayment(null);
      setBulkMessage("Payment date updated.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "The payment date could not be updated.");
    } finally { setSavingPaymentEdit(false); }
  };

  const visiblePayments = useMemo(() => rows.filter((payment) => {
    const day = paymentLocalDay(payment.paid_at);
    const incomeTypes = (payment.invoice_allocations || []).map((allocation) => normalizeIncomeType(allocation.category_label).toLowerCase());
    return (!paymentFilters.studentId || payment.student_id === paymentFilters.studentId)
      && (!paymentFilters.className || students.find((student) => student.id === payment.student_id)?.class_name === paymentFilters.className)
      && (!paymentFilters.method || payment.method === paymentFilters.method)
      && (!paymentFilters.bankAccountId || payment.bank_gl_account_id === paymentFilters.bankAccountId)
      && (!paymentFilters.incomeType || incomeTypes.includes(paymentFilters.incomeType.toLowerCase()))
      && (!paymentFilters.month || day.slice(0, 7) === paymentFilters.month)
      && (!paymentFilters.from || day >= paymentFilters.from)
      && (!paymentFilters.to || day <= paymentFilters.to);
  }), [rows, students, paymentFilters]);
  const sortedPayments = useMemo(() => [...visiblePayments].sort((left, right) => {
    const studentName = (payment: PayRow) => { const student = students.find((item) => item.id === payment.student_id); return student ? student.first_name + " " + student.last_name : ""; };
    const value = (payment: PayRow): string | number => {
      switch (paymentSort.key) {
        case "paid_at": return paymentLocalDay(payment.paid_at);
        case "schoolpay": return students.find((item) => item.id === payment.student_id)?.school_pay_number || "";
        case "student": return studentName(payment);
        case "class": return students.find((item) => item.id === payment.student_id)?.class_name || "";
        case "income": return paymentIncomeTypeLabel(payment);
        case "amount": return Number(payment.amount || 0);
        case "method": return payment.method || "";
        case "bank": return payment.bank_gl_account_id ? bankAccounts.find((account) => account.id === payment.bank_gl_account_id)?.account_name || "" : "";
        case "upload": return uploadFileFromNotes(payment.notes) || "";
        case "reference": return payment.reference || "";
      }
    };
    const a = value(left); const b = value(right);
    const comparison = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    return paymentSort.direction === "asc" ? comparison : -comparison;
  }), [visiblePayments, students, bankAccounts, paymentSort]);
  const togglePaymentSort = (key: PaymentSortKey) => setPaymentSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "paid_at" ? "desc" : "asc" });
  const sortHeader = (label: string, key: PaymentSortKey, align: "left" | "right" = "left") => <th className={"p-3 text-" + align + " font-semibold text-slate-700"}><button type="button" onClick={() => togglePaymentSort(key)} className={"inline-flex items-center gap-1 hover:text-indigo-700 " + (align === "right" ? "justify-end" : "")} aria-label={"Sort by " + label}>{label}{paymentSort.key === key ? paymentSort.direction === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" /> : <ArrowDownUp className="h-3.5 w-3.5 text-slate-400" />}</button></th>;
  const openBatchPayments = useMemo(() => openBatchKey ? rows.filter((payment) => paymentBatchKey(payment) === openBatchKey) : [], [rows, openBatchKey]);
  const incomeTypes = useMemo(() => {
    const types = [
      ...DEFAULT_INCOME_TYPES,
      ...budgetIncomeTypes,
      ...rows.flatMap((payment) => (payment.invoice_allocations || []).map((allocation) => normalizeIncomeType(allocation.category_label))),
    ];
    return [...new Map(types.map((type) => {
      const normalized = normalizeIncomeType(type);
      return [normalized.toLocaleLowerCase(), normalized];
    })).values()]
      .sort((a, b) => a.localeCompare(b));
  }, [budgetIncomeTypes, rows]);
  const paymentIncomeTypeLabel = (payment: PayRow) => [...new Set((payment.invoice_allocations || []).map((allocation) => normalizeIncomeType(allocation.category_label)))].join(", ") || "—";

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
        <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-semibold text-slate-900">Bulk upload direct bank payments</h2><p className="mt-1 text-sm text-slate-600">Upload bank-slip deposits for school fees, examination fees, uniform, and other fee types. BOAT matches students by admission number or a unique SchoolPay code in the statement description, checks duplicate references, and allocates only confirmed matches to the oldest open invoices.</p></div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={downloadDirectBankTemplate} className="inline-flex items-center gap-2 rounded-lg border border-sky-300 bg-white px-3 py-2 text-sm font-medium text-sky-800"><Download className="h-4 w-4"/> Template</button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-800"><Upload className="h-4 w-4"/> Choose direct-bank file<input type="file" accept=".xlsx,.xls,.csv,text/csv" className="hidden" onChange={(event) => { void parseDirectBankFile(event.target.files?.[0]); event.currentTarget.value = ""; }}/></label>
            </div>
          </div>
          <p className="text-xs text-slate-600">The <strong>Bank Account</strong> column must exactly match a BOAT bank account code or account name. A name-only, conflicting, or ambiguous match is held for review and cannot be posted automatically. Every imported payment is saved as <strong>Bank · Direct bank slip</strong>.</p>
          {directBankImportMessage && <p className="text-sm text-slate-700" role="status">{directBankImportMessage}</p>}
          {directBankImporting && directBankImportProgress.total > 0 && <div className="space-y-1" role="status" aria-live="polite"><div className="flex justify-between text-xs font-medium text-slate-700"><span>Importing direct-bank payments…</span><span>{directBankImportProgress.completed} of {directBankImportProgress.total}</span></div><div className="h-2 overflow-hidden rounded-full bg-sky-100"><div className="h-full bg-sky-600 transition-all" style={{ width: `${Math.round(directBankImportProgress.completed / directBankImportProgress.total * 100)}%` }} /></div></div>}
          {directBankImportRows.length > 0 && <div className="space-y-3"><div className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white"><table className="w-full min-w-[860px] text-sm"><thead className="sticky top-0 bg-slate-50"><tr><th className="p-2 text-left">Row</th><th className="p-2 text-left">Student</th><th className="p-2 text-left">Match basis</th><th className="p-2 text-left">Bank account</th><th className="p-2 text-left">Fee type</th><th className="p-2 text-right">Amount</th><th className="p-2 text-left">Reference</th><th className="p-2 text-left">Result</th></tr></thead><tbody>{directBankImportRows.map((row) => <tr key={row.row} className="border-t border-slate-100"><td className="p-2">{row.row}</td><td className="min-w-64 p-2">{row.student ? `${row.student.admission_number} — ${row.student.first_name} ${row.student.other_names ? `${row.student.other_names} ` : ""}${row.student.last_name}` : <SearchableCombobox value="" onChange={(studentId) => { const student = students.find((item) => item.id === studentId); if (student) setDirectBankImportRows((current) => current.map((item) => item.row === row.row ? { ...item, student, matchBasis: "Manually confirmed", error: /match|review|admission number was not found/i.test(item.error || "") ? undefined : item.error } : item)); }} options={students.map((student) => ({ id: student.id, label: `${student.admission_number} — ${student.first_name} ${student.other_names ? `${student.other_names} ` : ""}${student.last_name}${student.school_pay_number ? ` · SchoolPay: ${student.school_pay_number}` : ""}` }))} emptyOption={{ label: "Choose student for review" }} placeholder="Type name, admission, or SchoolPay…" inputAriaLabel={`Search student for import row ${row.row}`} className="min-w-60" />}</td><td className="p-2">{row.matchBasis || "—"}</td><td className="p-2">{row.bankAccount ? `${row.bankAccount.account_code} — ${row.bankAccount.account_name}` : "—"}</td><td className="p-2">{row.feeType || "—"}</td><td className="p-2 text-right">{row.amount > 0 ? row.amount.toLocaleString() : "—"}</td><td className="p-2">{row.reference || "—"}</td><td className={`p-2 ${row.error ? "text-red-600" : "text-emerald-700"}`}>{row.error || "Ready"}</td></tr>)}</tbody></table></div><div className="flex items-center justify-between gap-3"><p className="text-xs text-slate-600">{directBankImportRows.filter((row) => !row.error).length} ready · {directBankImportRows.filter((row) => row.error).length} need attention</p><button type="button" onClick={() => void importDirectBankRows()} disabled={directBankImporting || !directBankImportRows.some((row) => !row.error)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{directBankImporting ? "Importing…" : "Import ready payments"}</button></div></div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <SearchableCombobox
            value={form.student_id}
            onChange={(studentId) => setForm((f) => ({ ...f, student_id: studentId, invoice_id: "" }))}
            options={students.map((student) => ({ id: student.id, label: `${student.admission_number} — ${student.first_name} ${student.last_name}${student.school_pay_number ? ` · SchoolPay: ${student.school_pay_number}` : ""}` }))}
            emptyOption={{ label: "Student" }}
            placeholder="Type a student name or admission number…"
            inputAriaLabel="Search student for fee payment"
            clearable
          />
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={form.invoice_id}
            onChange={(e) => setForm((f) => ({ ...f, invoice_id: e.target.value }))}
          >
            <option value="">Allocate to one invoice (optional)</option>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoice_number} — {i.academic_year || "Year not set"} · {i.term_name || "Term not set"} — due {Number(i.total_due - i.amount_paid).toLocaleString()}
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
      {!readOnly && canEditBatches && <section className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
        <div><h2 className="font-semibold text-slate-900">Bulk edit fee payments</h2><p className="mt-1 text-sm text-slate-600">Administrators can select payments below, including a complete imported batch, then update their bank routing or income type.</p></div>
        <div className="flex gap-2 border-b border-indigo-200"><button type="button" onClick={() => setBulkEditTab("routing")} className={`border-b-2 px-3 py-2 text-sm font-medium ${bulkEditTab === "routing" ? "border-indigo-700 text-indigo-800" : "border-transparent text-slate-600"}`}>Bank routing</button><button type="button" onClick={() => setBulkEditTab("income_type")} className={`border-b-2 px-3 py-2 text-sm font-medium ${bulkEditTab === "income_type" ? "border-indigo-700 text-indigo-800" : "border-transparent text-slate-600"}`}>Income type</button></div>
        {bulkEditTab === "routing" ? <div className="grid gap-3 md:grid-cols-3">
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
        </div> : <div className="grid gap-3 md:grid-cols-3"><select value={bulkIncomeType} onChange={(event) => setBulkIncomeType(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">Select income type</option>{incomeTypes.map((incomeType) => <option key={incomeType} value={incomeType}>{incomeType}</option>)}</select><button type="button" onClick={() => void applyBulkIncomeTypeEdit()} disabled={bulkUpdating || selectedPaymentIds.length === 0 || !bulkIncomeType} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{bulkUpdating ? "Updating…" : `Update selected (${selectedPaymentIds.length})`}</button><p className="self-center text-xs text-slate-600">Updates the selected payments&apos; income classification, such as Examination Fees.</p></div>}
        {bulkEditTab === "routing" && (bulkMethod === "bank" || bulkMethod === "transfer") && bankAccounts.length === 0 && <p className="text-xs text-amber-800">No bank asset accounts were found. Add the bank account in the chart of accounts first.</p>}
        {bulkUpdating && bulkUpdateProgress.total > 0 && <div className="space-y-1" role="status" aria-live="polite"><div className="flex justify-between text-xs font-medium text-slate-700"><span>Updating selected payments…</span><span>{bulkUpdateProgress.completed} of {bulkUpdateProgress.total}</span></div><div className="h-2 overflow-hidden rounded-full bg-indigo-100"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${Math.round(bulkUpdateProgress.completed / bulkUpdateProgress.total * 100)}%` }} /></div></div>}
        {bulkMessage && <p className="text-sm text-slate-700" role="status">{bulkMessage}</p>}
      </section>}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-8">
          <input type="month" aria-label="Payments month" value={paymentFilters.month} onChange={(event) => setPaymentFilters((filters) => ({ ...filters, month: event.target.value, from: "", to: "" }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input type="date" aria-label="Payments from date" value={paymentFilters.from} onChange={(event) => setPaymentFilters((filters) => ({ ...filters, from: event.target.value, month: "" }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input type="date" aria-label="Payments to date" value={paymentFilters.to} onChange={(event) => setPaymentFilters((filters) => ({ ...filters, to: event.target.value, month: "" }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <SearchableCombobox
            value={paymentFilters.studentId}
            onChange={(studentId) => setPaymentFilters((filters) => ({ ...filters, studentId }))}
            options={students.map((student) => ({ id: student.id, label: `${student.admission_number} — ${student.first_name} ${student.last_name}${student.school_pay_number ? ` · SchoolPay: ${student.school_pay_number}` : ""}` }))}
            emptyOption={{ label: "All students" }}
            placeholder="Type a student name or number…"
            inputAriaLabel="Filter payments by student"
            clearable
          />
          <select aria-label="Filter payments by class" value={paymentFilters.className} onChange={(event) => setPaymentFilters((filters) => ({ ...filters, className: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All classes</option>{[...new Set(students.map((student) => student.class_name).filter((className): className is string => Boolean(className)))].sort().map((className) => <option key={className} value={className}>{className}</option>)}</select>
          <select aria-label="Filter payments by method" value={paymentFilters.method} onChange={(event) => setPaymentFilters((filters) => ({ ...filters, method: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All methods</option>{SCHOOL_PAYMENT_METHODS.map((method) => <option key={method.code} value={method.code}>{method.label}</option>)}</select>
          <select aria-label="Filter payments by income type" value={paymentFilters.incomeType} onChange={(event) => setPaymentFilters((filters) => ({ ...filters, incomeType: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All income types</option>{incomeTypes.map((incomeType) => <option key={incomeType} value={incomeType}>{incomeType}</option>)}</select>
          <select aria-label="Filter payments by deposited-to bank" value={paymentFilters.bankAccountId} onChange={(event) => setPaymentFilters((filters) => ({ ...filters, bankAccountId: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All deposited-to banks</option>{bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.account_code} — {account.account_name}</option>)}</select>
        </div>
        <div className="mt-3 flex items-center gap-3">{Object.values(paymentFilters).some(Boolean) && <><span className="text-xs text-slate-600">{visiblePayments.length} payment{visiblePayments.length === 1 ? "" : "s"} shown</span><button type="button" onClick={() => setPaymentFilters({ studentId: "", className: "", method: "", bankAccountId: "", incomeType: "", from: "", to: "", month: "" })} className="text-xs font-semibold text-indigo-700 hover:underline">Clear filters</button></>}<label className="ml-auto text-xs text-slate-700"><input type="checkbox" checked={showBankColumn} onChange={(event) => setShowBankColumn(event.target.checked)} className="mr-1" /> Show deposited-to column</label></div>
      </section>
      <div className="rounded-xl border border-slate-200 overflow-x-auto bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {!readOnly && <th className="w-10 p-3"><input type="checkbox" aria-label="Select all filtered payments" checked={visiblePayments.length > 0 && visiblePayments.every((row) => selectedPaymentIds.includes(row.id))} onChange={(event) => setSelectedPaymentIds(event.target.checked ? [...new Set([...selectedPaymentIds, ...visiblePayments.map((row) => row.id)])] : selectedPaymentIds.filter((id) => !visiblePayments.some((row) => row.id === id)))} /></th>}
              {sortHeader("When", "paid_at")}
              {sortHeader("SchoolPay code", "schoolpay")}
              {sortHeader("Student", "student")}
               {sortHeader("Class", "class")}
               {sortHeader("Income type", "income")}
              {sortHeader("Amount", "amount", "right")}
              {sortHeader("Method", "method")}
              {showBankColumn && sortHeader("Deposited to", "bank")}
              {sortHeader("Upload file", "upload")}
              {sortHeader("Reference", "reference")}
              <th className="text-center p-3 font-semibold text-slate-700 print:hidden">Batch</th>
              <th className="text-right p-3 font-semibold text-slate-700 print:hidden">Actions</th>
              <th className="text-right p-3 font-semibold text-slate-700 whitespace-nowrap print:hidden min-w-[7rem]">
                Receipt
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={(readOnly ? 12 : 13) + (showBankColumn ? 1 : 0)} className="p-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : visiblePayments.length === 0 ? (
              <tr>
                <td colSpan={(readOnly ? 11 : 12) + (showBankColumn ? 1 : 0)} className="p-6 text-slate-500">
                  No payments yet.
                </td>
              </tr>
            ) : (
              sortedPayments.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                   {!readOnly && <td className="p-3"><input type="checkbox" aria-label={`Select payment ${r.reference || r.id}`} checked={selectedPaymentIds.includes(r.id)} onChange={() => togglePaymentSelection(r.id)} /></td>}
                  <td className="p-3 text-slate-700">{new Date(r.paid_at).toLocaleString()}</td>
                    <td className="p-3 font-mono text-slate-700">{students.find((student) => student.id === r.student_id)?.school_pay_number || "—"}</td>
                    <td className="p-3 text-slate-700">{(() => { const student = students.find((item) => item.id === r.student_id); return student ? `${student.first_name} ${student.last_name}` : "—"; })()}</td>
                     <td className="p-3 text-slate-700">{students.find((student) => student.id === r.student_id)?.class_name || "—"}</td>
                     <td className="p-3 text-slate-600">{paymentIncomeTypeLabel(r)}</td>
                  <td className="p-3 text-right font-medium text-slate-900">{Number(r.amount).toLocaleString()}</td>
                   <td className="p-3 capitalize text-slate-600">
                    {r.method === "wallet" ? "Wallet" : r.method.replace("_", " ")}
                   </td>
                   {showBankColumn && <td className="p-3 text-slate-600">{r.bank_gl_account_id ? bankAccounts.find((account) => account.id === r.bank_gl_account_id)?.account_name || "Bank account" : "—"}</td>}
                   <td className="p-3 text-slate-600">{uploadFileFromNotes(r.notes) || "—"}</td>
                   <td className="p-3 text-slate-600">{r.reference ?? "—"}</td>
                    <td className="p-3 text-center whitespace-nowrap print:hidden">{paymentBatchKey(r) ? <button type="button" title={"Open batch: " + paymentBatchLabel(r)} aria-label="Open import batch" onClick={() => setOpenBatchKey(paymentBatchKey(r))} className="rounded p-2 text-indigo-700 hover:bg-indigo-50"><FolderOpen className="h-5 w-5" /></button> : <span className="text-slate-300">—</span>}</td>
                    <td className="p-3 text-right whitespace-nowrap print:hidden">{!readOnly && <button type="button" title="Edit payment date" aria-label="Edit payment date" onClick={() => beginPaymentEdit(r)} className="rounded p-2 text-slate-700 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>}</td>
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

      {openBatchKey && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label="Imported payment batch"><div className="max-h-[85vh] w-full max-w-4xl overflow-auto rounded-xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-bold text-slate-900">Imported payment batch</h2><p className="mt-1 text-sm text-slate-600">{openBatchPayments.length} payment{openBatchPayments.length === 1 ? "" : "s"} · {paymentBatchLabel(openBatchPayments[0]) || "Imported batch"}</p></div><button type="button" onClick={() => setOpenBatchKey(null)} className="rounded p-2 text-slate-500 hover:bg-slate-100" aria-label="Close batch"><X className="h-5 w-5" /></button></div><div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-2 text-left">Date</th><th className="p-2 text-left">Student</th><th className="p-2 text-left">Reference</th><th className="p-2 text-right">Amount</th></tr></thead><tbody>{openBatchPayments.map((payment) => { const student = students.find((item) => item.id === payment.student_id); return <tr key={payment.id} className="border-t"><td className="p-2">{paymentLocalDay(payment.paid_at)}</td><td className="p-2">{student ? student.admission_number + " — " + student.first_name + " " + student.last_name : "—"}</td><td className="p-2">{payment.reference || "—"}</td><td className="p-2 text-right">{Number(payment.amount).toLocaleString()}</td></tr>; })}</tbody></table></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setOpenBatchKey(null)} className="app-btn-secondary">Close</button>{canEditBatches && !readOnly && <button type="button" onClick={() => { setSelectedPaymentIds(openBatchPayments.map((payment) => payment.id)); setOpenBatchKey(null); setBulkMessage(openBatchPayments.length + " batch payment" + (openBatchPayments.length === 1 ? "" : "s") + " selected for editing."); }} className="app-btn-primary">Edit this batch</button>}</div></div></div>}
      {editingPayment && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label="Edit payment date"><div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-bold text-slate-900">Edit payment date</h2><p className="mt-1 text-sm text-slate-600">{editingPayment.reference || "School-fee payment"}</p></div><button type="button" onClick={() => setEditingPayment(null)} className="rounded p-2 text-slate-500 hover:bg-slate-100" aria-label="Close edit"><X className="h-5 w-5" /></button></div><label className="mt-4 block text-sm font-medium text-slate-700">Payment date<input type="date" value={editPaidDate} onChange={(event) => setEditPaidDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" /></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setEditingPayment(null)} className="app-btn-secondary">Cancel</button><button type="button" onClick={() => void savePaymentDate()} disabled={savingPaymentEdit || !editPaidDate} className="app-btn-primary">{savingPaymentEdit ? "Saving…" : "Save date"}</button></div></div></div>}

      {receiptPreview && (
        <SchoolFeeReceiptPreviewModal
          detail={receiptPreview}
          onClose={() => setReceiptPreview(null)}
        />
      )}
    </div>
  );
}
