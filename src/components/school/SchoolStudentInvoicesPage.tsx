import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { syncStudentInvoiceAccounting } from "@/lib/schoolFeeJournal";
import { canUseSchoolApi, createSchoolRow, listSchoolRows, updateSchoolRow } from "@/lib/schoolApiData";

type ClassOpt = { id: string; name: string };
type StudentOpt = {
  id: string;
  first_name: string;
  last_name: string;
  admission_number: string;
  class_id: string | null;
  class_name: string;
  status: string;
};
type FeeOpt = {
  id: string;
  class_id: string | null;
  class_name: string;
  term_name: string;
  academic_year: string;
  line_items: unknown;
};
type SpecialFeeOpt = {
  fee_type: "new_student" | "exam" | "uneb";
  academic_year: string;
  term_name: string;
  amount: number;
  is_active: boolean;
};
type BursaryOpt = {
  student_id: string;
  academic_year: string;
  term_name: string;
  amount: number;
};

const INV_STATUS = ["draft", "sent", "partial", "paid", "cancelled"] as const;

type InvRow = {
  id: string;
  invoice_number: string;
  academic_year: string;
  term_name: string;
  subtotal: number;
  total_due: number;
  amount_paid: number;
  status: string;
  student_id: string;
  discount_amount: number;
  bursary_amount: number;
  scholarship_amount: number;
  notes: string | null;
  issue_date?: string | null;
  due_date?: string | null;
};

type InvEditDraft = {
  discount_amount: string;
  scholarship_amount: string;
  status: string;
  notes: string;
};

type Props = { readOnly?: boolean };

/** Empty input for zero optional money fields; preserves non-zero decimals. */
function moneyDraftFromDb(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return "";
  return String(v);
}

export function SchoolStudentInvoicesPage({ readOnly }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<InvRow[]>([]);
  const [students, setStudents] = useState<StudentOpt[]>([]);
  const [fees, setFees] = useState<FeeOpt[]>([]);
  const [bursaries, setBursaries] = useState<BursaryOpt[]>([]);
  const [specialFees, setSpecialFees] = useState<SpecialFeeOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    student_id: "",
    fee_structure_id: "",
    discount_amount: "",
    scholarship_amount: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<InvEditDraft | null>(null);
  const [classes, setClasses] = useState<ClassOpt[]>([]);
  const [bulk, setBulk] = useState({
    fee_structure_id: "",
    class_id: "",
    match_fee_class: false,
    discount_amount: "",
    scholarship_amount: "",
  });
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);
  const [schoolHeader, setSchoolHeader] = useState({ name: "School", address: "", logoUrl: "" });

  useEffect(() => {
    if (!user?.organization_id) return;
    void supabase.from("organizations").select("name,address,logo_url").eq("id", user.organization_id).maybeSingle().then(({ data }) => {
      const org = data as { name?: string; address?: string | null; logo_url?: string | null } | null;
      setSchoolHeader({ name: org?.name || "School", address: org?.address || "", logoUrl: org?.logo_url || "" });
    });
  }, [user?.organization_id]);

  const printDocument = (title: string, body: string) => {
    const popup = window.open("", "_blank", "width=900,height=700");
    if (!popup) {
      setErr("Pop-ups are blocked. Allow pop-ups to print this document.");
      return;
    }
    const header = `<header class="school"><div>${schoolHeader.logoUrl ? `<img src="${schoolHeader.logoUrl}" alt="School logo">` : ""}</div><div><h2>${schoolHeader.name}</h2>${schoolHeader.address ? `<p>${schoolHeader.address}</p>` : ""}</div></header>`;
    popup.document.write(`<!doctype html><html><head><title>${title}</title><style>
      body{font-family:Arial,sans-serif;color:#172033;padding:36px} h1{font-size:22px;margin:0 0 6px}
      .school{display:flex;align-items:center;gap:16px;border-bottom:2px solid #172033;padding-bottom:14px;margin-bottom:24px}.school img{width:72px;height:72px;object-fit:contain}.school h2{font-size:24px;margin:0}.school p{margin:5px 0 0;white-space:pre-line;color:#64748b}
      .muted{color:#64748b}.meta{margin:22px 0;line-height:1.7}table{width:100%;border-collapse:collapse;margin-top:18px}
      th,td{border:1px solid #cbd5e1;padding:9px;text-align:left}th{background:#f1f5f9}.num{text-align:right}
      .total{font-size:18px;font-weight:700;margin-top:20px;text-align:right}@media print{button{display:none}}
    </style></head><body>${header}${body}<script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
  };

  const printInvoice = (invoice: InvRow, demandNote = false) => {
    const student = students.find((s) => s.id === invoice.student_id);
    const name = student ? `${student.first_name} ${student.last_name}` : studentLabel(invoice.student_id);
    const balance = Math.max(0, Number(invoice.total_due) - Number(invoice.amount_paid));
    printDocument(demandNote ? `Demand note ${invoice.invoice_number}` : `Invoice ${invoice.invoice_number}`, `
      <h1>${demandNote ? "SCHOOL FEES DEMAND NOTE" : "SCHOOL FEES INVOICE"}</h1>
      <div class="muted">${invoice.invoice_number}</div>
      <div class="meta"><strong>Student:</strong> ${name}<br><strong>Admission:</strong> ${student?.admission_number ?? "—"}<br>
      <strong>Term:</strong> ${invoice.academic_year} · ${invoice.term_name}<br><strong>Issue date:</strong> ${invoice.issue_date ?? "—"}<br>
      <strong>Due date:</strong> ${invoice.due_date ?? "—"}</div>
      <table><tr><th>Description</th><th class="num">Amount</th></tr><tr><td>School fees</td><td class="num">${Number(invoice.subtotal).toLocaleString()}</td></tr>
      <tr><td>Discounts, bursary and scholarship</td><td class="num">-${(Number(invoice.discount_amount)+Number(invoice.bursary_amount)+Number(invoice.scholarship_amount)).toLocaleString()}</td></tr>
      <tr><th>Total due</th><th class="num">${Number(invoice.total_due).toLocaleString()}</th></tr><tr><td>Paid</td><td class="num">${Number(invoice.amount_paid).toLocaleString()}</td></tr></table>
      <div class="total">Balance: ${balance.toLocaleString()}</div>${demandNote ? "<p>Please settle the outstanding balance by the due date or contact the school bursar.</p>" : ""}`);
  };

  const printStatement = (studentId: string) => {
    const student = students.find((s) => s.id === studentId);
    const items = rows.filter((r) => r.student_id === studentId && r.status !== "cancelled");
    const totalDue = items.reduce((sum, r) => sum + Number(r.total_due), 0);
    const totalPaid = items.reduce((sum, r) => sum + Number(r.amount_paid), 0);
    printDocument(`Fees statement - ${student?.admission_number ?? "student"}`, `<h1>SCHOOL FEES STATEMENT</h1>
      <div class="meta"><strong>Student:</strong> ${student ? `${student.first_name} ${student.last_name}` : studentId}<br><strong>Admission:</strong> ${student?.admission_number ?? "—"}</div>
      <table><tr><th>Invoice</th><th>Term</th><th class="num">Due</th><th class="num">Paid</th><th class="num">Balance</th></tr>${items.map((r) => `<tr><td>${r.invoice_number}</td><td>${r.academic_year} ${r.term_name}</td><td class="num">${Number(r.total_due).toLocaleString()}</td><td class="num">${Number(r.amount_paid).toLocaleString()}</td><td class="num">${Math.max(0,Number(r.total_due)-Number(r.amount_paid)).toLocaleString()}</td></tr>`).join("")}</table>
      <div class="total">Total balance: ${Math.max(0,totalDue-totalPaid).toLocaleString()}</div>`);
  };

  const studentLabel = useMemo(() => {
    const m = new Map(students.map((s) => [s.id, `${s.admission_number} — ${s.first_name} ${s.last_name}`]));
    return (id: string) => m.get(id) ?? id.slice(0, 8);
  }, [students]);

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = user?.organization_id;
    if (!orgId) {
      setLoading(false);
      return;
    }
    if (canUseSchoolApi()) {
      try {
        const [invoices, studentRows, feeRows, classRows] = await Promise.all([
          listSchoolRows<InvRow>("invoices", orgId),
          listSchoolRows<StudentOpt>("students", orgId),
          listSchoolRows<FeeOpt>("fee-structures", orgId),
          listSchoolRows<ClassOpt>("classes", orgId),
        ]);
        setRows(invoices);
        setStudents(studentRows.filter((s) => s.status !== "left" && s.status !== "graduated"));
        setFees(feeRows.filter((f) => (f as FeeOpt & { is_active?: boolean }).is_active !== false));
        setClasses(classRows);
        setBursaries([]);
        setSpecialFees([]);
        setErr(null);
      } catch (error) {
        setErr(error instanceof Error ? error.message : "Failed to load invoices.");
      } finally {
        setLoading(false);
      }
      return;
    }

    const [iRes, sRes, fRes, cRes, bRes, sfRes] = await Promise.all([
      supabase.from("student_invoices").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }),
      supabase
        .from("students")
        .select("id,first_name,last_name,admission_number,class_id,class_name,status")
        .eq("organization_id", orgId)
        .order("last_name"),
      supabase
        .from("fee_structures")
        .select("id,class_id,class_name,term_name,academic_year,line_items")
        .eq("organization_id", orgId)
        .eq("is_active", true),
      supabase.from("classes").select("id,name").eq("organization_id", orgId).eq("is_active", true).order("sort_order"),
      supabase.from("school_bursaries").select("student_id,academic_year,term_name,amount").eq("organization_id", orgId),
      supabase
        .from("school_special_fee_structures")
        .select("fee_type,academic_year,term_name,amount,is_active")
        .eq("organization_id", orgId)
        .eq("is_active", true),
    ]);
    setErr(
      iRes.error?.message ||
        sRes.error?.message ||
        fRes.error?.message ||
        cRes.error?.message ||
        bRes.error?.message ||
        sfRes.error?.message ||
        null
    );
    setRows((iRes.data as InvRow[]) || []);
    setStudents((sRes.data as StudentOpt[]) || []);
    setFees((fRes.data as FeeOpt[]) || []);
    setClasses((cRes.data as ClassOpt[]) || []);
    setBursaries((bRes.data as BursaryOpt[]) || []);
    setSpecialFees((sfRes.data as SpecialFeeOpt[]) || []);
    setLoading(false);
  }, [user?.organization_id]);

  useEffect(() => {
    load();
  }, [load]);

  const sumLines = (fi: FeeOpt | undefined) => {
    const lines = fi?.line_items as { amount?: number }[] | null;
    if (!Array.isArray(lines)) return 0;
    return lines.reduce((a, x) => a + Number(x.amount ?? 0), 0);
  };

  const bulkFee = useMemo(() => fees.find((f) => f.id === bulk.fee_structure_id), [fees, bulk.fee_structure_id]);
  const selectedFee = useMemo(() => fees.find((f) => f.id === form.fee_structure_id), [fees, form.fee_structure_id]);
  const selectedStudent = useMemo(() => students.find((s) => s.id === form.student_id), [students, form.student_id]);
  const autoBursaryAmount = useMemo(() => {
    if (!form.student_id || !selectedFee) return 0;
    return (
      bursaries.find(
        (b) => b.student_id === form.student_id && b.academic_year === selectedFee.academic_year && b.term_name === selectedFee.term_name
      )?.amount ?? 0
    );
  }, [bursaries, form.student_id, selectedFee]);

  const specialFeeTotalFor = useCallback(
    (studentId: string, academicYear: string, termName: string, isNewStudent: boolean) => {
      const rows = specialFees.filter((sf) => sf.academic_year === academicYear && sf.term_name === termName && sf.is_active);
      let total = 0;
      rows.forEach((sf) => {
        if (sf.fee_type === "new_student") {
          if (isNewStudent) total += Number(sf.amount) || 0;
          return;
        }
        total += Number(sf.amount) || 0;
      });
      return total;
    },
    [specialFees]
  );

  const matchesClassFilter = (s: StudentOpt, classId: string) => {
    if (!classId) return true;
    const c = classes.find((x) => x.id === classId);
    if (s.class_id === classId) return true;
    if (!c) return false;
    const sn = (s.class_name ?? "").trim().toLowerCase();
    const cn = c.name.trim().toLowerCase();
    return sn !== "" && sn === cn;
  };

  const matchesFeeStructureClass = (s: StudentOpt, fee: FeeOpt) => {
    if (!fee.class_id) return true;
    if (s.class_id === fee.class_id) return true;
    const fn = (fee.class_name ?? "").trim().toLowerCase();
    const sn = (s.class_name ?? "").trim().toLowerCase();
    return fn !== "" && sn === fn;
  };

  useEffect(() => {
    if (!form.student_id) return;
    const st = students.find((s) => s.id === form.student_id);
    if (!st) return;
    const matching = fees.find((f) => matchesFeeStructureClass(st, f));
    if (matching && form.fee_structure_id !== matching.id) {
      setForm((prev) => ({ ...prev, fee_structure_id: matching.id }));
    }
  }, [form.student_id, form.fee_structure_id, fees, students]);

  const generateBulkInvoices = async () => {
    if (readOnly) return;
    if (!bulk.fee_structure_id) {
      setErr("Select a fee structure for bulk invoicing.");
      setBulkSummary(null);
      return;
    }
    const fee = fees.find((f) => f.id === bulk.fee_structure_id);
    if (!fee) {
      setErr("Fee structure not found.");
      setBulkSummary(null);
      return;
    }
    const orgId = user?.organization_id;
    if (!orgId) return;

    const subtotalBase = sumLines(fee);
    const disc = Number(bulk.discount_amount) || 0;
    const schol = Number(bulk.scholarship_amount) || 0;

    let list = students.filter((s) => s.status === "active");
    list = list.filter((s) => matchesClassFilter(s, bulk.class_id));
    if (bulk.match_fee_class && fee.class_id) {
      list = list.filter((s) => matchesFeeStructureClass(s, fee));
    }

    setErr(null);
    setBulkSummary(null);
    setBulkRunning(true);

    let existingStudentIds: string[] = [];
    if (canUseSchoolApi()) {
      existingStudentIds = rows
        .filter((r) => r.academic_year === fee.academic_year && r.term_name === fee.term_name)
        .map((r) => r.student_id);
    } else {
      const { data: existing } = await supabase
        .from("student_invoices")
        .select("student_id")
        .eq("organization_id", orgId)
        .eq("academic_year", fee.academic_year)
        .eq("term_name", fee.term_name);
      existingStudentIds = (existing ?? []).map((x) => x.student_id);
    }

    const invoiced = new Set<string>(existingStudentIds);
    const toCreate = list.filter((s) => !invoiced.has(s.id));
    const skippedDup = list.length - toCreate.length;

    if (toCreate.length === 0) {
      setBulkRunning(false);
      if (list.length === 0) {
        setErr("No active students match the selected class and fee-structure filters.");
      } else {
        setBulkSummary(`No new invoices. Skipped ${skippedDup} (already invoiced for this term).`);
      }
      return;
    }

    const t0 = Date.now();
    const invoiceRows = toCreate.map((s, idx) => {
      const isNewStudent = !rows.some((r) => r.student_id === s.id);
      const specialTotal = specialFeeTotalFor(s.id, fee.academic_year, fee.term_name, isNewStudent);
      const subtotal = subtotalBase + specialTotal;
      const burs = Number(
        bursaries.find((b) => b.student_id === s.id && b.academic_year === fee.academic_year && b.term_name === fee.term_name)?.amount ?? 0
      );
      const total = Math.max(0, subtotal - disc - burs - schol);
      return {
      student_id: s.id,
      fee_structure_id: fee.id,
      academic_year: fee.academic_year,
      term_name: fee.term_name,
      invoice_number: `INV-${t0.toString(36).toUpperCase()}-${idx}-${s.id.slice(0, 8)}`,
      subtotal,
      discount_amount: disc,
      bursary_amount: burs,
      scholarship_amount: schol,
      total_due: total,
      amount_paid: 0,
      status: total > 0 ? "sent" : "paid",
      };
    });

    if (canUseSchoolApi()) {
      try {
        const insertedRows: InvRow[] = [];
        for (const invoice of invoiceRows) {
          const row = await createSchoolRow<InvRow>("invoices", orgId, { ...invoice, staff_user_id: user?.id ?? null });
          insertedRows.push(row);
        }
        setBulkRunning(false);
        setBulkSummary(
          `Created ${insertedRows.length} invoice${insertedRows.length === 1 ? "" : "s"}. Skipped ${skippedDup} (already invoiced for this term).`
        );
        await load();
      } catch (error) {
        setBulkRunning(false);
        setErr(error instanceof Error ? error.message : "Failed to create bulk invoices.");
      }
      return;
    }

    const { data: inserted, error } = await supabase
      .from("student_invoices")
      .insert(invoiceRows)
      .select("id,student_id,total_due,status,invoice_number,academic_year,term_name");
    setBulkRunning(false);
    if (error) {
      setErr(error.message);
      return;
    }
    const staffId = user?.id ?? null;
    const insertedRows = (inserted || []) as Array<{
      id: string;
      student_id: string;
      total_due: number;
      status: string;
      invoice_number: string;
      academic_year?: string | null;
      term_name?: string | null;
    }>;
    for (const inv of insertedRows) {
      const { journalMessage } = await syncStudentInvoiceAccounting({
        organizationId: orgId,
        staffUserId: staffId,
        invoice: inv,
      });
      if (journalMessage) console.warn("[school invoice journal]", journalMessage);
    }
    setBulkSummary(
      `Created ${toCreate.length} invoice${toCreate.length === 1 ? "" : "s"}. Skipped ${skippedDup} (already invoiced for this term).`
    );
    load();
  };

  const generateInvoice = async () => {
    if (readOnly) return;
    if (!form.student_id || !form.fee_structure_id) {
      setErr("Choose a student and fee structure.");
      return;
    }
    const fee = fees.find((f) => f.id === form.fee_structure_id);
    if (!fee) {
      setErr("Fee structure not found.");
      return;
    }
    const subtotalBase = sumLines(fee);
    const isNewStudent = !rows.some((r) => r.student_id === form.student_id);
    const specialTotal = specialFeeTotalFor(form.student_id, fee.academic_year, fee.term_name, isNewStudent);
    const subtotal = subtotalBase + specialTotal;
    const disc = Number(form.discount_amount) || 0;
    const burs =
      Number(
        bursaries.find(
          (b) => b.student_id === form.student_id && b.academic_year === fee.academic_year && b.term_name === fee.term_name
        )?.amount ?? 0
      ) || 0;
    const schol = Number(form.scholarship_amount) || 0;
    const total = Math.max(0, subtotal - disc - burs - schol);
    const invNo = `INV-${Date.now().toString(36).toUpperCase()}`;
    setErr(null);
    const orgId = user?.organization_id;
    if (canUseSchoolApi()) {
      if (!orgId) return;
      try {
        await createSchoolRow<InvRow>("invoices", orgId, {
          student_id: form.student_id,
          fee_structure_id: fee.id,
          academic_year: fee.academic_year,
          term_name: fee.term_name,
          invoice_number: invNo,
          subtotal,
          discount_amount: disc,
          bursary_amount: burs,
          scholarship_amount: schol,
          total_due: total,
          amount_paid: 0,
          status: total > 0 ? "sent" : "paid",
          staff_user_id: user?.id ?? null,
        });
        setForm({ student_id: "", fee_structure_id: "", discount_amount: "", scholarship_amount: "" });
        await load();
      } catch (error) {
        setErr(error instanceof Error ? error.message : "Failed to generate invoice.");
      }
      return;
    }
    const { data: ins, error } = await supabase
      .from("student_invoices")
      .insert({
        student_id: form.student_id,
        fee_structure_id: fee.id,
        academic_year: fee.academic_year,
        term_name: fee.term_name,
        invoice_number: invNo,
        subtotal,
        discount_amount: disc,
        bursary_amount: burs,
        scholarship_amount: schol,
        total_due: total,
        amount_paid: 0,
        status: total > 0 ? "sent" : "paid",
      })
      .select("id,student_id,total_due,status,invoice_number,academic_year,term_name")
      .single();
    if (error) setErr(error.message);
    else {
      if (orgId && ins) {
        const { journalMessage } = await syncStudentInvoiceAccounting({
          organizationId: orgId,
          staffUserId: user?.id ?? null,
          invoice: ins as {
            id: string;
            student_id: string;
            total_due: number;
            status: string;
            invoice_number: string;
            academic_year?: string | null;
            term_name?: string | null;
          },
        });
        if (journalMessage) console.warn("[school invoice journal]", journalMessage);
      }
      setForm({
        student_id: "",
        fee_structure_id: "",
        discount_amount: "",
        scholarship_amount: "",
      });
      load();
    }
  };

  const startEdit = (r: InvRow) => {
    setEditingId(r.id);
    setEditDraft({
      discount_amount: moneyDraftFromDb(r.discount_amount),
      scholarship_amount: moneyDraftFromDb(r.scholarship_amount),
      status: INV_STATUS.includes(r.status as (typeof INV_STATUS)[number]) ? r.status : "sent",
      notes: r.notes ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const saveEdit = async () => {
    if (readOnly || !editingId || !editDraft) return;
    const row = rows.find((x) => x.id === editingId);
    if (!row) return;

    const subtotal = Number(row.subtotal) || 0;
    const disc = Number(editDraft.discount_amount) || 0;
    const burs = Number(row.bursary_amount) || 0;
    const schol = Number(editDraft.scholarship_amount) || 0;
    const total_due = Math.max(0, subtotal - disc - burs - schol);
    const paid = Number(row.amount_paid) || 0;

    let status = editDraft.status;
    if (status !== "cancelled") {
      if (paid >= total_due && total_due >= 0) status = "paid";
      else if (paid > 0) status = "partial";
      else if (total_due > 0) status = status === "draft" ? "draft" : "sent";
    }

    setErr(null);
    if (canUseSchoolApi()) {
      const orgId = user?.organization_id;
      if (!orgId) return;
      try {
        await updateSchoolRow<InvRow>("invoices", orgId, editingId, {
          discount_amount: disc,
          scholarship_amount: schol,
          total_due,
          status,
          notes: editDraft.notes.trim() || null,
          staff_user_id: user?.id ?? null,
        });
        cancelEdit();
        await load();
      } catch (error) {
        setErr(error instanceof Error ? error.message : "Failed to update invoice.");
      }
      return;
    }
    const { error } = await supabase
      .from("student_invoices")
      .update({
        discount_amount: disc,
        scholarship_amount: schol,
        total_due,
        status,
        notes: editDraft.notes.trim() || null,
      })
      .eq("id", editingId);
    if (error) setErr(error.message);
    else {
      const orgId = user?.organization_id;
      if (orgId) {
        const { journalMessage } = await syncStudentInvoiceAccounting({
          organizationId: orgId,
          staffUserId: user?.id ?? null,
          invoice: {
            id: editingId,
            student_id: row.student_id,
            invoice_number: row.invoice_number,
            total_due,
            status,
            academic_year: row.academic_year,
            term_name: row.term_name,
          },
        });
        if (journalMessage) console.warn("[school invoice journal]", journalMessage);
      }
      cancelEdit();
      load();
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Student invoices</h1>
        <PageNotes ariaLabel="Invoices">
          <p>Term invoices pick fee structures automatically by student class. Bursary deductions come from the Bursary page, and active special fees (new student, exam, UNEB) are added automatically for the term.</p>
        </PageNotes>
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {!readOnly && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={form.student_id}
            onChange={(e) => setForm((f) => ({ ...f, student_id: e.target.value }))}
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
            value={form.fee_structure_id}
            onChange={(e) => setForm((f) => ({ ...f, fee_structure_id: e.target.value }))}
          >
            <option value="">Fee structure</option>
            {fees.map((f) => (
              <option key={f.id} value={f.id}>
                {f.class_name} · {f.academic_year} {f.term_name}
              </option>
            ))}
          </select>
          <input
            type="number"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Discount amount"
            value={form.discount_amount}
            onChange={(e) => setForm((f) => ({ ...f, discount_amount: e.target.value }))}
          />
          <div className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-700">
            Bursary (auto from bursary page): <span className="font-semibold">{Number(autoBursaryAmount).toLocaleString()}</span>
          </div>
          <input
            type="number"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm md:col-span-2"
            placeholder="Scholarship"
            value={form.scholarship_amount}
            onChange={(e) => setForm((f) => ({ ...f, scholarship_amount: e.target.value }))}
          />
          <button
            type="button"
            onClick={generateInvoice}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 md:col-span-2 w-fit"
          >
            Generate invoice
          </button>
        </div>
      )}
      {!readOnly && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Bulk invoicing</h2>
            <p className="text-xs text-slate-600 mt-1">
              Create the same term invoice for many active students. Choose a fee structure (required), optionally narrow by class, and optionally match the fee
              structure&apos;s catalog class. Students who already have an invoice for the same academic year and term are skipped.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={bulk.fee_structure_id}
              onChange={(e) => setBulk((b) => ({ ...b, fee_structure_id: e.target.value, match_fee_class: false }))}
            >
              <option value="">Fee structure (required)</option>
              {fees.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.class_name} · {f.academic_year} {f.term_name}
                </option>
              ))}
            </select>
            <select
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={bulk.class_id}
              onChange={(e) => setBulk((b) => ({ ...b, class_id: e.target.value }))}
            >
              <option value="">All classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {bulkFee?.class_id ? (
              <label className="md:col-span-2 flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-1 rounded border-slate-300"
                  checked={bulk.match_fee_class}
                  onChange={(e) => setBulk((b) => ({ ...b, match_fee_class: e.target.checked }))}
                />
                <span>
                  Only students in this fee structure&apos;s class (catalog link). Combine with &quot;All classes&quot; or a specific class as needed.
                </span>
              </label>
            ) : null}
            <input
              type="number"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Discount amount (each)"
              value={bulk.discount_amount}
              onChange={(e) => setBulk((b) => ({ ...b, discount_amount: e.target.value }))}
            />
            <input
              type="number"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Scholarship (each)"
              value={bulk.scholarship_amount}
              onChange={(e) => setBulk((b) => ({ ...b, scholarship_amount: e.target.value }))}
            />
            <p className="text-xs text-slate-600 md:col-span-2">Bursary is auto-applied per student from the Bursary page for the selected term.</p>
            <div className="md:col-span-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={bulkRunning}
                onClick={generateBulkInvoices}
                className="px-4 py-2 bg-indigo-700 text-white rounded-lg text-sm hover:bg-indigo-800 disabled:opacity-50"
              >
                {bulkRunning ? "Generating…" : "Generate for matching students"}
              </button>
            </div>
          </div>
          {bulkSummary && <p className="text-sm text-slate-700">{bulkSummary}</p>}
        </div>
      )}
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3 font-semibold text-slate-700">Invoice</th>
              <th className="text-left p-3 font-semibold text-slate-700">Student</th>
              <th className="text-left p-3 font-semibold text-slate-700">Term</th>
              <th className="text-right p-3 font-semibold text-slate-700">Due</th>
              <th className="text-right p-3 font-semibold text-slate-700">Paid</th>
              <th className="text-left p-3 font-semibold text-slate-700">Status</th>
              <th className="text-right p-3 font-semibold text-slate-700 min-w-52">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={readOnly ? 6 : 7} className="p-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={readOnly ? 6 : 7} className="p-6 text-slate-500">
                  No invoices yet.
                </td>
              </tr>
            ) : (
              rows.map((r) =>
                editingId === r.id && editDraft ? (
                  <tr key={r.id} className="border-b border-slate-100 bg-indigo-50/40">
                    <td className="p-2" colSpan={readOnly ? 6 : 7}>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 py-1 text-xs text-slate-600 mb-2">
                        <span className="md:col-span-3 font-mono text-slate-800">{r.invoice_number}</span>
                        <span>
                          Subtotal (fixed): {Number(r.subtotal).toLocaleString()} · Bursary (from page): {Number(r.bursary_amount).toLocaleString()} · Paid: {Number(r.amount_paid).toLocaleString()}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <input
                          type="number"
                          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                          value={editDraft.discount_amount}
                          onChange={(e) => setEditDraft((d) => (d ? { ...d, discount_amount: e.target.value } : d))}
                          placeholder="Discount"
                        />
                        <input
                          type="number"
                          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                          value={editDraft.scholarship_amount}
                          onChange={(e) => setEditDraft((d) => (d ? { ...d, scholarship_amount: e.target.value } : d))}
                          placeholder="Scholarship"
                        />
                        <select
                          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm md:col-span-3"
                          value={editDraft.status}
                          onChange={(e) => setEditDraft((d) => (d ? { ...d, status: e.target.value } : d))}
                        >
                          {INV_STATUS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <textarea
                          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm md:col-span-3 min-h-[48px]"
                          value={editDraft.notes}
                          onChange={(e) => setEditDraft((d) => (d ? { ...d, notes: e.target.value } : d))}
                          placeholder="Notes"
                        />
                        <div className="md:col-span-3 flex justify-end gap-2">
                          <button type="button" onClick={saveEdit} className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-md">
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-md"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                    <td className="p-3 font-mono text-slate-800">{r.invoice_number}</td>
                    <td className="p-3 text-slate-700">{studentLabel(r.student_id)}</td>
                    <td className="p-3 text-slate-700">
                      {r.academic_year} · {r.term_name}
                    </td>
                    <td className="p-3 text-right text-slate-900">{Number(r.total_due).toLocaleString()}</td>
                    <td className="p-3 text-right text-slate-600">{Number(r.amount_paid).toLocaleString()}</td>
                    <td className="p-3 capitalize text-slate-600">{r.status}</td>
                    <td className="p-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" onClick={() => printInvoice(r)} className="text-xs font-medium text-sky-700">Invoice</button>
                        <button type="button" onClick={() => printInvoice(r, true)} className="text-xs font-medium text-amber-700">Demand note</button>
                        <button type="button" onClick={() => printStatement(r.student_id)} className="text-xs font-medium text-emerald-700">Statement</button>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="text-xs font-medium text-indigo-700 hover:text-indigo-900"
                        >
                          Edit
                        </button>
                      )}
                      </div>
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
