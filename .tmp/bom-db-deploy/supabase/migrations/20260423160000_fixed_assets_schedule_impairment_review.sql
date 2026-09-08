-- Fixed assets: org-level auto-depreciation schedule (staff-managed) + impairment review dates

-- 1) Per-organization schedule (same RLS pattern as journal_gl_settings — staff in org)
CREATE TABLE IF NOT EXISTS public.fixed_asset_org_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  auto_depreciation_enabled boolean NOT NULL DEFAULT false,
  auto_depreciation_frequency text NOT NULL DEFAULT 'monthly' CHECK (auto_depreciation_frequency IN ('monthly', 'yearly')),
  /** Last period end date successfully posted (manual or auto flow updates this). */
  auto_depreciation_last_period_end date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fixed_asset_org_settings IS
  'Optional automation hints for fixed assets; posting still requires Preview + Post (or API).';

ALTER TABLE public.fixed_asset_org_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fa_org_settings_staff" ON public.fixed_asset_org_settings;
CREATE POLICY "fa_org_settings_staff"
  ON public.fixed_asset_org_settings FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (SELECT auth.uid()) AND s.organization_id = fixed_asset_org_settings.organization_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (SELECT auth.uid()) AND s.organization_id = fixed_asset_org_settings.organization_id
    )
  );

DROP POLICY IF EXISTS "fa_org_settings_platform" ON public.fixed_asset_org_settings;
CREATE POLICY "fa_org_settings_platform"
  ON public.fixed_asset_org_settings FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- 2) Optional IAS 36-style reminder (does not post journals)
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS impairment_review_due_date date;

COMMENT ON COLUMN public.fixed_assets.impairment_review_due_date IS
  'Optional next impairment review date for workflow reminders.';
