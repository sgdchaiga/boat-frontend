/**
 * Teller data access — sessions, transactions, vault movements, audit.
 * Requires migration `20260426120007_sacco_teller.sql`.
 */
import { createJournalEntry, getDefaultGlAccounts } from "@/lib/journal";
import { supabase } from "@/lib/supabase";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { businessTodayISO } from "@/lib/timezone";

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
  | "shares"
  | "loan_repayment"
  | "fee_or_penalty"
  | "other";

export const TELLER_POSTING_PURPOSE_LABELS: Record<TellerPostingPurpose, string> = {
  savings: "Savings (select account)",
  membership_fee: "Membership fee",
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
  created_at: string;
  updated_at: string;
};

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

/** Active GL accounts for teller counterparty selection (cash deposit / withdrawal). */
export async function fetchTellerGlAccountPickList(
  organizationId: string,
  isSuperAdmin?: boolean
): Promise<TellerGlAccountPickRow[]> {
  const { data, error } = await filterByOrganizationId(
    sb.from("gl_accounts").select("id, account_code, account_name").eq("is_active", true).order("account_code"),
    organizationId,
    isSuperAdmin
  );
  if (error) throw error;
  return (data ?? []) as TellerGlAccountPickRow[];
}

function isMissingTellerSchemaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; status?: number };
  if (e.status === 404) return true;
  const m = String(e.message ?? "").toLowerCase();
  return m.includes("does not exist") || m.includes("schema cache") || m.includes("could not find the table");
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

export async function fetchTellerDashboardSnapshot(
  organizationId: string,
  staffId: string | undefined
): Promise<TellerDashboardSnapshot> {
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

  try {
    const pOpenSession = staffId
      ? sb
          .from("sacco_teller_sessions")
          .select("*")
          .eq("organization_id", organizationId)
          .eq("staff_id", staffId)
          .eq("status", "open")
          .maybeSingle()
      : Promise.resolve({ data: null, error: null as Error | null });

    const pPendingCount = sb
      .from("sacco_teller_transactions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "pending_approval");

    const pPendingRows = sb
      .from("sacco_teller_transactions")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("status", "pending_approval")
      .order("created_at", { ascending: true })
      .limit(50);

    const pVaultChanges = sb
      .from("sacco_vault_movements")
      .select("signed_vault_change")
      .eq("organization_id", organizationId);

    const pRecentTx = sb
      .from("sacco_teller_transactions")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(25);

    const pVaultMoves = sb
      .from("sacco_vault_movements")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(15);

    const pAudit = sb
      .from("sacco_teller_audit_log")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(20);

    const [sessRes, pcRes, prRes, vchRes, rtxRes, vmRes, auRes] = await Promise.all([
      pOpenSession,
      pPendingCount,
      pPendingRows,
      pVaultChanges,
      pRecentTx,
      pVaultMoves,
      pAudit,
    ]);

    for (const r of [sessRes, pcRes, prRes, vchRes, rtxRes, vmRes, auRes]) {
      if (r.error) throw r.error;
    }

    const openSession = (sessRes.data ?? null) as SaccoTellerSessionRow | null;
    const pending = pcRes.count ?? 0;
    const pendingRows = prRes.data;
    const vaultRows = vchRes.data;
    const vaultPosition = (vaultRows ?? []).reduce((s: number, r: { signed_vault_change: number }) => s + Number(r.signed_vault_change), 0);
    const txList = rtxRes.data;
    const vmList = vmRes.data;
    const auditList = auRes.data;

    let tillEstimated: number | null = null;
    let sessionReceiptsTotal = 0;
    let sessionPaymentsTotal = 0;
    if (openSession) {
      const { data: sessTx, error: e7 } = await sb
        .from("sacco_teller_transactions")
        .select("txn_type, amount")
        .eq("session_id", openSession.id)
        .eq("status", "posted");
      if (e7) throw e7;
      let bal = Number(openSession.opening_float);
      for (const t of sessTx ?? []) {
        const amt = Number((t as { amount: number }).amount);
        const typ = (t as { txn_type: string }).txn_type;
        if (typ === "cash_deposit" || typ === "cheque_received") {
          bal += amt;
          sessionReceiptsTotal += amt;
        } else if (typ === "cash_withdrawal" || typ === "cheque_paid") {
          bal -= amt;
          sessionPaymentsTotal += amt;
        } else if (typ === "cheque_clearing") {
          bal += amt;
          sessionReceiptsTotal += amt;
        } else if (typ === "adjustment") {
          bal += amt;
        } else if (typ === "till_vault_in") {
          bal += amt;
        } else if (typ === "till_vault_out") {
          bal -= amt;
        }
      }
      tillEstimated = bal;
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
  } catch (err) {
    if (isMissingTellerSchemaError(err)) {
      console.warn("[SACCO] Teller tables missing — run migration 20260426120007_sacco_teller.sql");
      return { ...empty, schemaMissing: true };
    }
    throw err;
  }
}

export async function fetchTellerMemberPickList(organizationId: string): Promise<TellerMemberPickRow[]> {
  const { data, error } = await sb
    .from("sacco_members")
    .select("id, member_number, full_name")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("member_number");
  if (error) {
    if (isMissingTellerSchemaError(error)) return [];
    throw error;
  }
  return (data ?? []) as TellerMemberPickRow[];
}

export async function fetchTellerSavingsAccountPickList(organizationId: string): Promise<TellerSavingsAccountPickRow[]> {
  const { data: accs, error: e1 } = await sb
    .from("sacco_member_savings_accounts")
    .select("id, account_number, savings_product_code, balance, sacco_member_id")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("account_number");
  if (e1) {
    if (isMissingTellerSchemaError(e1)) return [];
    throw e1;
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
    throw e2;
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
async function applyPostedTellerTxnToSavingsAccountBalance(params: {
  organizationId: string;
  txn: SaccoTellerTransactionRow;
}): Promise<void> {
  const acctId = params.txn.sacco_member_savings_account_id;
  if (!acctId) return;
  const delta = tellerDeltaForSavingsAccountBalance(String(params.txn.txn_type), Number(params.txn.amount));
  if (delta === null || delta === 0) return;

  const { data: acct, error: e1 } = await sb
    .from("sacco_member_savings_accounts")
    .select("balance")
    .eq("id", acctId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (e1) {
    if (isMissingTellerSchemaError(e1)) return;
    throw e1;
  }
  if (!acct) return;
  const prev = Number((acct as { balance: unknown }).balance ?? 0);
  const next = Math.max(0, prev + delta);
  const { error: e2 } = await sb
    .from("sacco_member_savings_accounts")
    .update({ balance: next })
    .eq("id", acctId)
    .eq("organization_id", params.organizationId);
  if (e2) {
    throwIfTellerDbError(e2);
    throw e2;
  }
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
    entry_date: businessTodayISO(),
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
    entry_date: businessTodayISO(),
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

export async function openTellerSession(params: {
  organizationId: string;
  staffId: string;
  openingFloat: number;
  notes?: string | null;
}): Promise<SaccoTellerSessionRow> {
  const { data, error } = await sb
    .from("sacco_teller_sessions")
    .insert({
      organization_id: params.organizationId,
      staff_id: params.staffId,
      opening_float: params.openingFloat,
      status: "open",
      notes: params.notes ?? null,
    })
    .select("*")
    .single();
  if (error) {
    if (isMissingTellerSchemaError(error)) {
      throw new Error(
        "Teller tables are not installed. Run migration 20260426120007_sacco_teller.sql (and 20260426120008 for vault transfer types)."
      );
    }
    const msg = String((error as { message?: string }).message ?? "");
    if (msg.includes("unique") || msg.includes("duplicate") || (error as { code?: string }).code === "23505") {
      throw new Error("You already have an open till session. Close it before opening another.");
    }
    throw error;
  }
  const row = data as SaccoTellerSessionRow;
  await appendTellerAuditLog({
    organizationId: params.organizationId,
    entityType: "sacco_teller_sessions",
    entityId: row.id,
    action: "session_open",
    actorStaffId: params.staffId,
    detail: { opening_float: params.openingFloat },
  });
  return row;
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
  mode: "posted" | "pending_approval";
  journalBatchRef?: string | null;
}): Promise<SaccoTellerTransactionRow> {
  const status = params.mode === "posted" ? "posted" : "pending_approval";
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

/** Client-side CSV export from current snapshot (no server report API yet). */
export function buildTellerReportCsv(reportId: TellerReportId, snap: TellerDashboardSnapshot): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines: string[] = [];
  if (reportId === "cash_position") {
    lines.push(["metric", "value"].join(","));
    lines.push(["till_estimated_ugx", snap.tillEstimated ?? ""].join(","));
    lines.push(["vault_position_ugx", snap.vaultPosition].join(","));
    lines.push(["session_open", snap.openSession ? "yes" : "no"].join(","));
    if (snap.openSession) {
      lines.push(["opening_float_ugx", snap.openSession.opening_float].join(","));
    }
    return lines.join("\n");
  }
  if (reportId === "daily_summary") {
    lines.push(
      [
        "created_at",
        "txn_type",
        "posting_purpose",
        "savings_account_id",
        "counterparty_gl_account_id",
        "member_ref",
        "amount",
        "status",
        "journal_batch_ref",
        "narration",
      ]
        .map(esc)
        .join(",")
    );
    for (const t of snap.recentTransactions) {
      lines.push(
        [
          t.created_at,
          t.txn_type,
          t.posting_purpose ?? "",
          t.sacco_member_savings_account_id ?? "",
          t.counterparty_gl_account_id ?? "",
          t.member_ref ?? "",
          t.amount,
          t.status,
          t.journal_batch_ref ?? "",
          t.narration ?? "",
        ]
          .map((x) => esc(String(x)))
          .join(",")
      );
    }
    return lines.join("\n");
  }
  if (reportId === "cash_movement") {
    lines.push(["kind", "created_at", "amount_or_delta", "note"].map(esc).join(","));
    for (const t of snap.recentTransactions) {
      lines.push(["teller_txn", t.created_at, t.amount, t.narration ?? ""].map((x) => esc(String(x))).join(","));
    }
    for (const v of snap.recentVaultMoves) {
      lines.push(["vault", v.created_at, v.signed_vault_change, v.narration ?? ""].map((x) => esc(String(x))).join(","));
    }
    return lines.join("\n");
  }
  if (reportId === "over_short") {
    lines.push(["metric", "value"].join(","));
    lines.push(["note", "Use closed sessions in DB for historical variance; UI snapshot is live only"].map(esc).join(","));
    if (snap.openSession) {
      lines.push(["expected_till_ugx", snap.tillEstimated ?? ""].join(","));
    }
    return lines.join("\n");
  }
  lines.push(["created_at", "action", "entity_type", "entity_id", "detail_json"].map(esc).join(","));
  for (const a of snap.recentAudit) {
    lines.push(
      [a.created_at, a.action, a.entity_type, a.entity_id ?? "", JSON.stringify(a.detail ?? {})]
        .map((x) => esc(String(x)))
        .join(",")
    );
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
