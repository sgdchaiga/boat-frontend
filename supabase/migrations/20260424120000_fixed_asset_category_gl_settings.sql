-- Per fixed-asset category GL overrides (falls back to journal_gl_settings when null)

CREATE TABLE IF NOT EXISTS public.fixed_asset_category_gl_settings (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.fixed_asset_categories(id) ON DELETE CASCADE,
  fixed_asset_cost_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  accumulated_depreciation_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  depreciation_expense_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  revaluation_reserve_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  impairment_loss_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  gain_on_disposal_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  loss_on_disposal_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, category_id)
);

COMMENT ON TABLE public.fixed_asset_category_gl_settings IS
  'Optional GL account overrides per fixed asset category; null column uses org default from journal_gl_settings.';

CREATE INDEX IF NOT EXISTS idx_fa_cat_gl_org ON public.fixed_asset_category_gl_settings(organization_id);

ALTER TABLE public.fixed_asset_category_gl_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fa_cat_gl_staff" ON public.fixed_asset_category_gl_settings;
CREATE POLICY "fa_cat_gl_staff"
  ON public.fixed_asset_category_gl_settings FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (SELECT auth.uid()) AND s.organization_id = fixed_asset_category_gl_settings.organization_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (SELECT auth.uid()) AND s.organization_id = fixed_asset_category_gl_settings.organization_id
    )
  );

DROP POLICY IF EXISTS "fa_cat_gl_platform" ON public.fixed_asset_category_gl_settings;
CREATE POLICY "fa_cat_gl_platform"
  ON public.fixed_asset_category_gl_settings FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());
