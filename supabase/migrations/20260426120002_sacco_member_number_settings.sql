-- Per-organization format for savings *account* numbers (branch / account type / serial).
-- Member register uses simple sequential member_number (1, 2, 3…) — see app logic.

CREATE TABLE IF NOT EXISTS public.sacco_account_number_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_digit_count int NOT NULL DEFAULT 2
    CHECK (branch_digit_count >= 1 AND branch_digit_count <= 12),
  account_type_digit_count int NOT NULL DEFAULT 2
    CHECK (account_type_digit_count >= 1 AND account_type_digit_count <= 12),
  serial_digit_count int NOT NULL DEFAULT 5
    CHECK (serial_digit_count >= 1 AND serial_digit_count <= 12),
  branch_value text NOT NULL DEFAULT '1',
  account_type_value text NOT NULL DEFAULT '1',
  separator text NOT NULL DEFAULT '-',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.touch_sacco_account_number_settings_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_sacco_account_number_settings_touch ON public.sacco_account_number_settings;
CREATE TRIGGER trg_sacco_account_number_settings_touch
BEFORE UPDATE ON public.sacco_account_number_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_sacco_account_number_settings_updated_at();

ALTER TABLE public.sacco_account_number_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sacco_account_num_settings_org" ON public.sacco_account_number_settings;
CREATE POLICY "sacco_account_num_settings_org"
  ON public.sacco_account_number_settings FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_account_number_settings TO authenticated;
GRANT ALL ON public.sacco_account_number_settings TO service_role;

COMMENT ON TABLE public.sacco_account_number_settings IS 'Savings account number format: branch + account type (product) + serial; not used for member ID.';
