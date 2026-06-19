import type { FastifyPluginAsync } from "fastify";

type ResourceConfig = {
  table: string;
  orderBy: string;
  name: string;
  insertable: string[];
  patchable: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RESOURCES: Record<string, ResourceConfig> = {
  classes: {
    table: "classes",
    name: "classes",
    orderBy: "sort_order ASC, name ASC",
    insertable: ["organization_id", "name", "code", "sort_order", "is_active"],
    patchable: ["name", "code", "sort_order", "is_active"],
  },
  streams: {
    table: "streams",
    name: "streams",
    orderBy: "sort_order ASC, name ASC",
    insertable: ["organization_id", "name", "code", "sort_order", "is_active"],
    patchable: ["name", "code", "sort_order", "is_active"],
  },
  subjects: {
    table: "subjects",
    name: "subjects",
    orderBy: "sort_order ASC, name ASC",
    insertable: ["organization_id", "name", "code", "sort_order", "is_active"],
    patchable: ["name", "code", "sort_order", "is_active"],
  },
  teachers: {
    table: "teachers",
    orderBy: "lower(full_name) ASC",
    name: "teachers",
    insertable: [
      "organization_id",
      "full_name",
      "email",
      "phone",
      "employee_number",
      "staff_id",
      "notes",
      "is_active",
      "staff_type",
      "department_id",
      "role_assignment",
      "date_joined",
    ],
    patchable: [
      "full_name",
      "email",
      "phone",
      "employee_number",
      "staff_id",
      "notes",
      "is_active",
      "staff_type",
      "department_id",
      "role_assignment",
      "date_joined",
    ],
  },
  parents: {
    table: "parents",
    orderBy: "lower(full_name) ASC",
    name: "parents",
    insertable: ["organization_id", "full_name", "email", "phone", "phone_alt", "address", "notes"],
    patchable: ["full_name", "email", "phone", "phone_alt", "address", "notes"],
  },
  students: {
    table: "students",
    orderBy: "lower(last_name) ASC, lower(first_name) ASC",
    name: "students",
    insertable: [
      "organization_id",
      "admission_number",
      "first_name",
      "last_name",
      "class_name",
      "stream",
      "class_id",
      "stream_id",
      "status",
      "date_of_birth",
      "notes",
      "is_boarding",
      "has_health_issue",
      "photo_url",
    ],
    patchable: [
      "admission_number",
      "first_name",
      "last_name",
      "class_name",
      "stream",
      "class_id",
      "stream_id",
      "status",
      "date_of_birth",
      "notes",
      "is_boarding",
      "has_health_issue",
      "photo_url",
    ],
  },
  "fee-structures": {
    table: "fee_structures",
    orderBy: "academic_year DESC, term_name ASC, class_name ASC",
    name: "fee-structures",
    insertable: [
      "organization_id",
      "class_name",
      "stream",
      "class_id",
      "stream_id",
      "academic_year",
      "term_name",
      "currency",
      "line_items",
      "is_active",
    ],
    patchable: [
      "class_name",
      "stream",
      "class_id",
      "stream_id",
      "academic_year",
      "term_name",
      "currency",
      "line_items",
      "is_active",
    ],
  },
  invoices: {
    table: "student_invoices",
    orderBy: "issue_date DESC, invoice_number DESC",
    name: "invoices",
    insertable: [
      "organization_id",
      "student_id",
      "fee_structure_id",
      "academic_year",
      "term_name",
      "invoice_number",
      "issue_date",
      "due_date",
      "subtotal",
      "discount_amount",
      "discount_reason",
      "bursary_amount",
      "scholarship_amount",
      "total_due",
      "amount_paid",
      "status",
      "notes",
    ],
    patchable: [
      "student_id",
      "fee_structure_id",
      "academic_year",
      "term_name",
      "invoice_number",
      "issue_date",
      "due_date",
      "subtotal",
      "discount_amount",
      "discount_reason",
      "bursary_amount",
      "scholarship_amount",
      "total_due",
      "amount_paid",
      "status",
      "notes",
    ],
  },
  payments: {
    table: "school_payments",
    orderBy: "paid_at DESC, created_at DESC",
    name: "payments",
    insertable: [],
    patchable: [],
  },
  receipts: {
    table: "school_receipts",
    orderBy: "issued_at DESC, created_at DESC",
    name: "receipts",
    insertable: [],
    patchable: [],
  },
  staff: {
    table: "staff",
    orderBy: "created_at DESC",
    name: "staff",
    insertable: ["id", "organization_id", "full_name", "email", "phone", "role", "is_active", "created_at"],
    patchable: ["full_name", "email", "phone", "role", "is_active"],
  },
  "organization-role-types": {
    table: "organization_role_types",
    orderBy: "sort_order ASC, display_name ASC",
    name: "organization-role-types",
    insertable: [
      "organization_id",
      "role_key",
      "display_name",
      "sort_order",
      "can_edit_pos_orders",
      "can_edit_cash_receipts",
    ],
    patchable: ["display_name", "sort_order", "can_edit_pos_orders", "can_edit_cash_receipts"],
  },
};

function getResource(name: string): ResourceConfig | null {
  return RESOURCES[name] || null;
}

function assertUuid(value: unknown, label: string): string {
  const normalized = String(value || "").trim();
  if (!UUID_RE.test(normalized)) {
    throw new Error(`${label} must be a valid UUID.`);
  }
  return normalized;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function pickColumns(body: Record<string, unknown>, allowed: string[]) {
  return allowed.filter((column) => Object.prototype.hasOwnProperty.call(body, column));
}

function coerceBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeValue(column: string, value: unknown) {
  if (column === "line_items") {
    return JSON.stringify(Array.isArray(value) ? value : value ?? []);
  }
  if (["class_id", "stream_id", "student_id", "fee_structure_id", "staff_id", "department_id"].includes(column)) {
    return value ? String(value) : null;
  }
  return value ?? null;
}

async function linkPrimaryParent(app: Parameters<FastifyPluginAsync>[0], studentId: string, parentId: unknown) {
  if (!parentId) return;
  const normalizedParentId = assertUuid(parentId, "parent_id");
  await app.prisma.$executeRawUnsafe(
    `INSERT INTO public.student_parents (student_id, parent_id, is_primary)
     VALUES ($1::uuid, $2::uuid, true)
     ON CONFLICT (student_id, parent_id) DO UPDATE SET is_primary = true`,
    studentId,
    normalizedParentId
  );
}

type DbClient = {
  $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
};

type SchoolGlSettings = {
  revenue_gl_account_id: string | null;
  cash_gl_account_id: string | null;
  receivable_gl_account_id: string | null;
  pos_bank_gl_account_id: string | null;
  pos_mtn_mobile_money_gl_account_id: string | null;
  pos_airtel_money_gl_account_id: string | null;
  wallet_clearing_gl_account_id: string | null;
  school_accounting_basis: string | null;
};

type GlAccountRow = {
  id: string;
  account_code: string | null;
  account_name: string | null;
  account_type: string | null;
  category: string | null;
  is_active: boolean | null;
};

type ResolvedSchoolGl = {
  basis: "accrual" | "cash";
  revenue: string | null;
  cash: string | null;
  receivable: string | null;
  posBank: string | null;
  posMtnMobileMoney: string | null;
  posAirtelMoney: string | null;
  walletClearing: string | null;
};

type JournalLine = {
  gl_account_id: string;
  debit: number;
  credit: number;
  line_description: string;
  dimensions?: Record<string, unknown>;
};

type InvoiceForPayment = {
  id: string;
  invoice_number: string;
  total_due: unknown;
  amount_paid: unknown;
  fee_structure_id: string | null;
};

type FeeStructureForPayment = {
  id: string;
  line_items: unknown;
};

type PaymentSlice = {
  invoice_id: string;
  amount: number;
  category_code?: string;
  category_label?: string;
  priority?: number;
};

type InvoiceForAccounting = {
  id: string;
  invoice_number: string | null;
  total_due: unknown;
  status: string | null;
  student_id: string | null;
  academic_year?: string | null;
  term_name?: string | null;
};

function asArray<T>(rows: unknown): T[] {
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function normalizeStaffUserId(value: unknown): string | null {
  if (!value) return null;
  return assertUuid(value, "staff_user_id");
}

function businessDate(value: unknown): string {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = raw ? new Date(raw) : new Date();
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

async function resolveSchoolGl(db: DbClient, organizationId: string): Promise<ResolvedSchoolGl> {
  const settingsRows = await db.$queryRawUnsafe(
    `SELECT
       revenue_gl_account_id,
       cash_gl_account_id,
       receivable_gl_account_id,
       pos_bank_gl_account_id,
       pos_mtn_mobile_money_gl_account_id,
       pos_airtel_money_gl_account_id,
       wallet_clearing_gl_account_id,
       school_accounting_basis
     FROM public.journal_gl_settings
     WHERE organization_id = $1::uuid
     LIMIT 1`,
    organizationId
  );
  const settings = asArray<SchoolGlSettings>(settingsRows)[0] ?? null;
  const accountRows = await db.$queryRawUnsafe(
    `SELECT id, account_code, account_name, account_type, category, is_active
     FROM public.gl_accounts
     WHERE (organization_id = $1::uuid OR organization_id IS NULL)
     ORDER BY account_code ASC NULLS LAST, account_name ASC`,
    organizationId
  );
  const list = asArray<GlAccountRow>(accountRows).filter((account) => account.is_active !== false);
  const byType = (type: string) => list.filter((account) => account.account_type === type);
  const first = (rows: GlAccountRow[]) => rows[0]?.id ?? null;
  const byCategory = (category: string) =>
    list.find((account) => String(account.category || "").toLowerCase().includes(category))?.id ?? null;
  const byCode = (code: string) => list.find((account) => account.account_code === code)?.id ?? null;
  const byName = (pattern: RegExp, type?: string) =>
    list.find((account) => (!type || account.account_type === type) && pattern.test(account.account_name || ""))?.id ?? null;

  const revenue = settings?.revenue_gl_account_id ?? byCategory("revenue") ?? first(byType("income"));
  const cash = settings?.cash_gl_account_id ?? byCategory("cash") ?? first(byType("asset"));
  const receivable =
    settings?.receivable_gl_account_id ??
    byCategory("receivable") ??
    byName(/receivable/i) ??
    first(byType("asset")) ??
    cash;
  const mobileFallback = byName(/mobile money|momo|mtn|airtel/i, "asset");
  const posMtnMobileMoney =
    settings?.pos_mtn_mobile_money_gl_account_id ??
    byCode("1130") ??
    byName(/^(?=.*(mtn|mobile money|momo))(?!.*airtel).*$/i, "asset") ??
    mobileFallback;
  const posAirtelMoney = settings?.pos_airtel_money_gl_account_id ?? byName(/airtel/i, "asset") ?? mobileFallback;
  const posBank =
    settings?.pos_bank_gl_account_id ??
    byCode("1120") ??
    list.find(
      (account) =>
        account.account_type === "asset" &&
        /bank/i.test(account.account_name || "") &&
        !/charge/i.test(account.account_name || "")
    )?.id ??
    null;

  return {
    basis: String(settings?.school_accounting_basis || "").toLowerCase() === "cash" ? "cash" : "accrual",
    revenue,
    cash,
    receivable,
    posBank,
    posMtnMobileMoney,
    posAirtelMoney,
    walletClearing: settings?.wallet_clearing_gl_account_id ?? null,
  };
}

function receiptGlForMethod(method: string, gl: ResolvedSchoolGl): string | null {
  const normalized = method.toLowerCase();
  if (normalized === "wallet") return gl.walletClearing ?? gl.cash;
  if (normalized === "mobile_money") return gl.posMtnMobileMoney ?? gl.cash;
  if (normalized === "bank" || normalized === "transfer") return gl.posBank ?? gl.cash;
  return gl.cash;
}

async function retireJournalByReference(
  db: DbClient,
  organizationId: string,
  referenceType: string,
  referenceId: string,
  staffUserId: string | null
) {
  try {
    await db.$executeRawUnsafe(
      `WITH retired AS (
         UPDATE public.journal_entries
         SET is_deleted = true
         WHERE organization_id = $1::uuid
           AND reference_type = $2
           AND reference_id = $3::uuid
           AND COALESCE(is_deleted, false) = false
         RETURNING id, organization_id, is_posted
       )
       INSERT INTO public.journal_entry_audit_log (journal_entry_id, organization_id, user_id, action, old_values, new_values)
       SELECT id, organization_id, $4::uuid, 'bulk_soft_delete',
              jsonb_build_object('is_deleted', false, 'is_posted', COALESCE(is_posted, true)),
              jsonb_build_object('is_deleted', true, 'is_posted', COALESCE(is_posted, true))
       FROM retired`,
      organizationId,
      referenceType,
      referenceId,
      staffUserId
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/is_deleted|journal_entry_audit_log|is_posted|column/i.test(message)) throw error;
    await db.$executeRawUnsafe(
      `DELETE FROM public.journal_entries
       WHERE organization_id = $1::uuid AND reference_type = $2 AND reference_id = $3::uuid`,
      organizationId,
      referenceType,
      referenceId
    );
  }
}

async function createJournalEntryAtomic(
  db: DbClient,
  params: {
    entryDate: string;
    description: string;
    referenceType: string;
    referenceId: string;
    createdBy: string | null;
    organizationId: string;
    lines: JournalLine[];
  }
) {
  const rows = await db.$queryRawUnsafe(
    `SELECT public.create_journal_entry_atomic($1::date, $2::text, $3::text, $4::uuid, $5::uuid, $6::jsonb, $7::uuid) AS id`,
    params.entryDate,
    params.description,
    params.referenceType,
    params.referenceId,
    params.createdBy,
    JSON.stringify(params.lines),
    params.organizationId
  );
  return asArray<{ id: string }>(rows)[0]?.id ?? null;
}

async function postInvoiceAccounting(db: DbClient, organizationId: string, staffUserId: string | null, invoice: InvoiceForAccounting) {
  await retireJournalByReference(db, organizationId, "school_invoice", invoice.id, staffUserId);
  const status = String(invoice.status || "").toLowerCase();
  const amount = round2(Number(invoice.total_due) || 0);
  if (status === "draft" || status === "cancelled" || amount <= 0) return null;
  const gl = await resolveSchoolGl(db, organizationId);
  if (gl.basis !== "accrual") return null;
  if (!gl.receivable || !gl.revenue) {
    throw new Error("Missing receivable or revenue GL for school invoice accrual. Configure Accounting -> Journal account settings.");
  }
  const dims = invoice.student_id ? { student_id: invoice.student_id } : {};
  const description = [invoice.invoice_number || "invoice", invoice.academic_year, invoice.term_name].filter(Boolean).join(" - ");
  return createJournalEntryAtomic(db, {
    entryDate: businessDate(new Date().toISOString()),
    description: `School fees receivable: ${description}`,
    referenceType: "school_invoice",
    referenceId: invoice.id,
    createdBy: staffUserId,
    organizationId,
    lines: [
      { gl_account_id: gl.receivable, debit: amount, credit: 0, line_description: "Student fees receivable", dimensions: dims },
      { gl_account_id: gl.revenue, debit: 0, credit: amount, line_description: "Fee income (accrual)", dimensions: dims },
    ],
  });
}

async function postPaymentAccounting(
  db: DbClient,
  organizationId: string,
  staffUserId: string | null,
  payment: { id: string; amount: unknown; method: string; paid_at: unknown; student_id: string | null }
) {
  await retireJournalByReference(db, organizationId, "school_payment", payment.id, staffUserId);
  const amount = round2(Number(payment.amount) || 0);
  if (amount <= 0) return null;
  const gl = await resolveSchoolGl(db, organizationId);
  const receiptGl = receiptGlForMethod(payment.method, gl);
  if (!receiptGl) {
    throw new Error("Missing cash/bank/mobile money GL for school fee receipt. Configure Accounting -> Journal account settings.");
  }
  const creditGl = gl.basis === "cash" ? gl.revenue : gl.receivable;
  if (!creditGl) {
    throw new Error(
      gl.basis === "cash"
        ? "Missing revenue GL for school cash-basis fee income. Configure Accounting -> Journal account settings."
        : "Missing receivable GL for school fee allocation. Configure Accounting -> Journal account settings."
    );
  }
  const dims = payment.student_id ? { student_id: payment.student_id } : {};
  return createJournalEntryAtomic(db, {
    entryDate: businessDate(payment.paid_at),
    description: gl.basis === "cash" ? "School fee receipt (cash basis)" : "School fee receipt (accrual - settle receivable)",
    referenceType: "school_payment",
    referenceId: payment.id,
    createdBy: staffUserId,
    organizationId,
    lines: [
      { gl_account_id: receiptGl, debit: amount, credit: 0, line_description: "Fee receipt", dimensions: dims },
      {
        gl_account_id: creditGl,
        debit: 0,
        credit: amount,
        line_description: gl.basis === "cash" ? "Fee income (cash)" : "Student fees receivable",
        dimensions: dims,
      },
    ],
  });
}

function normalizeFeeLines(lines: unknown): Array<{ code: string; label: string; amount: number; priority: number }> {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line, index) => {
      const row = line && typeof line === "object" ? (line as Record<string, unknown>) : {};
      const code = String(row.code ?? "").trim() || `LINE_${index + 1}`;
      const label = String(row.label ?? "").trim() || code;
      const amount = Math.max(0, Number(row.amount) || 0);
      const priority = Math.max(1, Number(row.priority) || index + 1);
      return { code, label, amount, priority };
    })
    .filter((line) => line.amount > 0)
    .sort((a, b) => a.priority - b.priority);
}

function allocatePayment(amount: number, invoices: InvoiceForPayment[], feeById: Map<string, FeeStructureForPayment>): PaymentSlice[] {
  const allocations: PaymentSlice[] = [];
  let remaining = amount;
  for (const invoice of invoices) {
    if (remaining <= 0) break;
    const outstanding = round2(Math.max(0, Number(invoice.total_due) - Number(invoice.amount_paid)));
    if (outstanding <= 0) continue;
    const applyOnInvoice = Math.min(remaining, outstanding);
    const fee = invoice.fee_structure_id ? feeById.get(invoice.fee_structure_id) : undefined;
    const lines = normalizeFeeLines(fee?.line_items);
    const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
    let allocLeft = applyOnInvoice;

    if (lines.length > 0 && subtotal > 0) {
      for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        const rawShare = idx === lines.length - 1 ? allocLeft : round2((applyOnInvoice * line.amount) / subtotal);
        const share = Math.min(allocLeft, Math.max(0, rawShare));
        if (share > 0) {
          allocations.push({
            invoice_id: invoice.id,
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
      allocations.push({
        invoice_id: invoice.id,
        amount: allocLeft,
        category_code: "GENERAL",
        category_label: "General",
        priority: 999,
      });
    }
    remaining = round2(remaining - applyOnInvoice);
  }

  if (remaining > 0 && allocations.length > 0) {
    allocations[allocations.length - 1].amount = round2(allocations[allocations.length - 1].amount + remaining);
  }
  return allocations;
}

async function nextSchoolFeeReference(app: Parameters<FastifyPluginAsync>[0], organizationId: string) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const day = `${y}${m}${d}`;
  const from = `${y}-${m}-${d}T00:00:00.000Z`;
  const toDate = new Date(Date.UTC(y, now.getUTCMonth(), now.getUTCDate() + 1));
  const to = toDate.toISOString();
  const rows = await app.prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS count
     FROM public.school_payments
     WHERE organization_id = $1::uuid AND paid_at >= $2::timestamptz AND paid_at < $3::timestamptz`,
    organizationId,
    from,
    to
  );
  const count = Number(Array.isArray(rows) ? rows[0]?.count ?? 0 : 0) + 1;
  return `01-${day}-${String(count).padStart(3, "0")}`;
}

async function recordSchoolPayment(app: Parameters<FastifyPluginAsync>[0], body: Record<string, unknown>) {
  const organizationId = assertUuid(body.organization_id, "organization_id");
  const studentId = assertUuid(body.student_id, "student_id");
  const invoiceId = body.invoice_id ? assertUuid(body.invoice_id, "invoice_id") : null;
  const staffUserId = normalizeStaffUserId(body.staff_user_id);
  const amount = Number(body.amount);
  const method = String(body.method || "cash");
  if (!(amount > 0)) throw new Error("Amount must be positive.");
  if (!["cash", "mobile_money", "bank", "transfer", "other"].includes(method)) {
    throw new Error("This payment method is not enabled for server-owned school payments yet.");
  }

  const invoiceRows = invoiceId
    ? await app.prisma.$queryRawUnsafe(
        `SELECT id, invoice_number, total_due, amount_paid, fee_structure_id
         FROM public.student_invoices
         WHERE organization_id = $1::uuid AND student_id = $2::uuid AND id = $3::uuid AND status <> 'cancelled'
         ORDER BY issue_date ASC, created_at ASC`,
        organizationId,
        studentId,
        invoiceId
      )
    : await app.prisma.$queryRawUnsafe(
        `SELECT id, invoice_number, total_due, amount_paid, fee_structure_id
         FROM public.student_invoices
         WHERE organization_id = $1::uuid AND student_id = $2::uuid AND status <> 'cancelled' AND total_due > amount_paid
         ORDER BY issue_date ASC, created_at ASC`,
        organizationId,
        studentId
      );
  const invoices = (Array.isArray(invoiceRows) ? invoiceRows : []) as InvoiceForPayment[];
  if (invoices.length === 0) throw new Error("No open invoice found for this student.");

  const feeIds = [...new Set(invoices.map((invoice) => invoice.fee_structure_id).filter(Boolean))] as string[];
  const feeRows =
    feeIds.length > 0
      ? ((await app.prisma.$queryRawUnsafe(
          `SELECT id, line_items FROM public.fee_structures WHERE organization_id = $1::uuid AND id = ANY($2::uuid[])`,
          organizationId,
          feeIds
        )) as FeeStructureForPayment[])
      : [];
  const feeById = new Map(feeRows.map((fee) => [fee.id, fee]));
  const allocations = allocatePayment(amount, invoices, feeById);
  if (allocations.length === 0) throw new Error("Could not allocate this payment to any open invoice.");

  const reference = await nextSchoolFeeReference(app, organizationId);
  const receiptNumber = `R-${Date.now().toString(36).toUpperCase()}`;
  const now = new Date().toISOString();

  return app.prisma.$transaction(async (tx) => {
    const paymentRows = await tx.$queryRawUnsafe(
      `INSERT INTO public.school_payments (organization_id, student_id, amount, method, reference, paid_at, invoice_allocations)
       VALUES ($1::uuid, $2::uuid, $3::numeric, $4, $5, $6::timestamptz, $7::jsonb)
       RETURNING *`,
      organizationId,
      studentId,
      amount,
      method,
      reference,
      now,
      JSON.stringify(allocations)
    );
    const payment = Array.isArray(paymentRows) ? paymentRows[0] : null;
    if (!payment?.id) throw new Error("Failed to record payment.");

    const paidByInvoice = new Map<string, number>();
    for (const allocation of allocations) {
      paidByInvoice.set(allocation.invoice_id, round2((paidByInvoice.get(allocation.invoice_id) ?? 0) + Number(allocation.amount)));
    }
    for (const invoice of invoices) {
      const paidDelta = paidByInvoice.get(invoice.id) ?? 0;
      if (paidDelta <= 0) continue;
      const newPaid = round2(Number(invoice.amount_paid) + paidDelta);
      const totalDue = Number(invoice.total_due);
      const status = newPaid >= totalDue ? "paid" : "partial";
      await tx.$executeRawUnsafe(
        `UPDATE public.student_invoices
         SET amount_paid = $1::numeric, status = $2
         WHERE id = $3::uuid AND organization_id = $4::uuid`,
        newPaid,
        status,
        invoice.id,
        organizationId
      );
    }

    const receiptRows = await tx.$queryRawUnsafe(
      `INSERT INTO public.school_receipts (organization_id, school_payment_id, receipt_number, issued_at, delivery_channels)
       VALUES ($1::uuid, $2::uuid, $3, $4::timestamptz, ARRAY['print']::text[])
       RETURNING *`,
      organizationId,
      payment.id,
      receiptNumber,
      now
    );
    const receipt = Array.isArray(receiptRows) ? receiptRows[0] : null;
    const journalId = await postPaymentAccounting(tx as unknown as DbClient, organizationId, staffUserId, payment);
    return { payment, receipt, allocations, journal_id: journalId };
  });
}

async function listRows(app: Parameters<FastifyPluginAsync>[0], resource: ResourceConfig, organizationId: string) {
  return app.prisma.$queryRawUnsafe(
    `SELECT * FROM public.${resource.table} WHERE organization_id = $1::uuid ORDER BY ${resource.orderBy}`,
    organizationId
  );
}

async function insertRow(app: Parameters<FastifyPluginAsync>[0], resource: ResourceConfig, body: Record<string, unknown>) {
  const columns = pickColumns(body, resource.insertable);
  if (!columns.includes("organization_id")) {
    throw new Error("organization_id is required.");
  }
  const placeholders = columns.map((column, index) => {
    const cast = column === "line_items" ? "::jsonb" : "";
    return `$${index + 1}${cast}`;
  });
  const values = columns.map((column) => normalizeValue(column, body[column]));
  const createRecord = async (db: DbClient) => {
    const rows = await db.$queryRawUnsafe(
      `INSERT INTO public.${resource.table} (${columns.join(", ")})
       VALUES (${placeholders.join(", ")})
       RETURNING *`,
      ...values
    );
    return Array.isArray(rows) ? rows[0] : null;
  };

  if (resource.table === "student_invoices") {
    return app.prisma.$transaction(async (tx) => {
      const db = tx as unknown as DbClient;
      const row = await createRecord(db);
      if (row?.id) {
        await postInvoiceAccounting(db, String(row.organization_id), normalizeStaffUserId(body.staff_user_id), row as InvoiceForAccounting);
      }
      return row;
    });
  }
  const row = await createRecord(app.prisma as unknown as DbClient);
  if (resource.table === "students" && row?.id) await linkPrimaryParent(app, String(row.id), body.parent_id);
  return row;
}

async function patchRow(
  app: Parameters<FastifyPluginAsync>[0],
  resource: ResourceConfig,
  id: string,
  organizationId: string,
  body: Record<string, unknown>
) {
  const columns = pickColumns(body, resource.patchable);
  if (columns.length === 0) {
    throw new Error("No writable fields were provided.");
  }
  const assignments = columns.map((column, index) => {
    const cast = column === "line_items" ? "::jsonb" : "";
    return `${column} = $${index + 1}${cast}`;
  });
  const values = columns.map((column) => normalizeValue(column, body[column]));
  values.push(id, organizationId);
  const updateRecord = async (db: DbClient) => {
    const rows = await db.$queryRawUnsafe(
      `UPDATE public.${resource.table}
       SET ${assignments.join(", ")}
       WHERE id = $${columns.length + 1}::uuid AND organization_id = $${columns.length + 2}::uuid
       RETURNING *`,
      ...values
    );
    return Array.isArray(rows) ? rows[0] || null : null;
  };

  if (resource.table === "student_invoices") {
    return app.prisma.$transaction(async (tx) => {
      const db = tx as unknown as DbClient;
      const row = await updateRecord(db);
      if (row?.id) {
        await postInvoiceAccounting(db, organizationId, normalizeStaffUserId(body.staff_user_id), row as InvoiceForAccounting);
      }
      return row;
    });
  }
  return updateRecord(app.prisma as unknown as DbClient);
}

async function deleteRow(
  app: Parameters<FastifyPluginAsync>[0],
  resource: ResourceConfig,
  id: string,
  organizationId: string
) {
  const rows = await app.prisma.$queryRawUnsafe(
    `DELETE FROM public.${resource.table}
     WHERE id = $1::uuid AND organization_id = $2::uuid
     RETURNING *`,
    id,
    organizationId
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

export const schoolRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Params: { resource: string };
    Querystring: { organization_id?: string };
  }>("/school/:resource", async (req, reply) => {
    const resource = getResource(req.params.resource);
    if (!resource) {
      return reply.status(404).send({ error: "unknown_school_resource", message: "Unknown school resource." });
    }
    try {
      const organizationId = assertUuid(req.query.organization_id, "organization_id");
      const data = await listRows(app, resource, organizationId);
      return { data };
    } catch (err) {
      return reply.status(400).send({
        error: "invalid_school_request",
        message: err instanceof Error ? err.message : "Invalid request.",
      });
    }
  });

  app.post<{
    Params: { resource: string };
    Body: Record<string, unknown>;
  }>("/school/:resource", async (req, reply) => {
    const resource = getResource(req.params.resource);
    if (!resource) {
      return reply.status(404).send({ error: "unknown_school_resource", message: "Unknown school resource." });
    }
    try {
      const body = coerceBody(req.body);
      if (body.organization_id) {
        body.organization_id = assertUuid(body.organization_id, "organization_id");
      }
      const data = await insertRow(app, resource, body);
      return reply.status(201).send({ data });
    } catch (err) {
      return reply.status(400).send({
        error: "invalid_school_request",
        message: err instanceof Error ? err.message : "Invalid request.",
      });
    }
  });

  app.post<{
    Body: Record<string, unknown>;
  }>("/school/payments/record", async (req, reply) => {
    try {
      const data = await recordSchoolPayment(app, coerceBody(req.body));
      return reply.status(201).send({ data });
    } catch (err) {
      return reply.status(400).send({
        error: "invalid_school_payment",
        message: err instanceof Error ? err.message : "Invalid payment request.",
      });
    }
  });

  app.patch<{
    Params: { resource: string; id: string };
    Body: Record<string, unknown>;
  }>("/school/:resource/:id", async (req, reply) => {
    const resource = getResource(req.params.resource);
    if (!resource) {
      return reply.status(404).send({ error: "unknown_school_resource", message: "Unknown school resource." });
    }
    try {
      const body = coerceBody(req.body);
      const id = assertUuid(req.params.id, "id");
      const organizationId = assertUuid(body.organization_id, "organization_id");
      const data = await patchRow(app, resource, id, organizationId, body);
      if (!data) return reply.status(404).send({ error: "not_found", message: "Record not found." });
      return { data };
    } catch (err) {
      return reply.status(400).send({
        error: "invalid_school_request",
        message: err instanceof Error ? err.message : "Invalid request.",
      });
    }
  });

  app.delete<{
    Params: { resource: string; id: string };
    Querystring: { organization_id?: string };
  }>("/school/:resource/:id", async (req, reply) => {
    const resource = getResource(req.params.resource);
    if (!resource) {
      return reply.status(404).send({ error: "unknown_school_resource", message: "Unknown school resource." });
    }
    try {
      const id = assertUuid(req.params.id, "id");
      const organizationId = assertUuid(req.query.organization_id, "organization_id");
      const data = await deleteRow(app, resource, id, organizationId);
      if (!data) return reply.status(404).send({ error: "not_found", message: "Record not found." });
      return { data };
    } catch (err) {
      return reply.status(400).send({
        error: "invalid_school_request",
        message: err instanceof Error ? err.message : "Invalid request.",
      });
    }
  });
};
