CREATE TABLE IF NOT EXISTS public.general_business_cashbook_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  show_helper_text boolean NOT NULL DEFAULT false,
  helper_text text NOT NULL DEFAULT 'Matches the Google Sheet register and posts a balanced journal immediately.',
  show_page_description boolean NOT NULL DEFAULT false,
  page_description text NOT NULL DEFAULT 'Record cash, mobile money and bank transactions in a focused AppSheet-style form.',
  primary_color text NOT NULL DEFAULT '#0f766e' CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text NOT NULL DEFAULT '#14b8a6' CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  button_radius integer NOT NULL DEFAULT 10 CHECK (button_radius BETWEEN 0 AND 24),
  updated_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.general_business_cashbook_settings
  ADD COLUMN IF NOT EXISTS show_page_description boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS page_description text NOT NULL DEFAULT 'Record cash, mobile money and bank transactions in a focused AppSheet-style form.';

ALTER TABLE public.general_business_cashbook_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cashbook_settings_read_org"
  ON public.general_business_cashbook_settings FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.staff me
      WHERE me.id = (SELECT auth.uid())
        AND me.organization_id = general_business_cashbook_settings.organization_id
    )
  );

CREATE POLICY "cashbook_settings_manage_admin"
  ON public.general_business_cashbook_settings FOR ALL TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.staff me
      WHERE me.id = (SELECT auth.uid())
        AND me.organization_id = general_business_cashbook_settings.organization_id
        AND lower(me.role) IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.staff me
      WHERE me.id = (SELECT auth.uid())
        AND me.organization_id = general_business_cashbook_settings.organization_id
        AND lower(me.role) IN ('admin', 'super_admin')
    )
  );

COMMENT ON TABLE public.general_business_cashbook_settings IS
  'Organization-level Cashbook branding and optional helper copy. Helper copy is hidden by default.';
