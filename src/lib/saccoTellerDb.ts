/**
 * Teller data access — sessions, transactions, vault movements, audit.
 * Requires migration `20260426120007_sacco_teller.sql`.
 */
import { createJournalEntry, getDefaultGlAccounts } from "@/lib/journal";
import { fetchJournalGlSettings } from "@/lib/journalAccountSettings";
import { supabase } from "@/lib/supabase";
import { businessTodayISO } from "@/lib/timezone";
import { normalizeGlAccountRows } from "@/lib/glAccountNormalize";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type SaccoTellerSessionRow = {
  id: string;
  organization_id: string;
  staff_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  closing_counted: number | null;
  expected_balance: number | null;
  over_short: number | null;
  status: "open" | "closed";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** Matches DB check constraint on sacco_teller_transactions.txn_type */
export type SaccoTellerTxnType =
  | "cash_deposit"
  | "cash_withdrawal"
  | "cheque_received"
  | "cheque_paid"
  | "cheque_clearing"
  | "adjustment"
  | "till_vault_in"
  | "till_vault_out";

/** Set when posting_purpose is savings; GL links use this + sacco_member_id. */
export type TellerPostingPurpose =
  | "savings"
  | "membership_fee"
  | "subscription"
  | "shares"
  | "loan_repayment"
  | "fee_or_penalty"
  | "other";

export const TELLER_POSTING_PURPOSE_LABELS: Record<TellerPostingPurpose, string> = {
  savings: "Savings (select account)",
  membership_fee: "Membership fee",
  subscription: "Subscription",
  shares: "Shares / equity",
  loan_repayment: "Loan repayment",
  fee_or_penalty: "Fee or penalty",
  other: "Other",
};

export type SaccoTellerTransactionRow = {
  id: string;
  organization_id: string;
  session_id: string | null;
  txn_type: SaccoTellerTxnType | string;
  amount: number;
  sacco_member_id: string | null;
  sacco_member_savings_account_id?: string | null;
  posting_purpose?: TellerPostingPurpose | string | null;
  /** Non-cash GL line for cash deposit/withdrawal journals (paired with till cash). */
  counterparty_gl_account_id?: string | null;
  member_ref: string | null;
  narration: string | null;
  cheque_number: string | null;
  cheque_bank: string | null;
  cheque_value_date: string | null;
  status: string;
  maker_staff_id: string | null;
  checker_staff_id: string | null;
  approved_at: string | null;
  journal_batch_ref: string | null;
  /** Business calendar date (yyyy-mm-dd, Kampala); journal/cashbook entry_date when posting. */
  txn_date?: string | null;
  corrects_txn_id?: string | null;
  reversed_at?: string | null;
  reversed_by_staff_id?: string | null;
  correction_reason?: string | null;
  created_at: string;
  updated_at: string;
};

/** Fields an authorized officer may change. */
export type SaccoTellerTransactionPatch = {
  amount?: number;
  narration?: string | null;
  member_ref?: string | null;
  sacco_member_id?: string | null;
  sacco_member_savings_account_id?: string | null;
  posting_purpose?: TellerPostingPurpose | string | null;
  counterparty_gl_account_id?: string | null;
  /** Allowed only to switch between `cash_deposit` and `cash_withdrawal` on those rows. */
  txn_type?: SaccoTellerTxnType | string;
  /** Business posting date yyyy-mm-dd. */
  txn_date?: string | null;
};

/** Posted teller rows we can safely reverse and re-post (GL + cashbook + savings). */
export function canCorrectPostedTellerTxnType(txnType: string): boolean {
  const t = String(txnType);
  return t === "cash_deposit" || t === "cash_withdrawal" || t === "adjustment";
}

export type SaccoVaultMovementRow = {
  id: string;
  organization_id: string;
  session_id: string | null;
  signed_vault_change: number;
  narration: string | null;
  reference_code: string | null;
  created_by: string | null;
  created_at: string;
};

export type SaccoTellerAuditRow = {
  id: string;
  organization_id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  actor_staff_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

export type TellerMemberPickRow = {
  id: string;
  member_number: string;
  full_name: string;
};

export type TellerSavingsAccountPickRow = {
  id: string;
  account_number: string;
  savings_product_code: string;
  sacco_member_id: string;
  member_number: string;
  full_name: string;
  balance: number;
};

export type TellerGlAccountPickRow = {
  id: string;
  account_code: string;
  account_name: string;
};

export type TellerStaffContext = {
  staffId: string;
  organizationId: string;
  fullName: string | null;
  role: string | null;
};

export type TellerOpenSessionListRow = SaccoTellerSessionRow & {
  staff_full_name: string | null;
};

export type TillPositionRow = TellerOpenSessionListRow & {
  tillEstimated: number;
  sessionReceiptsTotal: number;
  sessionPaymentsTotal: number;
  overInsuredLimit: boolean;
};

export type TellerReportTable = {
  title: string;
  subtitle: string;
  head: string[];
  rows: string[][];
  summaryLines: string[];
};

/** Resolve org + staff from the staff table (must match auth.uid() for RLS). */
export async function resolveTellerStaffContext(authUserId: string): Promise<TellerStaffContext | null> {
  if (!authUserId?.trim()) return null;
  const { data, error } = await sb
    .from("staff")
    .select("id, organization_id, full_name, role")
    .eq("id", authUserId)
    .maybeSingle();
  if (error || !data?.organization_id) return null;
  return {
    staffId: String(data.id),
    organizationId: String(data.organization_id),
    fullName: (data.full_name as string | null) ?? null,
    role: (data.role as string | null) ?? null,
  };
}

/** Active GL accounts for teller counterparty selection (cash deposit / withdrawal). */
export async function fetchTellerGlAccountPickList(
  organizationId: string,
  _isSuperAdmin?: boolean
): Promise<TellerGlAccountPickRow[]> {
  void organizationId;
  // RLS scopes gl_accounts to the staff org; do not .eq(organization_id) — excludes legacy NULL-org rows.
  const { data, error } = await sb
    .from("gl_accounts")
    .select("id, account_code, account_name, is_active")
    .order("account_code");
  if (error) {
    if (isMissingTellerSchemaError(error) || isUnknownColumnError(error)) {
      const retry = await sb.from("gl_accounts").select("id, account_code, account_name").order("account_code");
      if (!retry.error) {
        return normalizeGlAccountRows((retry.data || []) as unknown[]).map((row) => ({
          id: row.id,
          account_code: row.account_code,
          account_name: row.account_name,
        }));
      }
    }
    warnTellerQuery("GL accounts pick list", error);
    return [];
  }
  return normalizeGlAccountRows((data || []) as unknown[])
    .filter((row) => row.is_active)
    .map((row) => ({ id: row.id, account_code: row.account_code, account_name: row.account_name }));
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? "").trim());
}

function isMissingTellerSchemaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; details?: string; status?: number };
  if (e.status === 404 || e.status === 406) return true;
  const c = String(e.code ?? "");
  if (c === "PGRST205" || c === "PGRST204" || c === "42P01") return true;
  const m = `${e.message ?? ""} ${e.details ?? ""}`.toLowerCase();
  if (e.status === 400) {
    if (
      m.includes("relation") ||
      m.includes("does not exist") ||
      m.includes("schema cache") ||
      m.includes("could not find the table") ||
      (m.includes("could not find") && m.includes("column"))
    ) {
      return true;
    }
  }
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("could not find the table") ||
    (m.includes("could not find") && m.includes("column"))
  );
}

/** Base columns without txn_date (pre–txn_date migration). */
const TELLER_TXN_SELECT_LEGACY_BASE =
  "id, organization_id, session_id, txn_type, amount, sacco_member_id, member_ref, narration, cheque_number, cheque_bank, cheque_value_date, status, maker_staff_id, checker_staff_id, approved_at, journal_batch_ref, created_at, updated_at";

const TELLER_TXN_SELECT_BASE =
  "id, organization_id, session_id, txn_type, amount, sacco_member_id, member_ref, narration, cheque_number, cheque_bank, cheque_value_date, status, maker_staff_id, checker_staff_id, approved_at, journal_batch_ref, txn_date, created_at, updated_at";

const TELLER_TXN_SELECT_EXTENDED = `${TELLER_TXN_SELECT_BASE}, posting_purpose, sacco_member_savings_account_id, counterparty_gl_account_id`;

const TELLER_TXN_SELECT_LEGACY_EXTENDED = `${TELLER_TXN_SELECT_LEGACY_BASE}, posting_purpose, sacco_member_savings_account_id, counterparty_gl_account_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TellerTxnQueryBuilder = any;

async function runTellerTxnQuery(
  build: (columns: string) => TellerTxnQueryBuilder
): Promise<{ data: unknown[] | null; error: unknown; count: number | null }> {
  for (const columns of [
    TELLER_TXN_SELECT_EXTENDED,
    TELLER_TXN_SELECT_BASE,
    TELLER_TXN_SELECT_LEGACY_EXTENDED,
    TELLER_TXN_SELECT_LEGACY_BASE,
  ]) {
    const res = await build(columns);
    if (!res.error) {
      return { data: res.data ?? null, error: null, count: res.count ?? null };
    }
    if (!isUnknownColumnError(res.error) && !isMissingTellerSchemaError(res.error)) {
      return { data: null, error: res.error, count: null };
    }
  }
  const last = await build(TELLER_TXN_SELECT_LEGACY_BASE);
  return { data: last.data ?? null, error: last.error, count: last.count ?? null };
}

function warnTellerQuery(label: string, err: unknown): void {
  console.warn(`[SACCO teller] ${label}:`, formatTellerDbError(err));
}

/** PostgREST 400 / missing column — often fixable with a narrower select or migration. */
function isUnknownColumnError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; details?: string; status?: number };
  if (e.code === "PGRST204") return true;
  if (e.status === 400) {
    const m = `${e.message ?? ""} ${e.details ?? ""}`.toLowerCase();
    if (m.includes("column") || m.includes("schema cache")) return true;
  }
  const m = String(e.message ?? "").toLowerCase();
  return m.includes("column") && (m.includes("does not exist") || m.includes("could not find"));
}

export const TELLER_MIGRATION_HINT =
  "Run teller migrations in Supabase SQL Editor: 20260426120007_sacco_teller.sql, then 20260426120008, 20260426120009, 20260426120010, and 20260426120011_journal_gl_teller_counterparty_settings.sql (or supabase db push).";

export function formatTellerLoadError(err: unknown): string {
  return formatTellerDbError(err, "Failed to load teller data");
}

export function formatTellerDbError(err: unknown, fallback = "Teller action failed"): string {
  if (isMissingTellerSchemaError(err)) {
    return `Teller tables are not installed on this database. ${TELLER_MIGRATION_HINT}`;
  }
  if (isUnknownColumnError(err)) {
    return `Database schema is out of date for Teller. ${TELLER_MIGRATION_HINT}`;
  }
  if (err && typeof err === "object") {
    const e = err as { code?: string; message?: string; details?: string };
    const msg = `${e.message ?? ""} ${e.details ?? ""}`.trim();
    const c = String(e.code ?? "");
    if (c === "23503" && /staff_id|staff/i.test(msg)) {
      return "Your sign-in is not linked to a staff record in this organization. Ask an admin to add you under Staff, then sign in again.";
    }
    if (c === "42501" || /row-level security|policy/i.test(msg)) {
      return "Not allowed to open the till for this organization. Confirm your staff account belongs to the same SACCO org.";
    }
    if (c === "23505" || /unique|duplicate/i.test(msg)) {
      if (/sacco_teller_sess_one_open_per_org|one_open_per_org/i.test(msg)) {
        return (
          "This database limits open tills organization-wide (misconfigured index). " +
          "Run migration 20260517130000_sacco_teller_concurrent_sessions.sql in Supabase, then refresh."
        );
      }
      return "A till session is already open for you. Go to the Till tab and use Close till, or choose Resume / close stuck session.";
    }
    if (c === "23503" && /staff_id/i.test(msg)) {
      return "Your login is not linked to a staff record. Ask an administrator to add you under Staff with the same account you use to sign in, then try again.";
    }
    if (msg) return msg;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export type TellerDashboardSnapshot = {
  schemaMissing: boolean;
  openSession: SaccoTellerSessionRow | null;
  /** Till cash estimate from opening float ± posted session transactions. */
  tillEstimated: number | null;
  sessionReceiptsTotal: number;
  sessionPaymentsTotal: number;
  /** Sum of signed_vault_change (baseline 0 until you add opening balance). */
  vaultPosition: number;
  pendingApprovalCount: number;
  /** Oldest first — for checker queue. */
  pendingApprovals: SaccoTellerTransactionRow[];
  recentTransactions: SaccoTellerTransactionRow[];
  recentVaultMoves: SaccoVaultMovementRow[];
  recentAudit: SaccoTellerAuditRow[];
};

/** All open till sessions for this staff member in the org (0, 1, or rarely more if index missing). */
const TELLER_SESSION_SELECT =
  "id, organization_id, staff_id, opened_at, closed_at, opening_float, closing_counted, expected_balance, over_short, status, notes, created_at, updated_at";

export async function fetchOpenTellerSessionsForStaff(
  organizationId: string,
  staffId: string
): Promise<SaccoTellerSessionRow[]> {
  if (!isValidUuid(organizationId) || !isValidUuid(staffId)) return [];
  const { data, error } = await sb
    .from("sacco_teller_sessions")
    .select(TELLER_SESSION_SELECT)
    .eq("organization_id", organizationId)
    .eq("staff_id", staffId)
    .eq("status", "open")
    .order("opened_at", { ascending: false });
  if (error) {
    if (isMissingTellerSchemaError(error)) {
      throwIfTellerDbError(error);
    }
    warnTellerQuery("open sessions", error);
    return [];
  }
  return (data ?? []) as SaccoTellerSessionRow[];
}

/** All open till sessions in the org (supervisors / admin teller oversight). */
export async function fetchOpenTellerSessionsForOrganization(
  organizationId: string
): Promise<TellerOpenSessionListRow[]> {
  if (!isValidUuid(organizationId)) return [];
  const { data, error } = await sb
    .from("sacco_teller_sessions")
    .select(`${TELLER_SESSION_SELECT}, staff:staff_id(full_name)`)
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .order("opened_at", { ascending: true });
  if (error) {
    if (isMissingTellerSchemaError(error)) {
      warnTellerQuery("org open sessions", error);
      return [];
    }
    warnTellerQuery("org open sessions", error);
    return [];
  }
  return (data ?? []).map((row: Record<string, unknown>) => {
    const staff = row.staff as { full_name?: string | null } | null;
    const { staff: _s, ...sess } = row;
    return {
      ...(sess as SaccoTellerSessionRow),
      staff_full_name: staff?.full_name ?? null,
    };
  });
}

/** Open till sessions with computed cash on hand (manager oversight). */
export async function fetchTillPositionsForOrganization(
  organizationId: string,
  insuredLimitUgx: number | null
): Promise<TillPositionRow[]> {
  const sessions = await fetchOpenTellerSessionsForOrganization(organizationId);
  const limit = insuredLimitUgx != null && insuredLimitUgx > 0 ? insuredLimitUgx : null;
  const rows: TillPositionRow[] = [];
  for (const s of sessions) {
    const totals = await computeTillTotalsForSession(s);
    rows.push({
      ...s,
      tillEstimated: totals.tillEstimated,
      sessionReceiptsTotal: totals.sessionReceiptsTotal,
      sessionPaymentsTotal: totals.sessionPaymentsTotal,
      overInsuredLimit: limit !== null && totals.tillEstimated > limit,
    });
  }
  return rows;
}

/** Normalized yyyy-mm-dd for `sacco_teller_transactions.txn_date` (NOT NULL after migration). */
function normalizeTxnDateColumn(raw: string | null | undefined): string {
  const td = typeof raw === "string" ? raw.trim().slice(0, 10) : "";
  if (td && /^\d{4}-\d{2}-\d{2}$/.test(td)) return td;
  return businessTodayISO().slice(0, 10);
}

/** Posted journal / cashbook line date: business txn date when set, else today (Kampala). */
function entryDateForPostedTellerTxn(txn: SaccoTellerTransactionRow): string {
  const raw = txn.txn_date;
  const d = typeof raw === "string" ? raw.trim().slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return businessTodayISO();
}

/** Posted teller transactions for a calendar date range (inclusive, yyyy-mm-dd). Uses txn_date when available. */
export async function fetchTellerTransactionsForDateRange(
  organizationId: string,
  dateFrom: string,
  dateTo: string
): Promise<SaccoTellerTransactionRow[]> {
  if (!isValidUuid(organizationId)) return [];
  const from = dateFrom.slice(0, 10);
  const to = dateTo.slice(0, 10);

  const byTxnDate = await runTellerTxnQuery((columns) =>
    sb
      .from("sacco_teller_transactions")
      .select(columns)
      .eq("organization_id", organizationId)
      .gte("txn_date", from)
      .lte("txn_date", to)
      .order("created_at", { ascending: true })
  );

  if (!byTxnDate.error) {
    return (byTxnDate.data ?? []) as SaccoTellerTransactionRow[];
  }

  const errMsg = String((byTxnDate.error as { message?: string })?.message ?? "").toLowerCase();
  if (isUnknownColumnError(byTxnDate.error) && errMsg.includes("txn_date")) {
    const fromIso = `${from}T00:00:00.000Z`;
    const end = new Date(`${to}T12:00:00`);
    end.setUTCDate(end.getUTCDate() + 1);
    const toIso = end.toISOString();
    const legacy = await runTellerTxnQuery((columns) =>
      sb
        .from("sacco_teller_transactions")
        .select(columns)
        .eq("organization_id", organizationId)
        .gte("created_at", fromIso)
        .lt("created_at", toIso)
        .order("created_at", { ascending: true })
    );
    if (legacy.error) {
      if (isMissingTellerSchemaError(legacy.error)) return [];
      warnTellerQuery("transactions for date range", legacy.error);
      return [];
    }
    return (legacy.data ?? []) as SaccoTellerTransactionRow[];
  }

  if (isMissingTellerSchemaError(byTxnDate.error)) return [];
  warnTellerQuery("transactions for date range", byTxnDate.error);
  return [];
}

/** Supervisor closes any open till session in the org (e.g. third teller blocked by stuck row). */
export async function closeTellerSessionByIdAsSupervisor(params: {
  organizationId: string;
  sessionId: string;
  notes?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("sacco_teller_sessions")
    .update({
      status: "closed",
      closed_at: now,
      notes: params.notes?.trim() || "Closed by supervisor from Teller.",
    })
    .eq("id", params.sessionId)
    .eq("organization_id", params.organizationId)
    .eq("status", "open")
    .select("id");
  if (error) throw new Error(formatTellerDbError(error, "Could not close till session"));
  if (!data?.length) throw new Error("Session not found or already closed.");
}

/** Current user's open till session, if any (newest when multiple). */
export async function fetchOpenTellerSession(
  organizationId: string,
  staffId: string
): Promise<SaccoTellerSessionRow | null> {
  const rows = await fetchOpenTellerSessionsForStaff(organizationId, staffId);
  return rows[0] ?? null;
}

/** Close every open till session for this staff member in the org (end-of-day / stuck recovery). */
export async function closeAllOpenTellerSessionsForStaff(params: {
  organizationId: string;
  staffId: string;
  notes?: string | null;
}): Promise<number> {
  const now = new Date().toISOString();
  const note =
    params.notes?.trim() ||
    "Auto-closed to clear a stuck open session (no counted cash — reopen the till if you are working today).";
  const { data, error } = await sb
    .from("sacco_teller_sessions")
    .update({
      status: "closed",
      closed_at: now,
      notes: note,
    })
    .eq("organization_id", params.organizationId)
    .eq("staff_id", params.staffId)
    .eq("status", "open")
    .select("id");
  if (error) {
    throwIfTellerDbError(error);
    throw new Error(formatTellerDbError(error, "Could not close open till session(s)"));
  }
  return (data ?? []).length;
}

async function computeTillTotalsForSession(session: SaccoTellerSessionRow): Promise<{
  tillEstimated: number;
  sessionReceiptsTotal: number;
  sessionPaymentsTotal: number;
}> {
  let sessionReceiptsTotal = 0;
  let sessionPaymentsTotal = 0;
  let bal = Number(session.opening_float);
  const { data: sessTx, error } = await sb
    .from("sacco_teller_transactions")
    .select("txn_type, amount")
    .eq("session_id", session.id)
    .eq("status", "posted");
  if (error) {
    console.warn("[SACCO teller] session tx totals:", error);
    return { tillEstimated: bal, sessionReceiptsTotal: 0, sessionPaymentsTotal: 0 };
  }
  for (const t of sessTx ?? []) {
    const amt = Number((t as { amount: number }).amount);
    const typ = (t as { txn_type: string }).txn_type;
    if (typ === "cash_deposit" || typ === "cheque_received" || typ === "cheque_clearing") {
      bal += amt;
      sessionReceiptsTotal += amt;
    } else if (typ === "cash_withdrawal" || typ === "cheque_paid" || typ === "till_vault_out") {
      bal -= amt;
      sessionPaymentsTotal += amt;
    } else if (typ === "adjustment" || typ === "till_vault_in") {
      bal += amt;
    }
  }
  return { tillEstimated: bal, sessionReceiptsTotal, sessionPaymentsTotal };
}

export async function fetchTellerDashboardSnapshot(
  organizationId: string,
  staffId: string | undefined
): Promise<TellerDashboardSnapshot> {
  if (!isValidUuid(organizationId)) {
    console.warn("[SACCO teller] Invalid organization id — cannot load teller snapshot.");
    return {
      schemaMissing: false,
      openSession: null,
      tillEstimated: null,
      sessionReceiptsTotal: 0,
      sessionPaymentsTotal: 0,
      vaultPosition: 0,
      pendingApprovalCount: 0,
      pendingApprovals: [],
      recentTransactions: [],
      recentVaultMoves: [],
      recentAudit: [],
    };
  }

  const empty: TellerDashboardSnapshot = {
    schemaMissing: false,
    openSession: null,
    tillEstimated: null,
    sessionReceiptsTotal: 0,
    sessionPaymentsTotal: 0,
    vaultPosition: 0,
    pendingApprovalCount: 0,
    pendingApprovals: [],
    recentTransactions: [],
    recentVaultMoves: [],
    recentAudit: [],
  };

  let openSession: SaccoTellerSessionRow | null = null;
  try {
    if (staffId) {
      openSession = await fetchOpenTellerSession(organizationId, staffId);
    }
  } catch (err) {
    if (isMissingTellerSchemaError(err)) {
      console.warn("[SACCO] Teller sessions table missing —", TELLER_MIGRATION_HINT);
      return { ...empty, schemaMissing: true };
    }
    console.warn("[SACCO teller] open session lookup:", err);
  }

  const [prRes, vchRes, rtxRes, vmRes, auRes] = await Promise.all([
    runTellerTxnQuery((columns) =>
      sb
        .from("sacco_teller_transactions")
        .select(columns)
        .eq("organization_id", organizationId)
        .eq("status", "pending_approval")
        .order("created_at", { ascending: true })
        .limit(50)
    ),
    sb.from("sacco_vault_movements").select("signed_vault_change").eq("organization_id", organizationId),
    runTellerTxnQuery((columns) =>
      sb
        .from("sacco_teller_transactions")
        .select(columns)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(25)
    ),
    sb
      .from("sacco_vault_movements")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(15),
    sb
      .from("sacco_teller_audit_log")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (prRes.error) {
    if (isMissingTellerSchemaError(prRes.error)) return { ...empty, schemaMissing: true, openSession };
    warnTellerQuery("pending approvals", prRes.error);
  }
  if (vchRes.error) {
    if (isMissingTellerSchemaError(vchRes.error)) return { ...empty, schemaMissing: true, openSession };
    warnTellerQuery("vault sum", vchRes.error);
  }
  if (rtxRes.error) {
    if (isMissingTellerSchemaError(rtxRes.error)) return { ...empty, schemaMissing: true, openSession };
    warnTellerQuery("recent tx", rtxRes.error);
  }
  if (vmRes.error) {
    if (isMissingTellerSchemaError(vmRes.error)) return { ...empty, schemaMissing: true, openSession };
    warnTellerQuery("vault moves", vmRes.error);
  }
  if (auRes.error) {
    if (isMissingTellerSchemaError(auRes.error)) return { ...empty, schemaMissing: true, openSession };
    warnTellerQuery("audit", auRes.error);
  }

  const pendingRows = prRes.error ? [] : prRes.data;
  const pending = pendingRows?.length ?? 0;
  const vaultRows = vchRes.error ? [] : vchRes.data;
  const vaultPosition = (vaultRows ?? []).reduce(
    (s: number, r: { signed_vault_change: number }) => s + Number(r.signed_vault_change),
    0
  );
  const txList = rtxRes.error ? [] : rtxRes.data;
  const vmList = vmRes.error ? [] : vmRes.data;
  const auditList = auRes.error ? [] : auRes.data;

  let tillEstimated: number | null = null;
  let sessionReceiptsTotal = 0;
  let sessionPaymentsTotal = 0;
  if (openSession) {
    const totals = await computeTillTotalsForSession(openSession);
    tillEstimated = totals.tillEstimated;
    sessionReceiptsTotal = totals.sessionReceiptsTotal;
    sessionPaymentsTotal = totals.sessionPaymentsTotal;
  }

  return {
    schemaMissing: false,
    openSession,
    tillEstimated,
    sessionReceiptsTotal,
    sessionPaymentsTotal,
    vaultPosition,
    pendingApprovalCount: pending ?? 0,
    pendingApprovals: (pendingRows ?? []) as SaccoTellerTransactionRow[],
    recentTransactions: (txList ?? []) as SaccoTellerTransactionRow[],
    recentVaultMoves: (vmList ?? []) as SaccoVaultMovementRow[],
    recentAudit: (auditList ?? []) as SaccoTellerAuditRow[],
  };
}

export async function fetchTellerMemberPickList(organizationId: string): Promise<TellerMemberPickRow[]> {
  if (!isValidUuid(organizationId)) return [];
  let res = await sb
    .from("sacco_members")
    .select("id, member_number, full_name")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("member_number");
  if (res.error && isUnknownColumnError(res.error)) {
    res = await sb
      .from("sacco_members")
      .select("id, member_number, full_name")
      .eq("organization_id", organizationId)
      .order("member_number");
  }
  if (res.error) {
    if (isMissingTellerSchemaError(res.error)) return [];
    warnTellerQuery("members pick list", res.error);
    return [];
  }
  return (res.data ?? []) as TellerMemberPickRow[];
}

export async function fetchTellerSavingsAccountPickList(organizationId: string): Promise<TellerSavingsAccountPickRow[]> {
  const baseSelect = "id, account_number, savings_product_code, balance, sacco_member_id";
  let accs: unknown[] | null = null;
  let e1: { code?: string; message?: string; status?: number } | null = null;

  const withActive = await sb
    .from("sacco_member_savings_accounts")
    .select(baseSelect)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("account_number");
  if (withActive.error && isUnknownColumnError(withActive.error)) {
    const withoutActive = await sb
      .from("sacco_member_savings_accounts")
      .select(baseSelect)
      .eq("organization_id", organizationId)
      .order("account_number");
    accs = withoutActive.data;
    e1 = withoutActive.error;
  } else {
    accs = withActive.data;
    e1 = withActive.error;
  }

  if (e1) {
    if (isMissingTellerSchemaError(e1)) return [];
    warnTellerQuery("savings accounts pick list", e1);
    return [];
  }
  const list = (accs ?? []) as Array<{
    id: string;
    account_number: string;
    savings_product_code: string;
    balance: number;
    sacco_member_id: string;
  }>;
  const ids = [...new Set(list.map((a) => a.sacco_member_id))];
  if (ids.length === 0) return [];
  const { data: mems, error: e2 } = await sb
    .from("sacco_members")
    .select("id, member_number, full_name")
    .eq("organization_id", organizationId)
    .in("id", ids);
  if (e2) {
    if (isMissingTellerSchemaError(e2)) return [];
    warnTellerQuery("savings account member names", e2);
    return list.map((a) => ({
      id: a.id,
      account_number: a.account_number,
      savings_product_code: a.savings_product_code ?? "",
      sacco_member_id: a.sacco_member_id,
      member_number: "",
      full_name: "",
      balance: Number(a.balance),
    }));
  }
  const map = new Map((mems ?? []).map((m: TellerMemberPickRow) => [m.id, m]));
  return list.map((a) => {
    const m = map.get(a.sacco_member_id);
    return {
      id: a.id,
      account_number: a.account_number,
      savings_product_code: a.savings_product_code,
      sacco_member_id: a.sacco_member_id,
      member_number: m?.member_number ?? "",
      full_name: m?.full_name ?? "",
      balance: Number(a.balance),
    };
  });
}

export async function appendTellerAuditLog(params: {
  organizationId: string;
  entityType: string;
  entityId?: string | null;
  action: string;
  actorStaffId?: string | null;
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  const { error } = await sb.from("sacco_teller_audit_log").insert({
    organization_id: params.organizationId,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    action: params.action,
    actor_staff_id: params.actorStaffId ?? null,
    detail: params.detail ?? null,
  });
  if (error) {
    if (isMissingTellerSchemaError(error)) {
      console.warn("[SACCO] sacco_teller_audit_log missing — run teller migration.");
      return;
    }
    throw error;
  }
}

function throwIfTellerDbError(err: unknown): void {
  if (isMissingTellerSchemaError(err)) {
    throw new Error("Teller tables are not installed. Run migration 20260426120007_sacco_teller.sql (and 20260426120008 for vault transfer types).");
  }
  throw err;
}

/** Delta to apply to `sacco_member_savings_accounts.balance` for this txn type (member-linked postings only). */
export function tellerDeltaForSavingsAccountBalance(txnType: string, amount: number): number | null {
  const a = Number(amount);
  if (!Number.isFinite(a) || a < 0) return null;
  switch (txnType) {
    case "cash_deposit":
    case "cheque_received":
    case "cheque_clearing":
      return a;
    case "cash_withdrawal":
    case "cheque_paid":
      return -a;
    case "adjustment":
      return a;
    default:
      return null;
  }
}

/**
 * When a teller txn is posted against a savings account, mirror the amount into that account’s balance
 * so loan eligibility and registers see up-to-date figures.
 */
async function applySavingsBalanceDelta(params: {
  organizationId: string;
  accountId: string;
  delta: number;
}): Promise<void> {
  if (params.delta === 0) return;
  const { data: acct, error: e1 } = await sb
    .from("sacco_member_savings_accounts")
    .select("balance")
    .eq("id", params.accountId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (e1) {
    if (isMissingTellerSchemaError(e1)) return;
    throw e1;
  }
  if (!acct) return;
  const prev = Number((acct as { balance: unknown }).balance ?? 0);
  const next = Math.max(0, prev + params.delta);
  const { error: e2 } = await sb
    .from("sacco_member_savings_accounts")
    .update({ balance: next })
    .eq("id", params.accountId)
    .eq("organization_id", params.organizationId);
  if (e2) {
    throwIfTellerDbError(e2);
    throw e2;
  }
}

async function applyPostedTellerTxnToSavingsAccountBalance(params: {
  organizationId: string;
  txn: SaccoTellerTransactionRow;
}): Promise<void> {
  const acctId = params.txn.sacco_member_savings_account_id;
  if (!acctId) return;
  const delta = tellerDeltaForSavingsAccountBalance(String(params.txn.txn_type), Number(params.txn.amount));
  if (delta === null || delta === 0) return;
  await applySavingsBalanceDelta({ organizationId: params.organizationId, accountId: acctId, delta });
}

/**
 * Double-entry journal for till cash vs counterparty GL (cash deposit / withdrawal).
 * Uses org "Cash & bank" from Journal GL settings; idempotent via journal_entries (reference sacco_teller + teller txn id).
 */
async function postJournalForPostedTellerTxn(params: {
  organizationId: string;
  staffId: string;
  txn: SaccoTellerTransactionRow;
}): Promise<string | null> {
  const { organizationId, staffId, txn } = params;
  const t = String(txn.txn_type);
  if (t !== "cash_deposit" && t !== "cash_withdrawal") return null;
  const cp = txn.counterparty_gl_account_id;
  if (!cp) return null;

  /** Same “Auto” semantics as the rest of BOAT: explicit cash in journal settings, else category/name match, else first asset. */
  const { cash: cashId } = await getDefaultGlAccounts();
  if (!cashId) {
    throw new Error(
      "Add at least one asset account to the chart (or set Cash & bank in Admin → Journal account settings) so teller cash can post to the general ledger."
    );
  }

  const amount = Math.round(Number(txn.amount));
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Invalid transaction amount for journal posting.");
  }

  const lines =
    t === "cash_deposit"
      ? [
          { gl_account_id: cashId, debit: amount, credit: 0, line_description: "Till cash (in)" },
          { gl_account_id: cp, debit: 0, credit: amount, line_description: txn.member_ref ?? "Counterparty" },
        ]
      : [
          { gl_account_id: cp, debit: amount, credit: 0, line_description: txn.member_ref ?? "Counterparty" },
          { gl_account_id: cashId, debit: 0, credit: amount, line_description: "Till cash (out)" },
        ];

  const res = await createJournalEntry({
    entry_date: entryDateForPostedTellerTxn(txn),
    description: `Teller ${t.replace(/_/g, " ")} — ${(txn.member_ref ?? "").trim() || "—"}`,
    reference_type: "sacco_teller",
    reference_id: txn.id,
    lines,
    created_by: staffId,
  });
  if (!res.ok) throw new Error(res.error);
  return res.journalId;
}

/** Member-facing cashbook line so Client dashboard "Recent transactions" matches teller activity. */
async function insertCashbookLineForTellerTxn(params: {
  organizationId: string;
  txn: SaccoTellerTransactionRow;
}): Promise<void> {
  const { organizationId, txn } = params;
  const memberId = txn.sacco_member_id;
  if (!memberId) return;
  const t = String(txn.txn_type);
  if (t !== "cash_deposit" && t !== "cash_withdrawal") return;

  const amount = Math.round(Number(txn.amount));
  if (!Number.isFinite(amount) || amount < 0) return;

  const { data: prevRows, error: prevErr } = await sb
    .from("sacco_cashbook_entries")
    .select("balance")
    .eq("organization_id", organizationId)
    .eq("sacco_member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (prevErr) {
    if (isMissingTellerSchemaError(prevErr)) return;
    console.warn("[SACCO teller] cashbook previous balance:", prevErr);
  }
  const prev = Number((prevRows?.[0] as { balance?: unknown } | undefined)?.balance ?? 0) || 0;

  const debit = t === "cash_deposit" ? amount : 0;
  const credit = t === "cash_withdrawal" ? amount : 0;
  const balance = prev + debit - credit;

  const desc =
    t === "cash_deposit"
      ? `Cash deposit (teller) — ${(txn.member_ref ?? "").trim() || "—"}`
      : `Cash withdrawal (teller) — ${(txn.member_ref ?? "").trim() || "—"}`;

  const memberNameFromRef = txn.member_ref?.includes("—")
    ? txn.member_ref.split("—")[1]?.trim() ?? null
    : txn.member_ref ?? null;

  const { error: insErr } = await sb.from("sacco_cashbook_entries").insert({
    organization_id: organizationId,
    entry_date: entryDateForPostedTellerTxn(txn),
    description: desc,
    reference: txn.id,
    category: "Teller",
    sacco_member_id: memberId,
    member_name: memberNameFromRef,
    debit,
    credit,
    balance,
  });
  if (insErr && !isMissingTellerSchemaError(insErr)) {
    console.warn("[SACCO teller] cashbook insert:", insErr);
  }
}

async function finalizePostedTellerTxnEffects(params: {
  organizationId: string;
  staffId: string;
  txn: SaccoTellerTransactionRow;
}): Promise<void> {
  const journalId = await postJournalForPostedTellerTxn(params);
  if (journalId) {
    const { error: updErr } = await sb
      .from("sacco_teller_transactions")
      .update({ journal_batch_ref: journalId })
      .eq("id", params.txn.id)
      .eq("organization_id", params.organizationId);
    if (updErr) {
      throwIfTellerDbError(updErr);
      throw updErr;
    }
  }
  await applyPostedTellerTxnToSavingsAccountBalance({ organizationId: params.organizationId, txn: params.txn });
  await insertCashbookLineForTellerTxn({ organizationId: params.organizationId, txn: params.txn });
}

async function assertTellerStaffCanOpen(params: { organizationId: string; staffId: string }): Promise<void> {
  const ctx = await resolveTellerStaffContext(params.staffId);
  if (!ctx) {
    throw new Error(
      "Your sign-in is not linked to a staff record in this organization. Ask an admin to add you under Staff, then sign in again."
    );
  }
  if (ctx.organizationId !== params.organizationId) {
    throw new Error(
      "Your staff account belongs to a different organization than this SACCO workspace. Ask an admin to fix your staff organization link."
    );
  }
  if (ctx.staffId !== params.staffId) {
    throw new Error("Teller sessions must be opened under your own staff login.");
  }
}

async function insertOpenTellerSessionRow(params: {
  organizationId: string;
  staffId: string;
  openingFloat: number;
  notes?: string | null;
}): Promise<SaccoTellerSessionRow> {
  await assertTellerStaffCanOpen(params);
  const { data, error } = await sb
    .from("sacco_teller_sessions")
    .insert({
      organization_id: params.organizationId,
      staff_id: params.staffId,
      opening_float: params.openingFloat,
      status: "open",
      notes: params.notes ?? null,
    })
    .select(TELLER_SESSION_SELECT)
    .single();
  if (error) throw error;
  return data as SaccoTellerSessionRow;
}

export type OpenTellerSessionResult = {
  session: SaccoTellerSessionRow;
  /** True when an existing open session was reused (not a new insert). */
  resumed: boolean;
};

export async function openTellerSession(params: {
  organizationId: string;
  staffId: string;
  openingFloat: number;
  notes?: string | null;
}): Promise<SaccoTellerSessionRow> {
  const r = await resumeOrOpenTellerSession(params);
  return r.session;
}

/** Open till or resume the current open session; clears stuck duplicates when needed. */
export async function resumeOrOpenTellerSession(params: {
  organizationId: string;
  staffId: string;
  openingFloat: number;
  notes?: string | null;
  /** When true, close any open session for this staff+org then open fresh. */
  forceNew?: boolean;
}): Promise<OpenTellerSessionResult> {
  if (!params.organizationId?.trim()) {
    throw new Error("No organization is linked to your account.");
  }
  if (!params.staffId?.trim()) {
    throw new Error("Sign in with a staff account to open the till.");
  }
  await assertTellerStaffCanOpen({
    organizationId: params.organizationId,
    staffId: params.staffId,
  });

  let openRows = await fetchOpenTellerSessionsForStaff(params.organizationId, params.staffId).catch((e) => {
    if (isMissingTellerSchemaError(e)) throw new Error(formatTellerDbError(e));
    throw e;
  });

  if (params.forceNew && openRows.length > 0) {
    await closeAllOpenTellerSessionsForStaff({
      organizationId: params.organizationId,
      staffId: params.staffId,
      notes: params.notes,
    });
    openRows = [];
  }

  if (openRows.length > 1) {
    const keep = openRows[0]!;
    for (const extra of openRows.slice(1)) {
      await sb
        .from("sacco_teller_sessions")
        .update({ status: "closed", closed_at: new Date().toISOString(), notes: "Auto-closed duplicate open session." })
        .eq("id", extra.id)
        .eq("organization_id", params.organizationId);
    }
    return { session: keep, resumed: true };
  }

  if (openRows.length === 1) {
    return { session: openRows[0]!, resumed: true };
  }

  try {
    const row = await insertOpenTellerSessionRow(params);
    await appendTellerAuditLog({
      organizationId: params.organizationId,
      entityType: "sacco_teller_sessions",
      entityId: row.id,
      action: "session_open",
      actorStaffId: params.staffId,
      detail: { opening_float: params.openingFloat },
    });
    return { session: row, resumed: false };
  } catch (error) {
    const code = String((error as { code?: string }).code ?? "");
    const msg = String((error as { message?: string }).message ?? "");
    const isDup = code === "23505" || /unique|duplicate|sacco_teller_sess_one_open/i.test(msg);

    if (!isDup) {
      throw new Error(formatTellerDbError(error, "Could not open till session"));
    }

    const afterDup = await fetchOpenTellerSessionsForStaff(params.organizationId, params.staffId);
    if (afterDup[0]) {
      return { session: afterDup[0], resumed: true };
    }

    const closed = await closeAllOpenTellerSessionsForStaff({
      organizationId: params.organizationId,
      staffId: params.staffId,
    });
    if (closed > 0) {
      try {
        const row = await insertOpenTellerSessionRow(params);
        await appendTellerAuditLog({
          organizationId: params.organizationId,
          entityType: "sacco_teller_sessions",
          entityId: row.id,
          action: "session_open",
          actorStaffId: params.staffId,
          detail: { opening_float: params.openingFloat, recovered_from_stuck: true },
        });
        return { session: row, resumed: false };
      } catch (retryErr) {
        throw new Error(formatTellerDbError(retryErr, "Could not open till after clearing stuck session"));
      }
    }

    const orgOpen = await fetchOpenTellerSessionsForOrganization(params.organizationId);
    const others = orgOpen.filter((s) => s.staff_id !== params.staffId);
    if (others.length > 0 && orgOpen.length >= 2) {
      throw new Error(
        `Could not open your till (${orgOpen.length} session(s) already open in this SACCO). ` +
          "Each teller must use their own staff login. If you share one login, only one till can be open. " +
          "A supervisor can close other open tills from the Teller screen, or run migration 20260517130000_sacco_teller_concurrent_sessions.sql if a database cap is blocking new sessions."
      );
    }
    throw new Error(
      "A till session is already open in the database but could not be loaded or closed. Ask an administrator to close open rows in sacco_teller_sessions for your staff account, then try again."
    );
  }
}

export async function closeTellerSession(params: {
  organizationId: string;
  staffId: string;
  sessionId: string;
  closingCounted: number;
  expectedBalance: number;
  overShort: number;
  notes?: string | null;
}): Promise<SaccoTellerSessionRow> {
  const { data, error } = await sb
    .from("sacco_teller_sessions")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closing_counted: params.closingCounted,
      expected_balance: params.expectedBalance,
      over_short: params.overShort,
      notes: params.notes ?? null,
    })
    .eq("id", params.sessionId)
    .eq("organization_id", params.organizationId)
    .eq("staff_id", params.staffId)
    .eq("status", "open")
    .select("*")
    .single();
  if (error) {
    throwIfTellerDbError(error);
    throw error;
  }
  if (!data) {
    throw new Error("Session not found or already closed.");
  }
  const row = data as SaccoTellerSessionRow;
  await appendTellerAuditLog({
    organizationId: params.organizationId,
    entityType: "sacco_teller_sessions",
    entityId: row.id,
    action: "session_close",
    actorStaffId: params.staffId,
    detail: {
      closing_counted: params.closingCounted,
      expected_balance: params.expectedBalance,
      over_short: params.overShort,
    },
  });
  return row;
}

export async function createTellerTransaction(params: {
  organizationId: string;
  staffId: string;
  sessionId: string;
  txnType: SaccoTellerTxnType;
  amount: number;
  saccoMemberId?: string | null;
  saccoMemberSavingsAccountId?: string | null;
  postingPurpose?: TellerPostingPurpose | null;
  /** Non-cash GL line for cash deposit/withdrawal (journal posting). */
  counterpartyGlAccountId?: string | null;
  memberRef?: string | null;
  narration?: string | null;
  chequeNumber?: string | null;
  chequeBank?: string | null;
  chequeValueDate?: string | null;
  /** Business date yyyy-mm-dd (Kampala); defaults to today. */
  txnDate?: string | null;
  mode: "posted" | "pending_approval";
  journalBatchRef?: string | null;
}): Promise<SaccoTellerTransactionRow> {
  const status = params.mode === "posted" ? "posted" : "pending_approval";
  const txnDateRow = normalizeTxnDateColumn(params.txnDate);
  const insertRow = {
    organization_id: params.organizationId,
    session_id: params.sessionId,
    txn_type: params.txnType,
    amount: params.amount,
    sacco_member_id: params.saccoMemberId ?? null,
    sacco_member_savings_account_id: params.saccoMemberSavingsAccountId ?? null,
    posting_purpose: params.postingPurpose ?? null,
    counterparty_gl_account_id: params.counterpartyGlAccountId ?? null,
    member_ref: params.memberRef ?? null,
    narration: params.narration ?? null,
    cheque_number: params.chequeNumber ?? null,
    cheque_bank: params.chequeBank ?? null,
    cheque_value_date: params.chequeValueDate ?? null,
    txn_date: txnDateRow,
    status,
    maker_staff_id: params.staffId,
    checker_staff_id: null as string | null,
    approved_at: status === "posted" ? new Date().toISOString() : null,
    journal_batch_ref: params.journalBatchRef ?? null,
  };
  const { data, error } = await sb.from("sacco_teller_transactions").insert(insertRow).select("*").single();
  if (error) {
    throwIfTellerDbError(error);
    throw error;
  }
  const row = data as SaccoTellerTransactionRow;
  await appendTellerAuditLog({
    organizationId: params.organizationId,
    entityType: "sacco_teller_transactions",
    entityId: row.id,
    action: status === "posted" ? "txn_posted" : "txn_pending",
    actorStaffId: params.staffId,
    detail: {
      txn_type: params.txnType,
      amount: params.amount,
      status,
      posting_purpose: params.postingPurpose ?? null,
      savings_account_id: params.saccoMemberSavingsAccountId ?? null,
      counterparty_gl_account_id: params.counterpartyGlAccountId ?? null,
    },
  });
  if (status === "posted") {
    try {
      await finalizePostedTellerTxnEffects({
        organizationId: params.organizationId,
        staffId: params.staffId,
        txn: row,
      });
    } catch (e) {
      await sb.from("sacco_teller_transactions").delete().eq("id", row.id).eq("organization_id", params.organizationId);
      throw e;
    }
  }
  return row;
}

export async function approveTellerTransaction(params: {
  organizationId: string;
  transactionId: string;
  checkerStaffId: string;
}): Promise<SaccoTellerTransactionRow> {
  const { data: existing, error: e0 } = await sb
    .from("sacco_teller_transactions")
    .select("*")
    .eq("id", params.transactionId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (e0) {
    throwIfTellerDbError(e0);
    throw e0;
  }
  if (!existing) throw new Error("Transaction not found.");
  const ex = existing as SaccoTellerTransactionRow;
  if (ex.status !== "pending_approval") throw new Error("Only pending transactions can be approved.");

  const { data, error } = await sb
    .from("sacco_teller_transactions")
    .update({
      status: "posted",
      checker_staff_id: params.checkerStaffId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", params.transactionId)
    .eq("organization_id", params.organizationId)
    .eq("status", "pending_approval")
    .select("*")
    .single();
  if (error) {
    throwIfTellerDbError(error);
    throw error;
  }
  if (!data) throw new Error("Update failed — transaction may have been processed already.");
  const row = data as SaccoTellerTransactionRow;
  await appendTellerAuditLog({
    organizationId: params.organizationId,
    entityType: "sacco_teller_transactions",
    entityId: row.id,
    action: "txn_approved",
    actorStaffId: params.checkerStaffId,
    detail: { txn_type: row.txn_type, amount: row.amount },
  });
  await finalizePostedTellerTxnEffects({
    organizationId: params.organizationId,
    staffId: params.checkerStaffId,
    txn: row,
  });
  return row;
}

export async function rejectTellerTransaction(params: {
  organizationId: string;
  transactionId: string;
  checkerStaffId: string;
  reason?: string | null;
}): Promise<SaccoTellerTransactionRow> {
  const { data: existing, error: e0 } = await sb
    .from("sacco_teller_transactions")
    .select("*")
    .eq("id", params.transactionId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (e0) {
    throwIfTellerDbError(e0);
    throw e0;
  }
  if (!existing) throw new Error("Transaction not found.");
  const ex = existing as SaccoTellerTransactionRow;
  if (ex.status !== "pending_approval") throw new Error("Only pending transactions can be rejected.");

  const reason = (params.reason ?? "").trim() || "No reason provided";
  const baseNarr = ex.narration ?? "";
  const newNarr = baseNarr ? `${baseNarr} [Checker rejected: ${reason}]` : `[Checker rejected: ${reason}]`;

  const { data, error } = await sb
    .from("sacco_teller_transactions")
    .update({
      status: "rejected",
      checker_staff_id: params.checkerStaffId,
      approved_at: null,
      narration: newNarr,
    })
    .eq("id", params.transactionId)
    .eq("organization_id", params.organizationId)
    .eq("status", "pending_approval")
    .select("*")
    .single();
  if (error) {
    throwIfTellerDbError(error);
    throw error;
  }
  if (!data) throw new Error("Update failed — transaction may have been processed already.");
  const row = data as SaccoTellerTransactionRow;
  await appendTellerAuditLog({
    organizationId: params.organizationId,
    entityType: "sacco_teller_transactions",
    entityId: row.id,
    action: "txn_rejected",
    actorStaffId: params.checkerStaffId,
    detail: { reason, txn_type: row.txn_type, amount: row.amount },
  });
  return row;
}

function snapTxnForAudit(txn: SaccoTellerTransactionRow): Record<string, unknown> {
  return {
    id: txn.id,
    txn_type: txn.txn_type,
    txn_date: txn.txn_date ?? null,
    amount: txn.amount,
    status: txn.status,
    sacco_member_id: txn.sacco_member_id,
    sacco_member_savings_account_id: txn.sacco_member_savings_account_id ?? null,
    posting_purpose: txn.posting_purpose ?? null,
    counterparty_gl_account_id: txn.counterparty_gl_account_id ?? null,
    member_ref: txn.member_ref,
    narration: txn.narration,
    journal_batch_ref: txn.journal_batch_ref,
  };
}

async function insertSaccoTransactionEditAudit(params: {
  organizationId: string;
  originalTxnId: string;
  replacementTxnId?: string | null;
  editorStaffId: string;
  editKind: "pending_edit" | "posted_correction";
  reason: string;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
}): Promise<void> {
  const { error } = await sb.from("sacco_transaction_edits").insert({
    organization_id: params.organizationId,
    original_txn_id: params.originalTxnId,
    replacement_txn_id: params.replacementTxnId ?? null,
    editor_staff_id: params.editorStaffId,
    edit_kind: params.editKind,
    reason: params.reason,
    old_values: params.oldValues,
    new_values: params.newValues,
  });
  if (error && !isMissingTellerSchemaError(error)) {
    console.warn("[SACCO] sacco_transaction_edits insert:", error);
  }
}

/** Reverse GL for a posted cash deposit/withdrawal (compensating entry). */
async function postReversalJournalForPostedTellerTxn(params: {
  staffId: string;
  txn: SaccoTellerTransactionRow;
  reason: string;
}): Promise<string | null> {
  const t = String(params.txn.txn_type);
  if (t !== "cash_deposit" && t !== "cash_withdrawal") return null;
  const cp = params.txn.counterparty_gl_account_id;
  if (!cp) return null;

  const { cash: cashId } = await getDefaultGlAccounts();
  if (!cashId) return null;

  const amount = Math.round(Number(params.txn.amount));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const lines =
    t === "cash_deposit"
      ? [
          { gl_account_id: cashId, debit: 0, credit: amount, line_description: "Reversal: till cash (in)" },
          { gl_account_id: cp, debit: amount, credit: 0, line_description: "Reversal" },
        ]
      : [
          { gl_account_id: cp, debit: 0, credit: amount, line_description: "Reversal" },
          { gl_account_id: cashId, debit: amount, credit: 0, line_description: "Reversal: till cash (out)" },
        ];

  const res = await createJournalEntry({
    entry_date: entryDateForPostedTellerTxn(params.txn),
    description: `Reversal — teller ${t.replace(/_/g, " ")} (${params.reason.slice(0, 80)})`,
    reference_type: "sacco_teller",
    reference_id: params.txn.id,
    lines,
    created_by: params.staffId,
  });
  if (!res.ok) throw new Error(res.error);
  return res.journalId;
}

async function insertCashbookReversalForTellerTxn(params: {
  organizationId: string;
  txn: SaccoTellerTransactionRow;
}): Promise<void> {
  const memberId = params.txn.sacco_member_id;
  if (!memberId) return;
  const t = String(params.txn.txn_type);
  if (t !== "cash_deposit" && t !== "cash_withdrawal") return;

  const amount = Math.round(Number(params.txn.amount));
  if (!Number.isFinite(amount) || amount <= 0) return;

  const { data: prevRows } = await sb
    .from("sacco_cashbook_entries")
    .select("balance")
    .eq("organization_id", params.organizationId)
    .eq("sacco_member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(1);
  const prev = Number((prevRows?.[0] as { balance?: unknown } | undefined)?.balance ?? 0) || 0;

  const debit = t === "cash_deposit" ? 0 : amount;
  const credit = t === "cash_withdrawal" ? 0 : amount;
  const balance = prev + debit - credit;

  await sb.from("sacco_cashbook_entries").insert({
    organization_id: params.organizationId,
    entry_date: entryDateForPostedTellerTxn(params.txn),
    description: `Reversal (teller correction) — ${(params.txn.member_ref ?? "").trim() || "—"}`,
    reference: params.txn.id,
    category: "Teller",
    sacco_member_id: memberId,
    member_name: params.txn.member_ref?.includes("—")
      ? params.txn.member_ref.split("—")[1]?.trim() ?? null
      : params.txn.member_ref ?? null,
    debit,
    credit,
    balance,
  });
}

/** Undo savings balance and cashbook/GL effects of a posted teller transaction. */
async function reversePostedTellerTxnEffects(params: {
  organizationId: string;
  staffId: string;
  txn: SaccoTellerTransactionRow;
  reason: string;
}): Promise<void> {
  const delta = tellerDeltaForSavingsAccountBalance(String(params.txn.txn_type), Number(params.txn.amount));
  if (delta !== null && delta !== 0 && params.txn.sacco_member_savings_account_id) {
    await applySavingsBalanceDelta({
      organizationId: params.organizationId,
      accountId: params.txn.sacco_member_savings_account_id,
      delta: -delta,
    });
  }
  await insertCashbookReversalForTellerTxn({ organizationId: params.organizationId, txn: params.txn });
  await postReversalJournalForPostedTellerTxn({
    staffId: params.staffId,
    txn: params.txn,
    reason: params.reason,
  });
}

/** Only switching between these two is allowed when editing / correcting. */
function validateDepositWithdrawTxnTypePatch(currentType: string, patch: SaccoTellerTransactionPatch): void {
  if (patch.txn_type === undefined) return;
  const from = String(currentType);
  const to = String(patch.txn_type);
  const isCash = (t: string) => t === "cash_deposit" || t === "cash_withdrawal";
  if (!isCash(from)) {
    throw new Error("Transaction type can only be changed for cash deposit or cash withdrawal.");
  }
  if (!isCash(to)) {
    throw new Error("Can only switch between cash deposit and cash withdrawal.");
  }
}

function mergeTxnPatch(txn: SaccoTellerTransactionRow, patch: SaccoTellerTransactionPatch): SaccoTellerTransactionRow {
  return {
    ...txn,
    txn_type: patch.txn_type !== undefined ? patch.txn_type : txn.txn_type,
    txn_date: patch.txn_date !== undefined ? patch.txn_date : txn.txn_date,
    amount: patch.amount !== undefined ? patch.amount : txn.amount,
    narration: patch.narration !== undefined ? patch.narration : txn.narration,
    member_ref: patch.member_ref !== undefined ? patch.member_ref : txn.member_ref,
    sacco_member_id: patch.sacco_member_id !== undefined ? patch.sacco_member_id : txn.sacco_member_id,
    sacco_member_savings_account_id:
      patch.sacco_member_savings_account_id !== undefined
        ? patch.sacco_member_savings_account_id
        : txn.sacco_member_savings_account_id,
    posting_purpose: patch.posting_purpose !== undefined ? patch.posting_purpose : txn.posting_purpose,
    counterparty_gl_account_id:
      patch.counterparty_gl_account_id !== undefined
        ? patch.counterparty_gl_account_id
        : txn.counterparty_gl_account_id,
  };
}

/** Edit a draft or pending transaction in place (no GL/savings posted yet). */
export async function editPendingTellerTransaction(params: {
  organizationId: string;
  transactionId: string;
  editorStaffId: string;
  patch: SaccoTellerTransactionPatch;
  reason: string;
}): Promise<SaccoTellerTransactionRow> {
  const reason = params.reason.trim();
  if (!reason) throw new Error("A reason is required for transaction edits.");

  const { data: existing, error: e0 } = await sb
    .from("sacco_teller_transactions")
    .select("*")
    .eq("id", params.transactionId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (e0) {
    throwIfTellerDbError(e0);
    throw e0;
  }
  if (!existing) throw new Error("Transaction not found.");
  const ex = existing as SaccoTellerTransactionRow;
  if (ex.status !== "pending_approval" && ex.status !== "draft") {
    throw new Error("Only draft or pending transactions can be edited in place. Posted items must be corrected.");
  }
  if (params.patch.amount !== undefined && params.patch.amount < 0) {
    throw new Error("Amount cannot be negative.");
  }
  validateDepositWithdrawTxnTypePatch(String(ex.txn_type), params.patch);

  const oldSnap = snapTxnForAudit(ex);
  const updateRow: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.patch.txn_type !== undefined) updateRow.txn_type = params.patch.txn_type;
  if (params.patch.amount !== undefined) updateRow.amount = params.patch.amount;
  if (params.patch.narration !== undefined) updateRow.narration = params.patch.narration;
  if (params.patch.member_ref !== undefined) updateRow.member_ref = params.patch.member_ref;
  if (params.patch.sacco_member_id !== undefined) updateRow.sacco_member_id = params.patch.sacco_member_id;
  if (params.patch.sacco_member_savings_account_id !== undefined) {
    updateRow.sacco_member_savings_account_id = params.patch.sacco_member_savings_account_id;
  }
  if (params.patch.posting_purpose !== undefined) updateRow.posting_purpose = params.patch.posting_purpose;
  if (params.patch.counterparty_gl_account_id !== undefined) {
    updateRow.counterparty_gl_account_id = params.patch.counterparty_gl_account_id;
  }
  if (params.patch.txn_date !== undefined) {
    updateRow.txn_date = normalizeTxnDateColumn(params.patch.txn_date);
  }

  const { data, error } = await sb
    .from("sacco_teller_transactions")
    .update(updateRow)
    .eq("id", params.transactionId)
    .eq("organization_id", params.organizationId)
    .in("status", ["pending_approval", "draft"])
    .select("*")
    .single();
  if (error) {
    throwIfTellerDbError(error);
    throw error;
  }
  if (!data) throw new Error("Update failed.");
  const row = data as SaccoTellerTransactionRow;

  await insertSaccoTransactionEditAudit({
    organizationId: params.organizationId,
    originalTxnId: row.id,
    editorStaffId: params.editorStaffId,
    editKind: "pending_edit",
    reason,
    oldValues: oldSnap,
    newValues: snapTxnForAudit(row),
  });
  await appendTellerAuditLog({
    organizationId: params.organizationId,
    entityType: "sacco_teller_transactions",
    entityId: row.id,
    action: "txn_edited",
    actorStaffId: params.editorStaffId,
    detail: { reason, old_values: oldSnap, new_values: snapTxnForAudit(row) },
  });
  return row;
}

/**
 * Correct a posted teller transaction: reverse effects, mark original reversed,
 * post a replacement transaction, and record audit trail.
 */
export async function correctPostedTellerTransaction(params: {
  organizationId: string;
  transactionId: string;
  editorStaffId: string;
  patch: SaccoTellerTransactionPatch;
  reason: string;
}): Promise<{ original: SaccoTellerTransactionRow; replacement: SaccoTellerTransactionRow }> {
  const reason = params.reason.trim();
  if (!reason) throw new Error("A reason is required for transaction corrections.");

  const { data: existing, error: e0 } = await sb
    .from("sacco_teller_transactions")
    .select("*")
    .eq("id", params.transactionId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (e0) {
    throwIfTellerDbError(e0);
    throw e0;
  }
  if (!existing) throw new Error("Transaction not found.");
  const ex = existing as SaccoTellerTransactionRow;
  if (ex.status !== "posted") {
    throw new Error("Only posted transactions use the correction workflow.");
  }
  const tt = String(ex.txn_type);
  if (!canCorrectPostedTellerTxnType(tt)) {
    throw new Error(
      "Correction for this transaction type is not supported in the app yet. Vault and cheque movements need manual handling."
    );
  }
  validateDepositWithdrawTxnTypePatch(String(ex.txn_type), params.patch);
  const merged = mergeTxnPatch(ex, params.patch);
  if (merged.amount < 0) throw new Error("Amount cannot be negative.");
  if (!merged.session_id) throw new Error("Cannot correct a transaction without a till session.");

  const oldSnap = snapTxnForAudit(ex);

  await reversePostedTellerTxnEffects({
    organizationId: params.organizationId,
    staffId: params.editorStaffId,
    txn: ex,
    reason,
  });

  const { data: reversed, error: revErr } = await sb
    .from("sacco_teller_transactions")
    .update({
      status: "reversed",
      reversed_at: new Date().toISOString(),
      reversed_by_staff_id: params.editorStaffId,
      correction_reason: reason,
    })
    .eq("id", params.transactionId)
    .eq("organization_id", params.organizationId)
    .eq("status", "posted")
    .select("*")
    .single();
  if (revErr) {
    throwIfTellerDbError(revErr);
    throw revErr;
  }
  if (!reversed) throw new Error("Could not mark transaction as reversed.");
  const reversedRow = reversed as SaccoTellerTransactionRow;

  const insertRow = {
    organization_id: params.organizationId,
    session_id: merged.session_id,
    txn_type: merged.txn_type,
    amount: merged.amount,
    sacco_member_id: merged.sacco_member_id,
    sacco_member_savings_account_id: merged.sacco_member_savings_account_id ?? null,
    posting_purpose: merged.posting_purpose ?? null,
    counterparty_gl_account_id: merged.counterparty_gl_account_id ?? null,
    member_ref: merged.member_ref,
    narration: merged.narration,
    cheque_number: merged.cheque_number,
    cheque_bank: merged.cheque_bank,
    cheque_value_date: merged.cheque_value_date,
    txn_date: normalizeTxnDateColumn(merged.txn_date),
    status: "posted",
    maker_staff_id: params.editorStaffId,
    checker_staff_id: params.editorStaffId,
    approved_at: new Date().toISOString(),
    journal_batch_ref: null as string | null,
    corrects_txn_id: ex.id,
  };

  const { data: replacement, error: insErr } = await sb
    .from("sacco_teller_transactions")
    .insert(insertRow)
    .select("*")
    .single();
  if (insErr) {
    throwIfTellerDbError(insErr);
    throw insErr;
  }
  let replacementRow = replacement as SaccoTellerTransactionRow;

  try {
    await finalizePostedTellerTxnEffects({
      organizationId: params.organizationId,
      staffId: params.editorStaffId,
      txn: replacementRow,
    });
    const { data: refreshed } = await sb
      .from("sacco_teller_transactions")
      .select("*")
      .eq("id", replacementRow.id)
      .maybeSingle();
    if (refreshed) replacementRow = refreshed as SaccoTellerTransactionRow;
  } catch (e) {
    await sb.from("sacco_teller_transactions").delete().eq("id", replacementRow.id);
    throw e;
  }

  const newSnap = snapTxnForAudit(replacementRow);
  await insertSaccoTransactionEditAudit({
    organizationId: params.organizationId,
    originalTxnId: ex.id,
    replacementTxnId: replacementRow.id,
    editorStaffId: params.editorStaffId,
    editKind: "posted_correction",
    reason,
    oldValues: oldSnap,
    newValues: newSnap,
  });
  await appendTellerAuditLog({
    organizationId: params.organizationId,
    entityType: "sacco_teller_transactions",
    entityId: ex.id,
    action: "txn_corrected",
    actorStaffId: params.editorStaffId,
    detail: {
      reason,
      replacement_txn_id: replacementRow.id,
      old_values: oldSnap,
      new_values: newSnap,
    },
  });

  return { original: reversedRow, replacement: replacementRow };
}

/** Vault loses cash, till gains (posted). */
export async function transferCashFromVaultToTill(params: {
  organizationId: string;
  staffId: string;
  sessionId: string;
  amount: number;
  narration?: string | null;
}): Promise<{ vault: SaccoVaultMovementRow; txn: SaccoTellerTransactionRow }> {
  if (params.amount <= 0) throw new Error("Amount must be positive.");
  const { data: vRow, error: e1 } = await sb
    .from("sacco_vault_movements")
    .insert({
      organization_id: params.organizationId,
      session_id: params.sessionId,
      signed_vault_change: -params.amount,
      narration: params.narration ?? "Cash issued from vault to till",
      reference_code: "till_vault_in",
      created_by: params.staffId,
    })
    .select("*")
    .single();
  if (e1) {
    throwIfTellerDbError(e1);
    throw e1;
  }
  const txn = await createTellerTransaction({
    organizationId: params.organizationId,
    staffId: params.staffId,
    sessionId: params.sessionId,
    txnType: "till_vault_in",
    amount: params.amount,
    narration: params.narration ?? "Cash from vault to till",
    mode: "posted",
  });
  const vault = vRow as SaccoVaultMovementRow;
  await appendTellerAuditLog({
    organizationId: params.organizationId,
    entityType: "sacco_vault_movements",
    entityId: vault.id,
    action: "vault_to_till",
    actorStaffId: params.staffId,
    detail: { amount: params.amount, teller_txn_id: txn.id },
  });
  return { vault, txn };
}

/** Till loses cash, vault gains (posted). */
export async function transferCashFromTillToVault(params: {
  organizationId: string;
  staffId: string;
  sessionId: string;
  amount: number;
  narration?: string | null;
}): Promise<{ vault: SaccoVaultMovementRow; txn: SaccoTellerTransactionRow }> {
  if (params.amount <= 0) throw new Error("Amount must be positive.");
  const { data: vRow, error: e1 } = await sb
    .from("sacco_vault_movements")
    .insert({
      organization_id: params.organizationId,
      session_id: params.sessionId,
      signed_vault_change: params.amount,
      narration: params.narration ?? "Cash returned from till to vault",
      reference_code: "till_vault_out",
      created_by: params.staffId,
    })
    .select("*")
    .single();
  if (e1) {
    throwIfTellerDbError(e1);
    throw e1;
  }
  const txn = await createTellerTransaction({
    organizationId: params.organizationId,
    staffId: params.staffId,
    sessionId: params.sessionId,
    txnType: "till_vault_out",
    amount: params.amount,
    narration: params.narration ?? "Cash from till to vault",
    mode: "posted",
  });
  const vault = vRow as SaccoVaultMovementRow;
  await appendTellerAuditLog({
    organizationId: params.organizationId,
    entityType: "sacco_vault_movements",
    entityId: vault.id,
    action: "till_to_vault",
    actorStaffId: params.staffId,
    detail: { amount: params.amount, teller_txn_id: txn.id },
  });
  return { vault, txn };
}

export type TellerReportId =
  | "cash_position"
  | "daily_summary"
  | "cash_movement"
  | "over_short"
  | "audit_logs";

function fmtUgxReport(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `UGX ${Math.round(n).toLocaleString("en-UG")}`;
}

/** Tabular teller report for on-screen preview and PDF. */
export function buildTellerReportTable(
  reportId: TellerReportId,
  snap: TellerDashboardSnapshot,
  options?: {
    dailyTransactions?: SaccoTellerTransactionRow[];
    tillPositions?: TillPositionRow[];
    insuredLimitUgx?: number | null;
    reportDate?: string;
  }
): TellerReportTable {
  const reportDate = options?.reportDate ?? new Date().toISOString().slice(0, 10);
  const insured = options?.insuredLimitUgx ?? null;

  if (reportId === "cash_position") {
    const positions = options?.tillPositions ?? [];
    if (positions.length > 0) {
      return {
        title: "Teller cash position",
        subtitle: `Open tills as at ${reportDate}`,
        head: ["Teller", "Opened", "Float", "Est. cash on hand", "Receipts", "Payments", "Insured limit"],
        rows: positions.map((p) => [
          p.staff_full_name?.trim() || "Staff",
          new Date(p.opened_at).toLocaleString(),
          fmtUgxReport(p.opening_float),
          fmtUgxReport(p.tillEstimated),
          fmtUgxReport(p.sessionReceiptsTotal),
          fmtUgxReport(p.sessionPaymentsTotal),
          p.overInsuredLimit ? "OVER LIMIT" : insured ? "OK" : "—",
        ]),
        summaryLines: [
          `Insured limit per till: ${insured ? fmtUgxReport(insured) : "Not configured"}`,
          `Open tills: ${positions.length}`,
          `Over limit: ${positions.filter((p) => p.overInsuredLimit).length}`,
        ],
      };
    }
    return {
      title: "Teller cash position",
      subtitle: `Your till as at ${reportDate}`,
      head: ["Metric", "Value"],
      rows: [
        ["Estimated till cash", fmtUgxReport(snap.tillEstimated)],
        ["Vault position", fmtUgxReport(snap.vaultPosition)],
        ["Session open", snap.openSession ? "Yes" : "No"],
        ...(snap.openSession ? [["Opening float", fmtUgxReport(snap.openSession.opening_float)]] : []),
      ],
      summaryLines: [`Insured limit per till: ${insured ? fmtUgxReport(insured) : "Not configured"}`],
    };
  }

  if (reportId === "daily_summary") {
    const txns = options?.dailyTransactions ?? snap.recentTransactions;
    const totalIn = txns.reduce((s, t) => {
      const typ = String(t.txn_type);
      return typ === "cash_deposit" || typ === "cheque_received" || typ === "cheque_clearing"
        ? s + Number(t.amount)
        : s;
    }, 0);
    const totalOut = txns.reduce((s, t) => {
      const typ = String(t.txn_type);
      return typ === "cash_withdrawal" || typ === "cheque_paid" || typ === "till_vault_out"
        ? s + Number(t.amount)
        : s;
    }, 0);
    return {
      title: "Daily transactions summary",
      subtitle: `Posted teller transactions · ${reportDate}`,
      head: ["Time", "Type", "Member / ref", "Amount", "Status", "Narration"],
      rows: txns.map((t) => [
        new Date(t.created_at).toLocaleString(),
        String(t.txn_type),
        t.member_ref ?? "—",
        fmtUgxReport(t.amount),
        String(t.status),
        (t.narration ?? "").slice(0, 80),
      ]),
      summaryLines: [
        `Transactions: ${txns.length}`,
        `Total receipts: ${fmtUgxReport(totalIn)}`,
        `Total payments: ${fmtUgxReport(totalOut)}`,
        `Net: ${fmtUgxReport(totalIn - totalOut)}`,
      ],
    };
  }

  if (reportId === "cash_movement") {
    const rows: string[][] = [];
    for (const t of snap.recentTransactions) {
      rows.push(["Teller txn", new Date(t.created_at).toLocaleString(), fmtUgxReport(t.amount), t.narration ?? ""]);
    }
    for (const v of snap.recentVaultMoves) {
      rows.push([
        "Vault",
        new Date(v.created_at).toLocaleString(),
        fmtUgxReport(v.signed_vault_change),
        v.narration ?? "",
      ]);
    }
    return {
      title: "Cash movement report",
      subtitle: `Recent vault and till movements · ${reportDate}`,
      head: ["Kind", "Time", "Amount", "Note"],
      rows,
      summaryLines: [`Vault position: ${fmtUgxReport(snap.vaultPosition)}`],
    };
  }

  if (reportId === "over_short") {
    return {
      title: "Over / short report",
      subtitle: `Live till snapshot · ${reportDate}`,
      head: ["Metric", "Value"],
      rows: [
        ["Expected till (open session)", fmtUgxReport(snap.tillEstimated)],
        ["Note", "Historical over/short is recorded when a till is closed with a physical count."],
      ],
      summaryLines: [],
    };
  }

  return {
    title: "Teller audit log",
    subtitle: `Recent actions · ${reportDate}`,
    head: ["Time", "Action", "Entity", "Detail"],
    rows: snap.recentAudit.map((a) => [
      new Date(a.created_at).toLocaleString(),
      a.action,
      a.entity_type,
      JSON.stringify(a.detail ?? {}).slice(0, 120),
    ]),
    summaryLines: [],
  };
}

/** Client-side CSV export from current snapshot (no server report API yet). */
export function buildTellerReportCsv(
  reportId: TellerReportId,
  snap: TellerDashboardSnapshot,
  options?: Parameters<typeof buildTellerReportTable>[2]
): string {
  const table = buildTellerReportTable(reportId, snap, options);
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines: string[] = [table.head.map(esc).join(",")];
  for (const row of table.rows) {
    lines.push(row.map((c) => esc(String(c))).join(","));
  }
  if (table.summaryLines.length) {
    lines.push("");
    for (const s of table.summaryLines) lines.push(esc(s));
  }
  return lines.join("\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** One round-trip bundle for teller main screen (members, savings, GL, journal teller settings). */
export type TellerInitData = {
  members: TellerMemberPickRow[];
  savingsAccounts: TellerSavingsAccountPickRow[];
  glAccounts: TellerGlAccountPickRow[];
  tellerAllowPerTxnCounterpartyGl: boolean;
  tellerDefaultCounterpartyGlId: string | null;
};

export async function fetchTellerInitData(organizationId: string, isSuperAdmin: boolean): Promise<TellerInitData> {
  if (!isValidUuid(organizationId)) {
    return {
      members: [],
      savingsAccounts: [],
      glAccounts: [],
      tellerAllowPerTxnCounterpartyGl: true,
      tellerDefaultCounterpartyGlId: null,
    };
  }

  const [members, savingsAccounts, glAccounts, s] = await Promise.all([
    fetchTellerMemberPickList(organizationId),
    fetchTellerSavingsAccountPickList(organizationId),
    fetchTellerGlAccountPickList(organizationId, isSuperAdmin),
    fetchJournalGlSettings(organizationId).catch((e) => {
      warnTellerQuery("journal_gl_settings", e);
      return null;
    }),
  ]);

  return {
    members,
    savingsAccounts,
    glAccounts,
    tellerAllowPerTxnCounterpartyGl: s?.teller_allow_per_transaction_counterparty_gl ?? true,
    tellerDefaultCounterpartyGlId: s?.teller_default_counterparty_gl_id ?? null,
  };
}
