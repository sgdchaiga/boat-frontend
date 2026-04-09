import { supabase } from "./supabase";
import type { AutoDepreciationFrequency } from "./fixedAssetSchedule";

export type FixedAssetOrgSettingsRow = {
  organization_id: string;
  auto_depreciation_enabled: boolean;
  auto_depreciation_frequency: AutoDepreciationFrequency;
  auto_depreciation_last_period_end: string | null;
  updated_at?: string;
};

export async function fetchFixedAssetOrgSettings(organizationId: string): Promise<FixedAssetOrgSettingsRow | null> {
  const { data, error } = await supabase
    .from("fixed_asset_org_settings")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return (data as FixedAssetOrgSettingsRow) ?? null;
}

export async function upsertFixedAssetOrgSettings(
  organizationId: string,
  patch: Partial<Pick<FixedAssetOrgSettingsRow, "auto_depreciation_enabled" | "auto_depreciation_frequency" | "auto_depreciation_last_period_end">>
): Promise<void> {
  const existing = await fetchFixedAssetOrgSettings(organizationId);
  const { error } = await supabase.from("fixed_asset_org_settings").upsert(
    {
      organization_id: organizationId,
      auto_depreciation_enabled: patch.auto_depreciation_enabled ?? existing?.auto_depreciation_enabled ?? false,
      auto_depreciation_frequency: patch.auto_depreciation_frequency ?? existing?.auto_depreciation_frequency ?? "monthly",
      auto_depreciation_last_period_end:
        patch.auto_depreciation_last_period_end !== undefined
          ? patch.auto_depreciation_last_period_end
          : existing?.auto_depreciation_last_period_end ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" }
  );
  if (error) throw error;
}
