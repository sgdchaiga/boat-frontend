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
}): Promise<OpenFirstSavingsAccountResult> {
  const { organizationId, member, postedByStaffId, postedByName } = params;
  try {
    if (await memberHasSavingsAccount(organizationId, member.id)) {
      return { status: "skipped", reason: "Member already has a savings account." };
    }

    const productCode = await resolveDefaultProductCode(organizationId);
    const branchCode = await resolveDefaultBranchCode(organizationId);
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
