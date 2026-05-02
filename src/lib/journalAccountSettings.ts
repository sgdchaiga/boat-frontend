/**
 * Default GL accounts used for automatic double-entry journal posting.
 * Primary source: `journal_gl_settings` (per organization). localStorage is a fallback
 * when no org row exists (migration / offline).
 */

import { supabase } from "./supabase";

const STORAGE_KEY = "guestpro_journal_accounts";

export type JournalAccountRole =
  | "revenue"
  | "cash"
  | "receivable"
  | "expense"
  | "payable"
  | "purchases_inventory"
  | "pos_bank"
  | "pos_mtn_mobile_money"
  | "pos_airtel_money"
  | "pos_cogs_bar"
  | "pos_inventory_bar"
  | "pos_cogs_kitchen"
  | "pos_inventory_kitchen"
  | "pos_cogs_room"
  | "pos_inventory_room"
  | "vat"
  | "fixed_asset_cost"
  | "accumulated_depreciation"
  | "depreciation_expense"
  | "revaluation_reserve"
  | "impairment_loss"
  | "gain_on_disposal"
  | "loss_on_disposal"
  | "retained_earnings"
  | "wallet_liability"
  | "wallet_clearing"
  | "manufacturing_finished_goods"
  | "manufacturing_wip";

export interface JournalAccountSettings {
  revenue_id: string | null;
  cash_id: string | null;
  receivable_id: string | null;
  expense_id: string | null;
  payable_id: string | null;
  /** Default VAT / input tax liability GL (expenses, when line VAT GL not set). */
  vat_id: string | null;
  /** Default VAT rate % for new expense entries (e.g. 18). */
  default_vat_percent: number | null;
  /** GRN/Bills — debit shop stock / inventory (asset). */
  purchases_inventory_id: string | null;
  pos_bank_id: string | null;
  pos_mtn_mobile_money_id: string | null;
  pos_airtel_money_id: string | null;
  pos_cogs_bar_id: string | null;
  pos_inventory_bar_id: string | null;
  pos_cogs_kitchen_id: string | null;
  pos_inventory_kitchen_id: string | null;
  pos_cogs_room_id: string | null;
  pos_inventory_room_id: string | null;
  /** Hotel POS: sales revenue per department (fallback: `revenue_id`). */
  pos_revenue_bar_id: string | null;
  pos_revenue_kitchen_id: string | null;
  pos_revenue_room_id: string | null;
  fixed_asset_cost_id: string | null;
  accumulated_depreciation_id: string | null;
  depreciation_expense_id: string | null;
  revaluation_reserve_id: string | null;
  impairment_loss_id: string | null;
  gain_on_disposal_id: string | null;
  loss_on_disposal_id: string | null;
  /** Equity — revaluation OCI recycling on fixed asset disposal. */
  retained_earnings_id: string | null;
  /**
   * SACCO teller: when true, staff picks counterparty GL on each cash deposit/withdrawal;
   * when false, use `teller_default_counterparty_gl_id`.
   */
  teller_allow_per_transaction_counterparty_gl: boolean;
  /** Default counterparty GL when `teller_allow_per_transaction_counterparty_gl` is false. */
  teller_default_counterparty_gl_id: string | null;
  /** Customer wallet balances — liability (credit on top-up). */
  wallet_liability_id: string | null;
  /** Cash/bank clearing contra for wallet deposits and withdrawals. */
  wallet_clearing_id: string | null;
  /** school: invoice accrual (default) vs revenue on receipt only. */
  school_accounting_basis: "accrual" | "cash";
  /** Manufacturing costing capitalization — debit. */
  manufacturing_finished_goods_id: string | null;
  /** Manufacturing costing — credit / WIP clearing. */
  manufacturing_wip_id: string | null;
}

const DEFAULT_SETTINGS: JournalAccountSettings = {
  revenue_id: null,
  cash_id: null,
  receivable_id: null,
  expense_id: null,
  payable_id: null,
  vat_id: null,
  default_vat_percent: null,
  purchases_inventory_id: null,
  pos_bank_id: null,
  pos_mtn_mobile_money_id: null,
  pos_airtel_money_id: null,
  pos_cogs_bar_id: null,
  pos_inventory_bar_id: null,
  pos_cogs_kitchen_id: null,
  pos_inventory_kitchen_id: null,
  pos_cogs_room_id: null,
  pos_inventory_room_id: null,
  pos_revenue_bar_id: null,
  pos_revenue_kitchen_id: null,
  pos_revenue_room_id: null,
  fixed_asset_cost_id: null,
  accumulated_depreciation_id: null,
  depreciation_expense_id: null,
  revaluation_reserve_id: null,
  impairment_loss_id: null,
  gain_on_disposal_id: null,
  loss_on_disposal_id: null,
  retained_earnings_id: null,
  teller_allow_per_transaction_counterparty_gl: true,
  teller_default_counterparty_gl_id: null,
  wallet_liability_id: null,
  wallet_clearing_id: null,
  school_accounting_basis: "accrual",
  manufacturing_finished_goods_id: null,
  manufacturing_wip_id: null,
};

export function loadJournalAccountSettings(): JournalAccountSettings {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      if (parsed.pos_mobile_money_id && !parsed.pos_mtn_mobile_money_id) {
        parsed.pos_mtn_mobile_money_id = parsed.pos_mobile_money_id;
      }
      delete parsed.pos_mobile_money_id;
      const merged = { ...DEFAULT_SETTINGS, ...parsed } as JournalAccountSettings;
      if (merged.school_accounting_basis !== "cash") merged.school_accounting_basis = "accrual";
      if (merged.default_vat_percent != null && typeof merged.default_vat_percent !== "number") {
        const n = Number(merged.default_vat_percent);
        merged.default_vat_percent = Number.isFinite(n) ? n : null;
      }
      if (typeof merged.teller_allow_per_transaction_counterparty_gl !== "boolean") {
        merged.teller_allow_per_transaction_counterparty_gl =
          merged.teller_allow_per_transaction_counterparty_gl === true ||
          merged.teller_allow_per_transaction_counterparty_gl === "true";
      }
      return merged;
    } catch (_) {
      /* ignore */
    }
  }
  return DEFAULT_SETTINGS;
}

export function saveJournalAccountSettings(settings: JournalAccountSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** PostgREST often puts the useful text in `message`; some versions use `details` / `hint`. */
function postgrestErrorText(err: { message?: string; details?: string; hint?: string } | null): string {
  if (!err) return "";
  return [err.message, err.details, err.hint].filter(Boolean).join(" ").toLowerCase();
}

/** PostgREST / Postgres when VAT migration columns are not applied yet */
function isLikelyMissingVatColumnError(err: { message?: string; details?: string; hint?: string; code?: string } | null): boolean {
  if (!err) return false;
  const m = postgrestErrorText(err);
  const c = String(err.code || "");
  return (
    c === "PGRST204" ||
    m.includes("vat_gl_account_id") ||
    m.includes("default_vat_percent") ||
    (m.includes("schema cache") && m.includes("column"))
  );
}

function isLikelyMissingFixedAssetColumnError(err: { message?: string; details?: string; hint?: string; code?: string } | null): boolean {
  if (!err) return false;
  const m = postgrestErrorText(err);
  const c = String(err.code || "");
  return (
    c === "PGRST204" ||
    m.includes("fixed_asset_cost_gl_account_id") ||
    m.includes("retained_earnings_gl_account_id") ||
    (m.includes("schema cache") && m.includes("column"))
  );
}

function isLikelyMissingPosRevenueDeptColumnError(err: { message?: string; details?: string; hint?: string; code?: string } | null): boolean {
  if (!err) return false;
  const m = postgrestErrorText(err);
  const c = String(err.code || "");
  return (
    c === "PGRST204" ||
    m.includes("pos_revenue_bar_gl_account_id") ||
    m.includes("pos_revenue_kitchen_gl_account_id") ||
    m.includes("pos_revenue_room_gl_account_id") ||
    (m.includes("schema cache") && m.includes("column") && m.includes("journal_gl_settings"))
  );
}

function isLikelyMissingTellerColumnError(err: { message?: string; details?: string; hint?: string; code?: string } | null): boolean {
  if (!err) return false;
  const m = postgrestErrorText(err);
  const c = String(err.code || "");
  return (
    c === "PGRST204" ||
    m.includes("teller_allow_per_transaction_counterparty_gl") ||
    m.includes("teller_default_counterparty_gl_account_id") ||
    (m.includes("schema cache") && m.includes("column"))
  );
}

/** Legacy columns before per-department POS revenue (migration 20260431160000). */
const JOURNAL_GL_SELECT_LEGACY_BASE =
  "revenue_gl_account_id, cash_gl_account_id, receivable_gl_account_id, expense_gl_account_id, payable_gl_account_id, purchases_inventory_gl_account_id, pos_bank_gl_account_id, pos_mtn_mobile_money_gl_account_id, pos_airtel_money_gl_account_id, pos_cogs_bar_gl_account_id, pos_inventory_bar_gl_account_id, pos_cogs_kitchen_gl_account_id, pos_inventory_kitchen_gl_account_id, pos_cogs_room_gl_account_id, pos_inventory_room_gl_account_id";

const JOURNAL_GL_SELECT_LEGACY = `${JOURNAL_GL_SELECT_LEGACY_BASE}, pos_revenue_bar_gl_account_id, pos_revenue_kitchen_gl_account_id, pos_revenue_room_gl_account_id`;

const JOURNAL_GL_SELECT_WITH_VAT = `${JOURNAL_GL_SELECT_LEGACY.replace(
  "payable_gl_account_id, purchases_inventory",
  "payable_gl_account_id, vat_gl_account_id, default_vat_percent, purchases_inventory"
)}`;

const JOURNAL_GL_SELECT_WITH_FA = `${JOURNAL_GL_SELECT_WITH_VAT}, fixed_asset_cost_gl_account_id, accumulated_depreciation_gl_account_id, depreciation_expense_gl_account_id, revaluation_reserve_gl_account_id, impairment_loss_gl_account_id, gain_on_disposal_gl_account_id, loss_on_disposal_gl_account_id`;

const JOURNAL_GL_SELECT_FULL = `${JOURNAL_GL_SELECT_WITH_FA}, retained_earnings_gl_account_id`;

const JOURNAL_GL_SELECT_WITH_TELLER = `${JOURNAL_GL_SELECT_FULL}, teller_allow_per_transaction_counterparty_gl, teller_default_counterparty_gl_account_id`;

const JOURNAL_GL_SELECT_WITH_WALLET = `${JOURNAL_GL_SELECT_WITH_TELLER}, wallet_liability_gl_account_id, wallet_clearing_gl_account_id`;

const JOURNAL_GL_SELECT_WITH_WALLET_SCHOOL_MFG = `${JOURNAL_GL_SELECT_WITH_WALLET}, school_accounting_basis, manufacturing_finished_goods_gl_account_id, manufacturing_wip_gl_account_id`;

function mapJournalGlRowToSettings(d: {
  revenue_gl_account_id: string | null;
  cash_gl_account_id: string | null;
  receivable_gl_account_id: string | null;
  expense_gl_account_id: string | null;
  payable_gl_account_id: string | null;
  vat_gl_account_id?: string | null;
  default_vat_percent?: number | string | null;
  purchases_inventory_gl_account_id: string | null;
  pos_bank_gl_account_id: string | null;
  pos_mtn_mobile_money_gl_account_id: string | null;
  pos_airtel_money_gl_account_id: string | null;
  pos_cogs_bar_gl_account_id: string | null;
  pos_inventory_bar_gl_account_id: string | null;
  pos_cogs_kitchen_gl_account_id: string | null;
  pos_inventory_kitchen_gl_account_id: string | null;
  pos_cogs_room_gl_account_id: string | null;
  pos_inventory_room_gl_account_id: string | null;
  pos_revenue_bar_gl_account_id?: string | null;
  pos_revenue_kitchen_gl_account_id?: string | null;
  pos_revenue_room_gl_account_id?: string | null;
  fixed_asset_cost_gl_account_id?: string | null;
  accumulated_depreciation_gl_account_id?: string | null;
  depreciation_expense_gl_account_id?: string | null;
  revaluation_reserve_gl_account_id?: string | null;
  impairment_loss_gl_account_id?: string | null;
  gain_on_disposal_gl_account_id?: string | null;
  loss_on_disposal_gl_account_id?: string | null;
  retained_earnings_gl_account_id?: string | null;
  teller_allow_per_transaction_counterparty_gl?: boolean | null;
  teller_default_counterparty_gl_account_id?: string | null;
  wallet_liability_gl_account_id?: string | null;
  wallet_clearing_gl_account_id?: string | null;
  school_accounting_basis?: string | null;
  manufacturing_finished_goods_gl_account_id?: string | null;
  manufacturing_wip_gl_account_id?: string | null;
}): JournalAccountSettings {
  const dv = d.default_vat_percent;
  const defaultVatPct =
    dv == null ? null : typeof dv === "number" ? dv : Number.parseFloat(String(dv));
  const defaultVatPercent =
    defaultVatPct != null && Number.isFinite(defaultVatPct) ? defaultVatPct : null;

  return {
    revenue_id: d.revenue_gl_account_id,
    cash_id: d.cash_gl_account_id,
    receivable_id: d.receivable_gl_account_id,
    expense_id: d.expense_gl_account_id,
    payable_id: d.payable_gl_account_id,
    vat_id: d.vat_gl_account_id ?? null,
    default_vat_percent: defaultVatPercent,
    purchases_inventory_id: d.purchases_inventory_gl_account_id,
    pos_bank_id: d.pos_bank_gl_account_id,
    pos_mtn_mobile_money_id: d.pos_mtn_mobile_money_gl_account_id,
    pos_airtel_money_id: d.pos_airtel_money_gl_account_id,
    pos_cogs_bar_id: d.pos_cogs_bar_gl_account_id,
    pos_inventory_bar_id: d.pos_inventory_bar_gl_account_id,
    pos_cogs_kitchen_id: d.pos_cogs_kitchen_gl_account_id,
    pos_inventory_kitchen_id: d.pos_inventory_kitchen_gl_account_id,
    pos_cogs_room_id: d.pos_cogs_room_gl_account_id,
    pos_inventory_room_id: d.pos_inventory_room_gl_account_id,
    pos_revenue_bar_id: d.pos_revenue_bar_gl_account_id ?? null,
    pos_revenue_kitchen_id: d.pos_revenue_kitchen_gl_account_id ?? null,
    pos_revenue_room_id: d.pos_revenue_room_gl_account_id ?? null,
    fixed_asset_cost_id: d.fixed_asset_cost_gl_account_id ?? null,
    accumulated_depreciation_id: d.accumulated_depreciation_gl_account_id ?? null,
    depreciation_expense_id: d.depreciation_expense_gl_account_id ?? null,
    revaluation_reserve_id: d.revaluation_reserve_gl_account_id ?? null,
    impairment_loss_id: d.impairment_loss_gl_account_id ?? null,
    gain_on_disposal_id: d.gain_on_disposal_gl_account_id ?? null,
    loss_on_disposal_id: d.loss_on_disposal_gl_account_id ?? null,
    retained_earnings_id: d.retained_earnings_gl_account_id ?? null,
    teller_allow_per_transaction_counterparty_gl: d.teller_allow_per_transaction_counterparty_gl ?? true,
    teller_default_counterparty_gl_id: d.teller_default_counterparty_gl_account_id ?? null,
    wallet_liability_id: d.wallet_liability_gl_account_id ?? null,
    wallet_clearing_id: d.wallet_clearing_gl_account_id ?? null,
    school_accounting_basis:
      typeof d.school_accounting_basis === "string" && d.school_accounting_basis.toLowerCase() === "cash" ? "cash" : "accrual",
    manufacturing_finished_goods_id: d.manufacturing_finished_goods_gl_account_id ?? null,
    manufacturing_wip_id: d.manufacturing_wip_gl_account_id ?? null,
  };
}

function isLikelyMissingSchoolManufacturingJournalCols(err: {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
} | null): boolean {
  if (!err) return false;
  const m = postgrestErrorText(err);
  const c = String(err.code || "");
  return (
    c === "PGRST204" ||
    m.includes("school_accounting_basis") ||
    m.includes("manufacturing_finished_goods_gl_account_id") ||
    m.includes("manufacturing_wip_gl_account_id")
  );
}

/** Load org-scoped settings from Supabase; returns null if no row. */
function isLikelyMissingWalletColumnError(err: { message?: string; details?: string; hint?: string; code?: string } | null): boolean {
  if (!err) return false;
  const m = postgrestErrorText(err);
  const c = String(err.code || "");
  return (
    c === "PGRST204" ||
    m.includes("wallet_liability_gl_account_id") ||
    m.includes("wallet_clearing_gl_account_id") ||
    (m.includes("schema cache") && m.includes("column"))
  );
}

export async function fetchJournalGlSettings(organizationId: string): Promise<JournalAccountSettings | null> {
  let res = await supabase
    .from("journal_gl_settings")
    .select(JOURNAL_GL_SELECT_WITH_WALLET_SCHOOL_MFG)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (res.error && isLikelyMissingSchoolManufacturingJournalCols(res.error)) {
    res = await supabase
      .from("journal_gl_settings")
      .select(JOURNAL_GL_SELECT_WITH_WALLET)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!res.error) {
      console.warn(
        "[journal_gl_settings] Loaded without school accounting / manufacturing columns. Apply migration 20260502104500_school_accounting_basis_manufacturing_journal.sql."
      );
    }
  }

  if (res.error && isLikelyMissingWalletColumnError(res.error)) {
    res = await supabase
      .from("journal_gl_settings")
      .select(JOURNAL_GL_SELECT_WITH_TELLER)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!res.error) {
      console.warn(
        "[journal_gl_settings] Loaded without wallet GL columns. Apply migration 20260502120000_wallet_customers_and_liability_gl.sql."
      );
    }
  }

  if (res.error && isLikelyMissingPosRevenueDeptColumnError(res.error)) {
    res = await supabase
      .from("journal_gl_settings")
      .select(JOURNAL_GL_SELECT_WITH_TELLER.replace(JOURNAL_GL_SELECT_LEGACY, JOURNAL_GL_SELECT_LEGACY_BASE))
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!res.error) {
      console.warn(
        "[journal_gl_settings] Loaded without POS revenue-by-department columns. Apply migration 20260431160000_journal_pos_revenue_by_department.sql."
      );
    }
  }

  if (res.error && isLikelyMissingTellerColumnError(res.error)) {
    res = await supabase
      .from("journal_gl_settings")
      .select(JOURNAL_GL_SELECT_FULL)
      .eq("organization_id", organizationId)
      .maybeSingle();
  }

  if (res.error && isLikelyMissingFixedAssetColumnError(res.error)) {
    res = await supabase
      .from("journal_gl_settings")
      .select(JOURNAL_GL_SELECT_WITH_FA)
      .eq("organization_id", organizationId)
      .maybeSingle();
  }

  if (res.error && isLikelyMissingFixedAssetColumnError(res.error)) {
    res = await supabase
      .from("journal_gl_settings")
      .select(JOURNAL_GL_SELECT_WITH_VAT)
      .eq("organization_id", organizationId)
      .maybeSingle();
  }

  if (res.error && isLikelyMissingVatColumnError(res.error)) {
    res = await supabase
      .from("journal_gl_settings")
      .select(JOURNAL_GL_SELECT_LEGACY_BASE)
      .eq("organization_id", organizationId)
      .maybeSingle();
  }

  const { data, error } = res;
  if (error || !data) return null;

  return mapJournalGlRowToSettings(data as Parameters<typeof mapJournalGlRowToSettings>[0]);
}

export async function upsertJournalGlSettings(organizationId: string, settings: JournalAccountSettings): Promise<void> {
  const updatedAt = new Date().toISOString();
  const payloadBase = {
    organization_id: organizationId,
    revenue_gl_account_id: settings.revenue_id,
    cash_gl_account_id: settings.cash_id,
    receivable_gl_account_id: settings.receivable_id,
    expense_gl_account_id: settings.expense_id,
    payable_gl_account_id: settings.payable_id,
    purchases_inventory_gl_account_id: settings.purchases_inventory_id,
    pos_bank_gl_account_id: settings.pos_bank_id,
    pos_mtn_mobile_money_gl_account_id: settings.pos_mtn_mobile_money_id,
    pos_airtel_money_gl_account_id: settings.pos_airtel_money_id,
    pos_cogs_bar_gl_account_id: settings.pos_cogs_bar_id,
    pos_inventory_bar_gl_account_id: settings.pos_inventory_bar_id,
    pos_cogs_kitchen_gl_account_id: settings.pos_cogs_kitchen_id,
    pos_inventory_kitchen_gl_account_id: settings.pos_inventory_kitchen_id,
    pos_cogs_room_gl_account_id: settings.pos_cogs_room_id,
    pos_inventory_room_gl_account_id: settings.pos_inventory_room_id,
    pos_revenue_bar_gl_account_id: settings.pos_revenue_bar_id,
    pos_revenue_kitchen_gl_account_id: settings.pos_revenue_kitchen_id,
    pos_revenue_room_gl_account_id: settings.pos_revenue_room_id,
    updated_at: updatedAt,
  };

  const payloadWithVat = {
    ...payloadBase,
    vat_gl_account_id: settings.vat_id,
    default_vat_percent: settings.default_vat_percent,
  };

  const payloadWithFixedAssets = {
    ...payloadWithVat,
    fixed_asset_cost_gl_account_id: settings.fixed_asset_cost_id,
    accumulated_depreciation_gl_account_id: settings.accumulated_depreciation_id,
    depreciation_expense_gl_account_id: settings.depreciation_expense_id,
    revaluation_reserve_gl_account_id: settings.revaluation_reserve_id,
    impairment_loss_gl_account_id: settings.impairment_loss_id,
    gain_on_disposal_gl_account_id: settings.gain_on_disposal_id,
    loss_on_disposal_gl_account_id: settings.loss_on_disposal_id,
  };

  const payloadWithRetained = {
    ...payloadWithFixedAssets,
    retained_earnings_gl_account_id: settings.retained_earnings_id,
  };

  const payloadWithTeller = {
    ...payloadWithRetained,
    teller_allow_per_transaction_counterparty_gl: settings.teller_allow_per_transaction_counterparty_gl,
    teller_default_counterparty_gl_account_id: settings.teller_default_counterparty_gl_id,
  };

  const payloadWithWallet = {
    ...payloadWithTeller,
    wallet_liability_gl_account_id: settings.wallet_liability_id,
    wallet_clearing_gl_account_id: settings.wallet_clearing_id,
  };

  const payloadWithSchoolMfg = {
    ...payloadWithWallet,
    school_accounting_basis: settings.school_accounting_basis === "cash" ? "cash" : "accrual",
    manufacturing_finished_goods_gl_account_id: settings.manufacturing_finished_goods_id,
    manufacturing_wip_gl_account_id: settings.manufacturing_wip_id,
  };

  let { error } = await supabase.from("journal_gl_settings").upsert(payloadWithSchoolMfg, { onConflict: "organization_id" });

  if (error && isLikelyMissingSchoolManufacturingJournalCols(error)) {
    ({ error } = await supabase.from("journal_gl_settings").upsert(payloadWithWallet, { onConflict: "organization_id" }));
    if (!error) {
      console.warn(
        "[journal_gl_settings] Saved without school accounting / manufacturing columns. Apply migration 20260502104500_school_accounting_basis_manufacturing_journal.sql."
      );
    }
  }

  if (error && isLikelyMissingWalletColumnError(error)) {
    ({ error } = await supabase.from("journal_gl_settings").upsert(payloadWithTeller, { onConflict: "organization_id" }));
    if (!error) {
      console.warn(
        "[journal_gl_settings] Saved without wallet GL columns. Apply migration 20260502120000_wallet_customers_and_liability_gl.sql."
      );
    }
  }

  if (error && isLikelyMissingPosRevenueDeptColumnError(error)) {
    const {
      pos_revenue_bar_gl_account_id: _rb,
      pos_revenue_kitchen_gl_account_id: _rk,
      pos_revenue_room_gl_account_id: _rr,
      ...payloadWithoutPosDeptRevenue
    } = payloadWithTeller;
    ({ error } = await supabase
      .from("journal_gl_settings")
      .upsert(payloadWithoutPosDeptRevenue, { onConflict: "organization_id" }));
    if (!error) {
      console.warn(
        "[journal_gl_settings] Saved without POS revenue-by-department columns. Apply migration 20260431160000_journal_pos_revenue_by_department.sql."
      );
    }
  }

  if (error && isLikelyMissingTellerColumnError(error)) {
    ({ error } = await supabase.from("journal_gl_settings").upsert(payloadWithRetained, { onConflict: "organization_id" }));
    if (!error) {
      console.warn(
        "[journal_gl_settings] Saved without teller counterparty columns. Apply migration 20260426120011_journal_gl_teller_counterparty_settings.sql."
      );
    }
  }

  if (error && isLikelyMissingFixedAssetColumnError(error)) {
    ({ error } = await supabase.from("journal_gl_settings").upsert(payloadWithFixedAssets, { onConflict: "organization_id" }));
    if (!error) {
      console.warn(
        "[journal_gl_settings] Saved without retained earnings column. Apply migration 20260423170000_journal_dimensions_retained_earnings_fa_cron.sql."
      );
    }
  }

  if (error && isLikelyMissingFixedAssetColumnError(error)) {
    ({ error } = await supabase.from("journal_gl_settings").upsert(payloadWithVat, { onConflict: "organization_id" }));
    if (!error) {
      console.warn(
        "[journal_gl_settings] Saved without fixed-asset columns. Apply migration 20260423150000_fixed_assets_module.sql."
      );
    }
  }

  if (error && isLikelyMissingVatColumnError(error)) {
    ({ error } = await supabase.from("journal_gl_settings").upsert(payloadBase, { onConflict: "organization_id" }));
    if (!error) {
      console.warn(
        "[journal_gl_settings] Saved without VAT columns. Apply migration 20260422192000_journal_gl_vat_settings.sql to enable VAT defaults in the database."
      );
    }
  }

  if (error) throw error;
}

/** DB row if present, otherwise localStorage defaults. */
export async function resolveJournalAccountSettings(organizationId: string | null | undefined): Promise<JournalAccountSettings> {
  const local = loadJournalAccountSettings();
  if (!organizationId) return local;
  const db = await fetchJournalGlSettings(organizationId);
  return db ?? local;
}

export const JOURNAL_ACCOUNT_ROLES: { id: JournalAccountRole; label: string; accountType: string }[] = [
  { id: "revenue", label: "Revenue (income)", accountType: "income" },
  { id: "cash", label: "Cash", accountType: "asset" },
  { id: "receivable", label: "Accounts receivable", accountType: "asset" },
  {
    id: "expense",
    label: "Expense (default — vendor credits & legacy postings)",
    accountType: "expense",
  },
  { id: "payable", label: "Accounts payable", accountType: "liability" },
  {
    id: "vat",
    label: "VAT / tax (input & output — expenses, POS sales)",
    accountType: "liability",
  },
  {
    id: "purchases_inventory",
    label: "GRN/Bills — Shop stock / inventory (debit)",
    accountType: "asset",
  },
  { id: "pos_bank", label: "POS — Bank / card (receipt)", accountType: "asset" },
  { id: "pos_mtn_mobile_money", label: "POS — MTN Mobile Money (receipt)", accountType: "asset" },
  { id: "pos_airtel_money", label: "POS — Airtel Money (receipt)", accountType: "asset" },
  { id: "pos_cogs_bar", label: "POS — Bar purchases (COGS)", accountType: "expense" },
  { id: "pos_inventory_bar", label: "POS — Bar stock (inventory)", accountType: "asset" },
  { id: "pos_cogs_kitchen", label: "POS — Kitchen purchases (COGS)", accountType: "expense" },
  { id: "pos_inventory_kitchen", label: "POS — Kitchen stock (inventory)", accountType: "asset" },
  { id: "pos_cogs_room", label: "POS — Room purchases (COGS)", accountType: "expense" },
  { id: "pos_inventory_room", label: "POS — Room stock (inventory)", accountType: "asset" },
  { id: "fixed_asset_cost", label: "Fixed assets — cost (PPE)", accountType: "asset" },
  { id: "accumulated_depreciation", label: "Fixed assets — accumulated depreciation (contra)", accountType: "asset" },
  { id: "depreciation_expense", label: "Fixed assets — depreciation expense", accountType: "expense" },
  { id: "revaluation_reserve", label: "Fixed assets — revaluation reserve (equity)", accountType: "equity" },
  { id: "impairment_loss", label: "Fixed assets — impairment loss", accountType: "expense" },
  { id: "gain_on_disposal", label: "Fixed assets — gain on disposal", accountType: "income" },
  { id: "loss_on_disposal", label: "Fixed assets — loss on disposal", accountType: "expense" },
  { id: "retained_earnings", label: "Retained earnings (OCI recycling on disposal)", accountType: "equity" },
  { id: "wallet_liability", label: "Wallet — customer liability (customer wallet balances)", accountType: "liability" },
  { id: "wallet_clearing", label: "Wallet — clearing / cash (contra for deposits & withdrawals)", accountType: "asset" },
  {
    id: "manufacturing_finished_goods",
    label: "Manufacturing — finished goods inventory (debit when capitalizing costing)",
    accountType: "asset",
  },
  {
    id: "manufacturing_wip",
    label: "Manufacturing — WIP / production clearing (credit when capitalizing costing)",
    accountType: "asset",
  },
];

/** Row for admin UI — may omit hotel-only POS buckets for retail. */
export type JournalAccountRoleRow = {
  id: JournalAccountRole;
  label: string;
  accountType: string;
  group: string;
};

const WALLET_JOURNAL_ROLE_ROWS: JournalAccountRoleRow[] = [
  {
    id: "wallet_liability",
    label: "Wallet — customer liability (customer wallet balances)",
    accountType: "liability",
    group: "Wallet",
  },
  {
    id: "wallet_clearing",
    label: "Wallet — clearing / cash (contra for deposits & withdrawals)",
    accountType: "asset",
    group: "Wallet",
  },
];

/**
 * Labels and grouping for Admin → Journal account settings.
 * Retail / other: retail wording, no room-service POS buckets (shop POS uses bar/kitchen slots in the engine).
 * School: core + GRN only (no POS product buckets).
 * Hotel / mixed / restaurant: full list with hospitality-oriented group titles.
 */
export function getJournalAccountRolesForBusinessType(businessType: string | null | undefined): JournalAccountRoleRow[] {
  const bt = (businessType || "hotel").toLowerCase();
  /** Retail-style POS buckets without hotel room/bar/kitchen splits. */
  const isRetail = bt === "retail" || bt === "other";

  const fixedAssetGroup = JOURNAL_ACCOUNT_ROLES.filter((r) =>
    [
      "fixed_asset_cost",
      "accumulated_depreciation",
      "depreciation_expense",
      "revaluation_reserve",
      "impairment_loss",
      "gain_on_disposal",
      "loss_on_disposal",
      "retained_earnings",
    ].includes(r.id)
  ).map((r) => ({ ...r, group: "Fixed assets" }));

  if (bt === "sacco") {
    const saccoCore = JOURNAL_ACCOUNT_ROLES.filter((r) =>
      ["revenue", "cash", "receivable", "expense", "payable", "vat"].includes(r.id)
    ).map((r) => {
      const labelOverrides: Partial<Record<JournalAccountRole, string>> = {
        revenue: "Interest & fee income (loans & investments)",
        cash: "Cash & bank (teller drawer & cashbook)",
        receivable: "Loans receivable (principal & outstanding interest)",
        expense: "Operating expenses",
        payable: "Creditors & payables",
        vat: "VAT / withholding",
      };
      return { ...r, label: labelOverrides[r.id] ?? r.label, group: "SACCO · journal account mapping" };
    });
    return [...saccoCore, ...fixedAssetGroup, ...WALLET_JOURNAL_ROLE_ROWS];
  }

  /** VSLA: lean core mapping without hotel/retail POS buckets. */
  if (bt === "vsla") {
    const vslaSet = new Set<JournalAccountRole>([
      "revenue",
      "cash",
      "receivable",
      "expense",
      "payable",
      "vat",
    ]);
    const vslaRows = JOURNAL_ACCOUNT_ROLES.filter((r) => vslaSet.has(r.id)).map((r) => ({
      ...r,
      group: "VSLA core accounting",
    }));
    return [...vslaRows, ...fixedAssetGroup, ...WALLET_JOURNAL_ROLE_ROWS];
  }

  /** School: core AP/AR and GRN; no POS product buckets. */
  if (bt === "school") {
    const schoolSet = new Set<JournalAccountRole>([
      "revenue",
      "cash",
      "receivable",
      "expense",
      "payable",
      "vat",
      "purchases_inventory",
    ]);
    const schoolRows = JOURNAL_ACCOUNT_ROLES.filter((r) => schoolSet.has(r.id)).map((r) => {
      let group = "Core accounting";
      if (r.id === "purchases_inventory") group = "Purchases / GRN";
      return { ...r, group };
    });
    return [...schoolRows, ...fixedAssetGroup, ...WALLET_JOURNAL_ROLE_ROWS];
  }

  /** Manufacturing: core + inventory/COGS, no hotel POS department buckets. */
  if (bt === "manufacturing") {
    const mfgSet = new Set<JournalAccountRole>([
      "revenue",
      "cash",
      "receivable",
      "expense",
      "payable",
      "vat",
      "purchases_inventory",
      "pos_cogs_kitchen",
      "pos_inventory_kitchen",
      "manufacturing_finished_goods",
      "manufacturing_wip",
    ]);
    const mfgRows = JOURNAL_ACCOUNT_ROLES.filter((r) => mfgSet.has(r.id)).map((r) => {
      const group =
        r.id === "purchases_inventory" ||
        r.id === "pos_cogs_kitchen" ||
        r.id === "pos_inventory_kitchen" ||
        r.id === "manufacturing_finished_goods" ||
        r.id === "manufacturing_wip"
          ? "Manufacturing / inventory"
          : "Core accounting";
      const label =
        r.id === "pos_cogs_kitchen"
          ? "Manufacturing — Cost of production / COGS"
          : r.id === "pos_inventory_kitchen"
            ? "Manufacturing — Finished goods / inventory"
            : r.label;
      return { ...r, label, group };
    });
    return [...mfgRows, ...fixedAssetGroup, ...WALLET_JOURNAL_ROLE_ROWS];
  }

  if (isRetail) {
    const retailCore = JOURNAL_ACCOUNT_ROLES.filter((r) =>
      ["revenue", "cash", "receivable", "expense", "payable", "vat"].includes(r.id)
    ).map((r) => ({ ...r, group: "Core accounting" }));
    const pi = JOURNAL_ACCOUNT_ROLES.find((r) => r.id === "purchases_inventory")!;
    const retailPurchasesGrn: JournalAccountRoleRow[] = [
      { ...pi, group: "Purchases / GRN" },
    ];
    const retailPosReceipts: JournalAccountRoleRow[] = [
      { id: "pos_bank", label: "Retail POS — Bank / card (cash receipts)", accountType: "asset", group: "Retail POS — Receipts" },
      {
        id: "pos_mtn_mobile_money",
        label: "Retail POS — MTN Mobile Money (cash receipts)",
        accountType: "asset",
        group: "Retail POS — Receipts",
      },
      {
        id: "pos_airtel_money",
        label: "Retail POS — Airtel Money (cash receipts)",
        accountType: "asset",
        group: "Retail POS — Receipts",
      },
    ];
    const retailCogs: JournalAccountRoleRow[] = [
      {
        id: "pos_cogs_bar",
        label: "POS — COGS (department / category A)",
        accountType: "expense",
        group: "Retail POS — Cost of goods & inventory",
      },
      {
        id: "pos_inventory_bar",
        label: "POS — Inventory (department / category A)",
        accountType: "asset",
        group: "Retail POS — Cost of goods & inventory",
      },
      {
        id: "pos_cogs_kitchen",
        label: "POS — COGS (shop / default)",
        accountType: "expense",
        group: "Retail POS — Cost of goods & inventory",
      },
      {
        id: "pos_inventory_kitchen",
        label: "POS — Inventory (shop / default)",
        accountType: "asset",
        group: "Retail POS — Cost of goods & inventory",
      },
    ];
    return [...retailCore, ...retailPurchasesGrn, ...retailPosReceipts, ...retailCogs, ...fixedAssetGroup, ...WALLET_JOURNAL_ROLE_ROWS];
  }

  /** Hotel / mixed / restaurant: each POS sale uses four account families (+ VAT when applicable). */
  const roleById = (id: JournalAccountRole) => JOURNAL_ACCOUNT_ROLES.find((r) => r.id === id)!;

  const hotelPosLabelTweaks: Partial<Record<JournalAccountRole, string>> = {
    revenue:
      "Default sales revenue (room charges, payables, and POS fallback when a department row below is blank)",
    cash: "Cash / till — default receipt GL when payment method is cash",
    pos_bank: "Bank / card — receipt GL for card & bank transfer",
    pos_mtn_mobile_money: "MTN Mobile Money — receipt GL",
    pos_airtel_money: "Airtel Money — receipt GL",
  };

  const withHotelPosGroups = (id: JournalAccountRole, group: string): JournalAccountRoleRow => {
    const base = roleById(id);
    return {
      ...base,
      label: hotelPosLabelTweaks[id] ?? base.label,
      group,
    };
  };

  /** Payment methods + org-wide default revenue. Bar · kitchen · room sales / COGS / stock are edited in the department table on the admin page. */
  const hotelPosSalesRows: JournalAccountRoleRow[] = [
    withHotelPosGroups("revenue", "Hotel POS — Default revenue (fallback)"),
    ...(["cash", "pos_bank", "pos_mtn_mobile_money", "pos_airtel_money"] as const).map((id) =>
      withHotelPosGroups(id, "Hotel POS — Payment methods (receipt)")
    ),
  ];

  const hotelCoreIds: JournalAccountRole[] = ["receivable", "expense", "payable", "vat", "purchases_inventory"];
  const hotelCoreRows: JournalAccountRoleRow[] = hotelCoreIds.map((id) => {
    const base = roleById(id);
    const group =
      id === "purchases_inventory"
        ? "Core — Purchases / GRN (not POS sale lines)"
        : "Core accounting (room charges, payables, expenses, VAT)";
    return { ...base, group };
  });

  return [...hotelPosSalesRows, ...hotelCoreRows, ...fixedAssetGroup, ...WALLET_JOURNAL_ROLE_ROWS];
}
