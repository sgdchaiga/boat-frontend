/**
 * Maps Supabase SACCO tables ↔ AppContext workspace types.
 * Table names: sacco_loans, sacco_loan_products, sacco_fixed_deposits, sacco_cashbook_entries,
 * sacco_fixed_assets, sacco_provisioning_settings; members from sacco_members.
 */
import { supabase } from "@/lib/supabase";
import type {
  CashbookEntry,
  FixedAsset,
  FixedDeposit,
  Loan,
  LoanFees,
  LoanProduct,
  LoanStatus,
  Member,
  ProvisioningConfig,
  ProvisionRate,
  SaccoLoanModificationType,
  SaccoLoanPolicy,
} from "@/types/saccoWorkspace";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/** PostgREST rejects inserts with keys that are not in the table (migration not applied yet). */
function isUnknownColumnError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "PGRST204") return true;
  const m = err.message ?? "";
  return m.includes("Could not find") && m.includes("column");
}

type DbLoan = {
  id: string;
  sacco_member_id: string;
  member_name: string;
  loan_type: string;
  amount: number;
  balance: number;
  paid_amount: number;
  status: string;
  interest_rate: number;
  term_months: number;
  monthly_payment: number;
  approval_stage: number;
  purpose: string;
  guarantors: unknown;
  application_date: string;
  interest_basis: string;
  disbursement_date: string | null;
  fees: unknown | null;
  collateral_description?: string | null;
  lc1_chairman_name?: string | null;
  lc1_chairman_phone?: string | null;
  last_payment_date?: string | null;
  written_off_remaining?: number | null;
  written_off_total?: number | null;
  written_off_at?: string | null;
};

type DbProduct = {
  id: string;
  name: string;
  interest_rate: number;
  max_term_months: number;
  min_amount: number;
  max_amount: number;
  interest_basis: string;
  fees: unknown;
  compulsory_savings_rate: number;
  minimum_shares: number;
  is_active: boolean;
  sort_order: number;
};

export function mapLoanFromRow(row: DbLoan): Loan {
  const g = row.guarantors;
  const guarantors = Array.isArray(g) ? (g as string[]) : [];
  const feesRaw = row.fees as Loan["fees"] | null | undefined;
  return {
    id: row.id,
    memberId: row.sacco_member_id,
    memberName: row.member_name,
    loanType: row.loan_type,
    amount: Number(row.amount),
    balance: Number(row.balance),
    paidAmount: Number(row.paid_amount),
    status: row.status as LoanStatus,
    interestRate: Number(row.interest_rate),
    term: Number(row.term_months),
    monthlyPayment: Number(row.monthly_payment),
    approvalStage: Number(row.approval_stage),
    purpose: row.purpose ?? "",
    guarantors,
    applicationDate: String(row.application_date).slice(0, 10),
    interestBasis: row.interest_basis as "flat" | "declining",
    disbursementDate: row.disbursement_date ? String(row.disbursement_date).slice(0, 10) : undefined,
    collateralDescription: row.collateral_description?.trim() || undefined,
    lc1ChairmanName: row.lc1_chairman_name?.trim() || undefined,
    lc1ChairmanPhone: row.lc1_chairman_phone?.trim() || undefined,
    lastPaymentDate: row.last_payment_date ? String(row.last_payment_date).slice(0, 10) : undefined,
    writtenOffTotal:
      row.written_off_total !== undefined && row.written_off_total !== null
        ? Number(row.written_off_total)
        : undefined,
    writtenOffRemaining:
      row.written_off_remaining !== undefined && row.written_off_remaining !== null
        ? Number(row.written_off_remaining)
        : undefined,
    writtenOffAt: row.written_off_at ? String(row.written_off_at).slice(0, 10) : undefined,
    fees: feesRaw ?? undefined,
  };
}

export function mapProductFromRow(row: DbProduct): LoanProduct {
  const raw = row.fees as Partial<LoanFees> | null | undefined;
  const fees: LoanFees = {
    formFee: Number(raw?.formFee ?? 0),
    monitoringFee: Number(raw?.monitoringFee ?? 0),
    processingFeeRate: Number(raw?.processingFeeRate ?? 0),
    insuranceFeeRate: Number(raw?.insuranceFeeRate ?? 0),
    applicationFeeRate: Number(raw?.applicationFeeRate ?? 0),
  };
  return {
    id: row.id,
    name: row.name,
    interestRate: Number(row.interest_rate),
    maxTerm: Number(row.max_term_months),
    minAmount: Number(row.min_amount),
    maxAmount: Number(row.max_amount),
    interestBasis: row.interest_basis as "flat" | "declining",
    fees,
    compulsorySavingsRate: Number(row.compulsory_savings_rate),
    minimumShares: Number(row.minimum_shares),
    isActive: row.is_active,
  };
}

export function mapMemberFromRow(row: {
  id: string;
  full_name: string;
  member_number: string;
  is_active: boolean;
  phone?: string | null;
  savings_balance?: number | null;
  shares_balance?: number | null;
  join_date?: string | null;
  created_at?: string;
}): Member {
  const jd =
    row.join_date?.slice(0, 10) ??
    (row.created_at ? String(row.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10));
  return {
    id: row.id,
    name: row.full_name,
    accountNumber: row.member_number,
    status: row.is_active ? "active" : "inactive",
    savingsBalance: Number(row.savings_balance ?? 0),
    sharesBalance: Number(row.shares_balance ?? 0),
    joinDate: jd,
    phone: row.phone?.trim() || undefined,
  };
}

function mapFdFromRow(row: {
  id: string;
  sacco_member_id: string;
  member_name: string;
  amount: number;
  interest_rate: number;
  term_months: number;
  start_date: string;
  maturity_date: string;
  interest_earned: number;
  auto_renew: boolean;
  status: string;
}): FixedDeposit {
  return {
    id: row.id,
    memberId: row.sacco_member_id,
    memberName: row.member_name,
    amount: Number(row.amount),
    interestRate: Number(row.interest_rate),
    term: Number(row.term_months),
    startDate: String(row.start_date).slice(0, 10),
    maturityDate: String(row.maturity_date).slice(0, 10),
    interestEarned: Number(row.interest_earned),
    autoRenew: row.auto_renew,
    status: row.status,
  };
}

function mapCbFromRow(row: {
  id: string;
  entry_date: string;
  description: string;
  reference: string | null;
  category: string | null;
  sacco_member_id: string | null;
  member_name: string | null;
  debit: number;
  credit: number;
  balance: number;
}): CashbookEntry {
  return {
    id: row.id,
    date: String(row.entry_date).slice(0, 10),
    description: row.description,
    reference: row.reference ?? undefined,
    category: row.category ?? undefined,
    memberId: row.sacco_member_id ?? undefined,
    memberName: row.member_name ?? undefined,
    debit: Number(row.debit),
    credit: Number(row.credit),
    balance: Number(row.balance),
  };
}

/** Product codes that count toward “shares” on loan eligibility (balances summed from savings accounts). */
function isShareCapitalProductCode(code: string | null | undefined): boolean {
  const c = (code ?? "").trim().toUpperCase();
  if (!c) return false;
  return c.includes("SHARE") || c === "EQUITY" || c.startsWith("SHR");
}

function parseAmount(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function mapFaFromRow(row: { id: string; name: string; status: string; current_value: number }): FixedAsset {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    currentValue: Number(row.current_value),
  };
}

const DEFAULT_LOAN_POLICY: SaccoLoanPolicy = { minSavingsDaysBeforeLoan: 30 };

export async function fetchSaccoLoanPolicies(organizationId: string): Promise<SaccoLoanPolicy> {
  const polRes = await sb.from("sacco_org_loan_policies").select("*").eq("organization_id", organizationId).maybeSingle();
  if (polRes.error) {
    if (polRes.error.code !== "PGRST116" && !String(polRes.error.message ?? "").includes("does not exist"))
      console.warn("[SACCO] loan policies:", polRes.error.message ?? polRes.error);
    return DEFAULT_LOAN_POLICY;
  }
  const row = polRes.data as { min_savings_days_before_loan?: unknown } | null;
  const raw = row?.min_savings_days_before_loan;
  if (raw === undefined || raw === null) return DEFAULT_LOAN_POLICY;
  const n = Number(raw);
  return { minSavingsDaysBeforeLoan: Number.isFinite(n) ? Math.max(0, Math.round(n)) : DEFAULT_LOAN_POLICY.minSavingsDaysBeforeLoan };
}

export async function upsertSaccoLoanPolicies(organizationId: string, policy: SaccoLoanPolicy): Promise<void> {
  const min = Math.max(0, Math.round(policy.minSavingsDaysBeforeLoan ?? 30));
  const { error } = await sb.from("sacco_org_loan_policies").upsert(
    { organization_id: organizationId, min_savings_days_before_loan: min },
    { onConflict: "organization_id" }
  );
  if (error) throw error;
}

export async function fetchSaccoWorkspaceData(organizationId: string): Promise<{
  members: Member[];
  loans: Loan[];
  loanProducts: LoanProduct[];
  fixedDeposits: FixedDeposit[];
  cashbook: CashbookEntry[];
  fixedAssets: FixedAsset[];
  provisioning: ProvisioningConfig | null;
  saccoLoanPolicies: SaccoLoanPolicy;
}> {
  const [
    memRes,
    loanRes,
    prodRes,
    fdRes,
    cbRes,
    faRes,
    provRes,
    polRes,
    savResFull,
  ] = await Promise.all([
    sb.from("sacco_members").select("*").eq("organization_id", organizationId).order("member_number"),
    sb.from("sacco_loans").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    sb
      .from("sacco_loan_products")
      .select("*")
      .eq("organization_id", organizationId)
      .order("sort_order", { ascending: true }),
    sb.from("sacco_fixed_deposits").select("*").eq("organization_id", organizationId).order("start_date", { ascending: false }),
    sb.from("sacco_cashbook_entries").select("*").eq("organization_id", organizationId).order("entry_date", { ascending: true }),
    sb.from("sacco_fixed_assets").select("*").eq("organization_id", organizationId).order("name"),
    sb.from("sacco_provisioning_settings").select("*").eq("organization_id", organizationId).maybeSingle(),
    sb.from("sacco_org_loan_policies").select("*").eq("organization_id", organizationId).maybeSingle(),
    sb
      .from("sacco_member_savings_accounts")
      .select(
        "sacco_member_id, balance, savings_product_code, created_at, date_account_opened"
      )
      .eq("organization_id", organizationId),
  ]);

  const err =
    memRes.error ||
    loanRes.error ||
    prodRes.error ||
    fdRes.error ||
    cbRes.error ||
    faRes.error ||
    provRes.error;
  if (err) throw err;

  let saccoLoanPolicies = DEFAULT_LOAN_POLICY;
  const polRow = !polRes.error ? (polRes.data as { min_savings_days_before_loan?: unknown } | null) : null;
  const md = polRow?.min_savings_days_before_loan;
  if (!polRes.error && md !== undefined && md !== null) {
    const n = Number(md);
    if (Number.isFinite(n)) saccoLoanPolicies = { minSavingsDaysBeforeLoan: Math.max(0, Math.round(n)) };
  } else if (
    polRes.error &&
    polRes.error.code !== "PGRST116" &&
    !String(polRes.error.message ?? "").includes("does not exist")
  ) {
    console.warn("[SACCO] Loan policies table:", polRes.error.message ?? polRes.error);
  }

  let savingsByMember = new Map<string, number>();
  let sharesByMember = new Map<string, number>();
  let firstOrdinaryOpenByMember = new Map<string, string>();
  type SavRow = {
    sacco_member_id: string;
    balance: unknown;
    savings_product_code: string;
    created_at?: string | null;
    date_account_opened?: string | null;
  };
  const savData = savResFull.data as SavRow[] | null | undefined;
  if (savResFull.error) {
    console.warn(
      "[SACCO] Could not load sacco_member_savings_accounts for balance rollup:",
      savResFull.error.message ?? savResFull.error
    );
  } else if (savData) {
    for (const row of savData) {
      const id = row.sacco_member_id;
      const b = parseAmount(row.balance);
      if (isShareCapitalProductCode(row.savings_product_code)) {
        sharesByMember.set(id, (sharesByMember.get(id) ?? 0) + b);
      } else {
        savingsByMember.set(id, (savingsByMember.get(id) ?? 0) + b);
        const openIso =
          row.date_account_opened != null && String(row.date_account_opened).trim()
            ? String(row.date_account_opened).slice(0, 10)
            : row.created_at
              ? String(row.created_at).slice(0, 10)
              : null;
        if (openIso) {
          const prev = firstOrdinaryOpenByMember.get(id);
          if (!prev || openIso < prev) firstOrdinaryOpenByMember.set(id, openIso);
        }
      }
    }
  }

  const members = (memRes.data ?? []).map((r) => {
    const m = mapMemberFromRow(r as Parameters<typeof mapMemberFromRow>[0]);
    const id = (r as { id: string }).id;
    const colSav = Number((r as { savings_balance?: number | null }).savings_balance ?? 0);
    const colShr = Number((r as { shares_balance?: number | null }).shares_balance ?? 0);
    const sumSav = savingsByMember.get(id);
    const sumShr = sharesByMember.get(id);
    const hasRollup = savingsByMember.has(id) || sharesByMember.has(id);
    if (hasRollup) {
      // Do not wipe member-level balances when account rows exist but balances are still 0 (e.g. before teller sync).
      // Take the higher of rolled-up accounts vs register columns.
      m.savingsBalance = Math.max(sumSav ?? 0, colSav);
      m.sharesBalance = Math.max(sumShr ?? 0, colShr);
    }
    const fs = firstOrdinaryOpenByMember.get(id);
    if (fs) m.firstOrdinarySavingsOpenedAt = fs;
    return m;
  });
  const loans = (loanRes.data ?? []).map((r: DbLoan) => mapLoanFromRow(r));
  const loanProducts = (prodRes.data ?? []).map((r: DbProduct) => mapProductFromRow(r));
  const fixedDeposits = (fdRes.data ?? []).map(mapFdFromRow);
  const cashbook = (cbRes.data ?? []).map(mapCbFromRow);
  const fixedAssets = (faRes.data ?? []).map(mapFaFromRow);

  let provisioning: ProvisioningConfig | null = null;
  const pr = provRes.data;
  if (pr) {
    const rates = Array.isArray(pr.rates) ? (pr.rates as ProvisionRate[]) : [];
    provisioning = {
      provisionChoice: pr.provision_choice === "old" ? "old" : "new",
      generalProvisionOld: Number(pr.general_provision_old),
      generalProvisionNew: Number(pr.general_provision_new),
      rates,
    };
  }

  return {
    members,
    loans,
    loanProducts,
    fixedDeposits,
    cashbook,
    fixedAssets,
    provisioning,
    saccoLoanPolicies,
  };
}

export async function insertSaccoLoanModification(payload: {
  sacco_loan_id: string;
  modification_type: SaccoLoanModificationType;
  effective_date?: string;
  notes?: string | null;
  previous_term_months?: number | null;
  new_term_months?: number | null;
  previous_interest_rate?: number | null;
  new_interest_rate?: number | null;
  previous_monthly_payment?: number | null;
  new_monthly_payment?: number | null;
  previous_balance?: number | null;
  new_balance?: number | null;
  amount_money?: number | null;
}): Promise<void> {
  const row = {
    sacco_loan_id: payload.sacco_loan_id,
    modification_type: payload.modification_type,
    effective_date: payload.effective_date ?? new Date().toISOString().slice(0, 10),
    notes: payload.notes ?? null,
    previous_term_months: payload.previous_term_months ?? null,
    new_term_months: payload.new_term_months ?? null,
    previous_interest_rate: payload.previous_interest_rate ?? null,
    new_interest_rate: payload.new_interest_rate ?? null,
    previous_monthly_payment: payload.previous_monthly_payment ?? null,
    new_monthly_payment: payload.new_monthly_payment ?? null,
    previous_balance: payload.previous_balance ?? null,
    new_balance: payload.new_balance ?? null,
    amount_money: payload.amount_money ?? 0,
  };
  const { error } = await sb.from("sacco_loan_modifications").insert(row);
  if (error) throw error;
}

export async function fetchSaccoLoanModificationsForLoan(loanId: string): Promise<
  {
    id: string;
    modification_type: string;
    effective_date: string;
    notes: string | null;
    amount_money: number | null;
    created_at: string;
  }[]
> {
  const { data, error } = await sb
    .from("sacco_loan_modifications")
    .select("id, modification_type, effective_date, notes, amount_money, created_at")
    .eq("sacco_loan_id", loanId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as {
    id: string;
    modification_type: string;
    effective_date: string;
    notes: string | null;
    amount_money: number | null;
    created_at: string;
  }[];
}

export async function insertLoanRow(payload: {
  sacco_member_id: string;
  member_name: string;
  loan_type: string;
  amount: number;
  balance: number;
  paid_amount: number;
  status: LoanStatus;
  interest_rate: number;
  term_months: number;
  monthly_payment: number;
  approval_stage: number;
  purpose: string;
  guarantors: string[];
  application_date: string;
  interest_basis: "flat" | "declining";
  disbursement_date: string | null;
  fees: Loan["fees"] | null;
  collateral_description?: string | null;
  lc1_chairman_name?: string | null;
  lc1_chairman_phone?: string | null;
  last_payment_date?: string | null;
}): Promise<Loan> {
  const baseRow = {
    sacco_member_id: payload.sacco_member_id,
    member_name: payload.member_name,
    loan_type: payload.loan_type,
    amount: payload.amount,
    balance: payload.balance,
    paid_amount: payload.paid_amount,
    status: payload.status,
    interest_rate: payload.interest_rate,
    term_months: payload.term_months,
    monthly_payment: payload.monthly_payment,
    approval_stage: payload.approval_stage,
    purpose: payload.purpose,
    guarantors: payload.guarantors,
    application_date: payload.application_date,
    interest_basis: payload.interest_basis,
    disbursement_date: payload.disbursement_date,
    fees: payload.fees,
  };
  const extendedRow = {
    ...baseRow,
    collateral_description: payload.collateral_description ?? null,
    lc1_chairman_name: payload.lc1_chairman_name ?? null,
    lc1_chairman_phone: payload.lc1_chairman_phone ?? null,
    last_payment_date: payload.last_payment_date ?? null,
  };

  let { data, error } = await sb.from("sacco_loans").insert(extendedRow).select("*").single();
  if (error && isUnknownColumnError(error)) {
    console.warn(
      "[SACCO] Retrying loan insert without collateral/last_payment columns — apply migration 20260426120001_sacco_loan_collateral_last_payment.sql to persist them."
    );
    const retry = await sb.from("sacco_loans").insert(baseRow).select("*").single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  return mapLoanFromRow(data as DbLoan);
}

export async function updateLoanRow(
  id: string,
  patch: Partial<{
    balance: number;
    paid_amount: number;
    status: LoanStatus;
    approval_stage: number;
    disbursement_date: string | null;
    last_payment_date: string | null;
    interest_rate: number;
    term_months: number;
    monthly_payment: number;
    written_off_remaining: number;
    written_off_total: number;
    written_off_at: string | null;
  }>
): Promise<void> {
  const { error } = await sb.from("sacco_loans").update(patch).eq("id", id);
  if (error) throw error;
}

export async function replaceLoanProductsForOrg(organizationId: string, products: LoanProduct[]): Promise<LoanProduct[]> {
  const { error: delErr } = await sb.from("sacco_loan_products").delete().eq("organization_id", organizationId);
  if (delErr) throw delErr;
  if (products.length === 0) return [];
  const rows = products.map((p, i) => ({
    organization_id: organizationId,
    name: p.name,
    interest_rate: p.interestRate,
    max_term_months: p.maxTerm,
    min_amount: p.minAmount,
    max_amount: p.maxAmount,
    interest_basis: p.interestBasis,
    fees: p.fees,
    compulsory_savings_rate: p.compulsorySavingsRate,
    minimum_shares: p.minimumShares,
    is_active: p.isActive,
    sort_order: i,
  }));
  const { error: insErr } = await sb.from("sacco_loan_products").insert(rows);
  if (insErr) throw insErr;
  const { data, error } = await sb
    .from("sacco_loan_products")
    .select("*")
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: DbProduct) => mapProductFromRow(r));
}

export async function upsertProvisioningSettings(organizationId: string, cfg: ProvisioningConfig): Promise<void> {
  const { error } = await sb.from("sacco_provisioning_settings").upsert(
    {
      organization_id: organizationId,
      provision_choice: cfg.provisionChoice,
      general_provision_old: cfg.generalProvisionOld,
      general_provision_new: cfg.generalProvisionNew,
      rates: cfg.rates,
    },
    { onConflict: "organization_id" }
  );
  if (error) throw error;
}
