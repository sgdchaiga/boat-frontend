import { supabase } from "./supabase";
import type { JournalAccountSettings } from "./journalAccountSettings";

export type FixedAssetCategoryGlRow = {
  organization_id: string;
  category_id: string;
  fixed_asset_cost_gl_account_id: string | null;
  accumulated_depreciation_gl_account_id: string | null;
  depreciation_expense_gl_account_id: string | null;
  revaluation_reserve_gl_account_id: string | null;
  impairment_loss_gl_account_id: string | null;
  gain_on_disposal_gl_account_id: string | null;
  loss_on_disposal_gl_account_id: string | null;
};

export type FixedAssetGlSlots = {
  cost: string | null;
  accum: string | null;
  depExp: string | null;
  reval: string | null;
  impair: string | null;
  gain: string | null;
  loss: string | null;
  retainedEarnings: string | null;
  cash: string | null;
};

/** Merge org-wide journal settings with optional per-category overrides (null = use global). */
export function mergeFixedAssetGlSlots(
  global: JournalAccountSettings,
  cash: string | null,
  cat: FixedAssetCategoryGlRow | null | undefined
): FixedAssetGlSlots {
  return {
    cost: cat?.fixed_asset_cost_gl_account_id ?? global.fixed_asset_cost_id ?? null,
    accum: cat?.accumulated_depreciation_gl_account_id ?? global.accumulated_depreciation_id ?? null,
    depExp: cat?.depreciation_expense_gl_account_id ?? global.depreciation_expense_id ?? null,
    reval: cat?.revaluation_reserve_gl_account_id ?? global.revaluation_reserve_id ?? null,
    impair: cat?.impairment_loss_gl_account_id ?? global.impairment_loss_id ?? null,
    gain: cat?.gain_on_disposal_gl_account_id ?? global.gain_on_disposal_id ?? null,
    loss: cat?.loss_on_disposal_gl_account_id ?? global.loss_on_disposal_id ?? null,
    retainedEarnings: global.retained_earnings_id ?? null,
    cash,
  };
}

export async function fetchFixedAssetCategoryGlMap(organizationId: string): Promise<Map<string, FixedAssetCategoryGlRow>> {
  const { data, error } = await supabase
    .from("fixed_asset_category_gl_settings")
    .select("*")
    .eq("organization_id", organizationId);
  if (error) throw error;
  const m = new Map<string, FixedAssetCategoryGlRow>();
  for (const row of (data || []) as FixedAssetCategoryGlRow[]) {
    m.set(row.category_id, row);
  }
  return m;
}

const EMPTY_KEYS: (keyof Omit<FixedAssetCategoryGlRow, "organization_id" | "category_id">)[] = [
  "fixed_asset_cost_gl_account_id",
  "accumulated_depreciation_gl_account_id",
  "depreciation_expense_gl_account_id",
  "revaluation_reserve_gl_account_id",
  "impairment_loss_gl_account_id",
  "gain_on_disposal_gl_account_id",
  "loss_on_disposal_gl_account_id",
];

function rowIsEmpty(row: Partial<FixedAssetCategoryGlRow>): boolean {
  return EMPTY_KEYS.every((k) => row[k] == null || row[k] === "");
}

export async function upsertFixedAssetCategoryGlRow(
  organizationId: string,
  categoryId: string,
  patch: Partial<Omit<FixedAssetCategoryGlRow, "organization_id" | "category_id">>
): Promise<void> {
  const merged: Partial<FixedAssetCategoryGlRow> = {
    organization_id: organizationId,
    category_id: categoryId,
    ...patch,
  };
  if (rowIsEmpty(merged)) {
    const { error } = await supabase
      .from("fixed_asset_category_gl_settings")
      .delete()
      .eq("organization_id", organizationId)
      .eq("category_id", categoryId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("fixed_asset_category_gl_settings").upsert(
    {
      organization_id: organizationId,
      category_id: categoryId,
      fixed_asset_cost_gl_account_id: merged.fixed_asset_cost_gl_account_id ?? null,
      accumulated_depreciation_gl_account_id: merged.accumulated_depreciation_gl_account_id ?? null,
      depreciation_expense_gl_account_id: merged.depreciation_expense_gl_account_id ?? null,
      revaluation_reserve_gl_account_id: merged.revaluation_reserve_gl_account_id ?? null,
      impairment_loss_gl_account_id: merged.impairment_loss_gl_account_id ?? null,
      gain_on_disposal_gl_account_id: merged.gain_on_disposal_gl_account_id ?? null,
      loss_on_disposal_gl_account_id: merged.loss_on_disposal_gl_account_id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,category_id" }
  );
  if (error) throw error;
}
