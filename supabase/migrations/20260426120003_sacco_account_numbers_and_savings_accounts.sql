-- Legacy installs may have sacco_member_number_settings from an older 2002 migration; rename to sacco_account_number_settings.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sacco_member_number_settings'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sacco_account_number_settings'
  ) THEN
    ALTER TABLE public.sacco_member_number_settings RENAME TO sacco_account_number_settings;
    DROP POLICY IF EXISTS "sacco_mn_settings_org" ON public.sacco_account_number_settings;
    CREATE POLICY "sacco_account_num_settings_org"
      ON public.sacco_account_number_settings FOR ALL TO authenticated
      USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
      WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));
  END IF;
END $$;

-- Align trigger after rename from legacy sacco_member_number_settings
CREATE OR REPLACE FUNCTION public.touch_sacco_account_number_settings_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_sacco_mn_settings_touch ON public.sacco_account_number_settings;
DROP TRIGGER IF EXISTS trg_sacco_account_number_settings_touch ON public.sacco_account_number_settings;
CREATE TRIGGER trg_sacco_account_number_settings_touch
BEFORE UPDATE ON public.sacco_account_number_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_sacco_account_number_settings_updated_at();

-- One member, many savings accounts (different products) — each gets a structured account_number.
CREATE TABLE IF NOT EXISTS public.sacco_member_savings_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sacco_member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  savings_product_code text NOT NULL,
  account_number text NOT NULL,
  balance numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sacco_savings_acct_org_number_unique UNIQUE (organization_id, account_number)
);

CREATE INDEX IF NOT EXISTS idx_sacco_savings_acct_member ON public.sacco_member_savings_accounts (sacco_member_id);
CREATE INDEX IF NOT EXISTS idx_sacco_savings_acct_org ON public.sacco_member_savings_accounts (organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS sacco_savings_acct_member_product_unique
  ON public.sacco_member_savings_accounts (sacco_member_id, savings_product_code);

DROP TRIGGER IF EXISTS trg_set_org_sacco_savings_acct ON public.sacco_member_savings_accounts;
CREATE TRIGGER trg_set_org_sacco_savings_acct
BEFORE INSERT ON public.sacco_member_savings_accounts
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

CREATE OR REPLACE FUNCTION public.touch_sacco_savings_acct_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_sacco_savings_acct_touch ON public.sacco_member_savings_accounts;
CREATE TRIGGER trg_sacco_savings_acct_touch
BEFORE UPDATE ON public.sacco_member_savings_accounts
FOR EACH ROW EXECUTE FUNCTION public.touch_sacco_savings_acct_updated_at();

ALTER TABLE public.sacco_member_savings_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sacco_savings_acct_org" ON public.sacco_member_savings_accounts;
CREATE POLICY "sacco_savings_acct_org"
  ON public.sacco_member_savings_accounts FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_member_savings_accounts TO authenticated;
GRANT ALL ON public.sacco_member_savings_accounts TO service_role;

COMMENT ON TABLE public.sacco_member_savings_accounts IS 'Per-member savings product accounts; account_number follows sacco_account_number_settings.';
