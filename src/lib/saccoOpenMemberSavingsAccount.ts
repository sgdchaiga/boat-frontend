/**
 * Open savings accounts for SACCO members (shared by manual open page + auto-open on registration).
 */
import { supabase } from "@/lib/supabase";
import { fetchSaccoAccountNumberSettings, suggestNextSavingsAccountNumber } from "@/lib/saccoAccountNumberSettings";
import { fetchSaccoBranches, pickDefaultBranchCode } from "@/lib/saccoBranches";
import { fetchSavingsProductTypes } from "@/lib/saccoSavingsProductTypes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type SaccoMemberForSavingsOpen = {
  id: string;
  member_number: string;
  full_name: string;
  created_at?: string;
  email?: string | null;
  phone?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  marital_status?: string | null;
  address?: string | null;
  occupation?: string | null;
  next_of_kin?: string | null;
  nok_phone?: string | null;
};

export type OpenSavingsAccountResult =
  | { status: "opened"; accountNumber: string; basicOnly: boolean }
  | { status: "failed"; message: string };

export type OpenFirstSavingsAccountResult =
  | { status: "opened"; accountNumber: string; productCode: string; branchCode: string | null }
  | { status: "skipped"; reason: string }
  | { status: "failed"; message: string };

export type SaccoSavingsBackfillProgress = {
  phaseLabel: string;
  processed: number;
  total: number;
  percent: number;
  currentMemberName?: string;
};

export type SaccoSavingsBackfillResult = {
  dryRun: boolean;
  totalMembers: number;
  alreadyHadAccount: number;
  opened: number;
  skipped: number;
  failed: number;
  errors: string[];
  openedAccounts: { memberNumber: string; fullName: string; accountNumber: string }[];
};

export type SaccoSavingsBackfillPreview = {
  totalMembers: number;
  alreadyHadAccount: number;
  needsAccount: number;
  productCode: string;
  branchCode: string | null;
};

async function resolveDefaultProductCode(organizationId: string): Promise<string> {
  const { rows } = await fetchSavingsProductTypes(organizationId);
  const active = rows.filter((r) => r.is_active);
  if (active.length > 0) return active[0].code.trim();
  const settings = await fetchSaccoAccountNumberSettings(organizationId);
  return (settings?.accountTypeValue ?? "1").trim() || "1";
}

async function resolveDefaultBranchCode(organizationId: string): Promise<string | null> {
  const { rows } = await fetchSaccoBranches(organizationId);
  if (rows.length === 0) {
    const settings = await fetchSaccoAccountNumberSettings(organizationId);
    return settings?.branchValue?.trim() || "1";
  }
  return pickDefaultBranchCode(rows, "1");
}

async function memberHasSavingsAccount(organizationId: string, memberId: string): Promise<boolean> {
  const { count, error } = await sb
    .from("sacco_member_savings_accounts")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("sacco_member_id", memberId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

function buildSavingsAccountInsertRow(
  organizationId: string,
  member: SaccoMemberForSavingsOpen,
  productCode: string,
  accountNumber: string,
  opts?: {
    branchCode?: string | null;
    subAccount?: string | null;
    dateAccountOpened?: string;
    postedByStaffId?: string | null;
    postedByName?: string | null;
  }
) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    organization_id: organizationId,
    sacco_member_id: member.id,
    savings_product_code: productCode,
    sub_account: opts?.subAccount?.trim() || null,
    account_number: accountNumber,
    branch_code: opts?.branchCode?.trim() || null,
    date_account_opened: opts?.dateAccountOpened?.trim() || today,
    client_no: member.member_number,
    client_full_name: member.full_name.trim(),
    gender: member.gender?.trim() || null,
    date_of_birth: member.date_of_birth ? String(member.date_of_birth).slice(0, 10) : null,
    marital_status: member.marital_status?.trim() || null,
    address: member.address?.trim() || null,
    telephone: member.phone?.trim() || null,
    email: member.email?.trim() || null,
    occupation: member.occupation?.trim() || null,
    next_of_kin: member.next_of_kin?.trim() || null,
    nok_phone: member.nok_phone?.trim() || null,
    posted_by_staff_id: opts?.postedByStaffId ?? null,
    posted_by_name: opts?.postedByName ?? null,
    balance: 0,
    is_active: true,
  };
}

async function insertSavingsAccountRow(row: ReturnType<typeof buildSavingsAccountInsertRow>): Promise<{ basicOnly: boolean }> {
  let { error } = await sb.from("sacco_member_savings_accounts").insert(row);
  if (!error) return { basicOnly: false };
  const msg = `${error.message ?? ""} ${(error as { details?: string }).details ?? ""}`;
  const missingCol = /column|does not exist|42703|schema cache|PGRST204/i.test(msg);
  if (!missingCol) throw error;
  console.warn(
    "[SACCO] sacco_member_savings_accounts extended columns missing — run migrations. Inserting minimal row."
  );
  const minimal = {
    organization_id: row.organization_id,
    sacco_member_id: row.sacco_member_id,
    savings_product_code: row.savings_product_code,
    account_number: row.account_number,
    balance: 0,
    is_active: true,
  };
  const retry = await sb.from("sacco_member_savings_accounts").insert(minimal);
  if (retry.error) throw retry.error;
  return { basicOnly: true };
}

/** Opens a savings account with explicit product, branch, and account number (manual open page). */
export async function openSavingsAccountForMember(params: {
  organizationId: string;
  member: SaccoMemberForSavingsOpen;
  productCode: string;
  accountNumber: string;
  branchCode?: string | null;
  subAccount?: string | null;
  dateAccountOpened?: string;
  postedByStaffId?: string | null;
  postedByName?: string | null;
}): Promise<OpenSavingsAccountResult> {
  const {
    organizationId,
    member,
    productCode,
    accountNumber,
    branchCode,
    subAccount,
    dateAccountOpened,
    postedByStaffId,
    postedByName,
  } = params;
  try {
    const row = buildSavingsAccountInsertRow(organizationId, member, productCode.trim(), accountNumber.trim(), {
      branchCode,
      subAccount,
      dateAccountOpened,
      postedByStaffId,
      postedByName,
    });
    const { basicOnly } = await insertSavingsAccountRow(row);
    return { status: "opened", accountNumber: accountNumber.trim(), basicOnly };
  } catch (e) {
    return { status: "failed", message: e instanceof Error ? e.message : "Could not open savings account." };
  }
}

/**
 * Opens the member's first savings account using the default product & branch. Skips if one already exists.
 */
export async function openFirstSavingsAccountForMember(params: {
  organizationId: string;
  member: SaccoMemberForSavingsOpen;
  postedByStaffId?: string | null;
  postedByName?: string | null;
  /** Skip re-fetching defaults when bulk backfilling. */
  defaults?: { productCode: string; branchCode: string | null };
}): Promise<OpenFirstSavingsAccountResult> {
  const { organizationId, member, postedByStaffId, postedByName, defaults } = params;
  try {
    if (await memberHasSavingsAccount(organizationId, member.id)) {
      return { status: "skipped", reason: "Member already has a savings account." };
    }

    const productCode = defaults?.productCode ?? (await resolveDefaultProductCode(organizationId));
    const branchCode =
      defaults !== undefined ? defaults.branchCode : await resolveDefaultBranchCode(organizationId);
    const accountNumber = await suggestNextSavingsAccountNumber(
      organizationId,
      productCode,
      branchCode ?? undefined
    );

    const result = await openSavingsAccountForMember({
      organizationId,
      member,
      productCode,
      accountNumber,
      branchCode,
      postedByStaffId,
      postedByName,
    });

    if (result.status === "failed") {
      return { status: "failed", message: result.message };
    }
    return { status: "opened", accountNumber: result.accountNumber, productCode, branchCode };
  } catch (e) {
    return { status: "failed", message: e instanceof Error ? e.message : "Could not open savings account." };
  }
}

/** Numeric key for member_number (1, 2, 10 — not lexicographic "10" before "2"). */
export function memberNumberSortKey(memberNumber: string): number {
  const t = String(memberNumber ?? "").trim();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  const legacy = t.match(/(\d+)\s*$/);
  if (legacy) return parseInt(legacy[1]!, 10);
  return Number.MAX_SAFE_INTEGER;
}

/** Oldest / lowest member id first — matches register order for sequential account serials. */
export function compareMembersForBackfillOrder(
  a: SaccoMemberForSavingsOpen,
  b: SaccoMemberForSavingsOpen
): number {
  const na = memberNumberSortKey(a.member_number);
  const nb = memberNumberSortKey(b.member_number);
  if (na !== nb) return na - nb;
  const ta = a.created_at ? Date.parse(a.created_at) : 0;
  const tb = b.created_at ? Date.parse(b.created_at) : 0;
  if (ta !== tb) return ta - tb;
  return a.id.localeCompare(b.id);
}

function sortMembersForBackfill(members: SaccoMemberForSavingsOpen[]): SaccoMemberForSavingsOpen[] {
  return [...members].sort(compareMembersForBackfillOrder);
}

async function fetchMembersForBackfill(
  organizationId: string,
  activeOnly: boolean
): Promise<SaccoMemberForSavingsOpen[]> {
  let q = sb.from("sacco_members").select("*").eq("organization_id", organizationId);
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return sortMembersForBackfill((data ?? []) as SaccoMemberForSavingsOpen[]);
}

async function fetchMemberIdsWithSavingsAccounts(organizationId: string): Promise<Set<string>> {
  const { data, error } = await sb
    .from("sacco_member_savings_accounts")
    .select("sacco_member_id")
    .eq("organization_id", organizationId);
  if (error) throw error;
  return new Set((data ?? []).map((r: { sacco_member_id: string }) => r.sacco_member_id));
}

/** Count members who need a first savings account (for UI preview). */
export async function getSaccoSavingsBackfillPreview(
  organizationId: string,
  opts?: { activeOnly?: boolean }
): Promise<SaccoSavingsBackfillPreview> {
  const activeOnly = opts?.activeOnly !== false;
  const [members, withAccount] = await Promise.all([
    fetchMembersForBackfill(organizationId, activeOnly),
    fetchMemberIdsWithSavingsAccounts(organizationId),
  ]);
  const [productCode, branchCode] = await Promise.all([
    resolveDefaultProductCode(organizationId),
    resolveDefaultBranchCode(organizationId),
  ]);
  const alreadyHadAccount = members.filter((m) => withAccount.has(m.id)).length;
  return {
    totalMembers: members.length,
    alreadyHadAccount,
    needsAccount: members.length - alreadyHadAccount,
    productCode,
    branchCode,
  };
}

/**
 * Opens the first savings account for every member who does not have one yet.
 * Processes members sequentially so account numbers stay unique.
 */
export async function backfillSaccoMemberSavingsAccounts(options: {
  organizationId: string;
  dryRun?: boolean;
  activeOnly?: boolean;
  postedByStaffId?: string | null;
  postedByName?: string | null;
  onProgress?: (progress: SaccoSavingsBackfillProgress) => void;
}): Promise<SaccoSavingsBackfillResult> {
  const {
    organizationId,
    dryRun = false,
    activeOnly = true,
    postedByStaffId,
    postedByName,
    onProgress,
  } = options;

  const members = await fetchMembersForBackfill(organizationId, activeOnly);
  const withAccount = await fetchMemberIdsWithSavingsAccounts(organizationId);
  const toProcess = sortMembersForBackfill(members.filter((m) => !withAccount.has(m.id)));
  const alreadyHadAccount = members.length - toProcess.length;

  const productCode = await resolveDefaultProductCode(organizationId);
  const branchCode = await resolveDefaultBranchCode(organizationId);
  const defaults = { productCode, branchCode };

  const result: SaccoSavingsBackfillResult = {
    dryRun,
    totalMembers: members.length,
    alreadyHadAccount,
    opened: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    openedAccounts: [],
  };

  const total = toProcess.length;
  onProgress?.({
    phaseLabel: dryRun ? "Previewing members…" : "Opening savings accounts…",
    processed: 0,
    total,
    percent: total === 0 ? 100 : 0,
  });

  if (dryRun) {
    result.opened = total;
    onProgress?.({
      phaseLabel: "Dry run complete",
      processed: total,
      total,
      percent: 100,
    });
    return result;
  }

  for (let i = 0; i < toProcess.length; i++) {
    const member = toProcess[i]!;
    onProgress?.({
      phaseLabel: `Opening account for ${member.full_name}`,
      processed: i,
      total,
      percent: total === 0 ? 100 : Math.round((i / total) * 100),
      currentMemberName: member.full_name,
    });

    const openResult = await openFirstSavingsAccountForMember({
      organizationId,
      member,
      postedByStaffId,
      postedByName,
      defaults,
    });

    if (openResult.status === "opened") {
      result.opened += 1;
      result.openedAccounts.push({
        memberNumber: member.member_number,
        fullName: member.full_name,
        accountNumber: openResult.accountNumber,
      });
    } else if (openResult.status === "skipped") {
      result.skipped += 1;
    } else {
      result.failed += 1;
      result.errors.push(`${member.member_number} ${member.full_name}: ${openResult.message}`);
    }
  }

  onProgress?.({
    phaseLabel: "Backfill complete",
    processed: total,
    total,
    percent: 100,
  });

  return result;
}

/** Remove every savings account for an organization (members are kept). Teller rows keep history but lose account link. */
export async function clearAllSaccoMemberSavingsAccounts(organizationId: string): Promise<{ deleted: number }> {
  const { count, error: countError } = await sb
    .from("sacco_member_savings_accounts")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  if (countError) throw countError;

  const { error } = await sb.from("sacco_member_savings_accounts").delete().eq("organization_id", organizationId);
  if (error) throw error;

  return { deleted: count ?? 0 };
}
