-- Keep the standard chart relevant to the organization's line of business.
-- Accounts that have already been posted are deliberately left active so historical
-- journals and reports remain intact; only unused template accounts are disabled.

CREATE OR REPLACE FUNCTION public.apply_business_type_gl_account_visibility(
  p_organization_id uuid,
  p_business_type text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bt text;
  hidden_codes text[];
BEGIN
  SELECT lower(COALESCE(p_business_type, business_type, 'other'))
    INTO bt
  FROM public.organizations
  WHERE id = p_organization_id;

  IF bt IS NULL THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  -- Manufacturing inventory, revenue, COGS and factory-overhead accounts are
  -- never generic hotel (or other non-manufacturing) accounts.
  hidden_codes := CASE
    WHEN bt = 'manufacturing' THEN ARRAY[]::text[]
    ELSE ARRAY[
      '1170', '1171', '1172', '1173', '1174', '1175', '1176', '1250',
      '4161', '4162',
      '5130', '5131', '5132', '5133', '5134', '5135', '5136',
      '6800', '6810', '6811', '6812', '6813', '6814', '6815', '6816',
      '6817', '6818', '6819'
    ]
  END;

  IF cardinality(hidden_codes) = 0 THEN
    RETURN;
  END IF;

  UPDATE public.gl_accounts ga
  SET is_active = false
  WHERE ga.organization_id = p_organization_id
    AND ga.account_code = ANY(hidden_codes)
    AND ga.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.journal_entry_lines jel
      WHERE jel.gl_account_id = ga.id
    );
END;
$$;

COMMENT ON FUNCTION public.apply_business_type_gl_account_visibility(uuid, text) IS
  'Disables unused standard-template GL accounts that do not apply to an organization business type.';

CREATE OR REPLACE FUNCTION public.apply_business_type_gl_account_visibility_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.apply_business_type_gl_account_visibility(NEW.id, NEW.business_type);
  RETURN NEW;
END;
$$;

-- Alphabetical trigger firing order makes this run after trg_organizations_standard_setup.
DROP TRIGGER IF EXISTS zz_trg_organizations_business_type_gl_visibility ON public.organizations;
CREATE TRIGGER zz_trg_organizations_business_type_gl_visibility
AFTER INSERT OR UPDATE OF business_type ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.apply_business_type_gl_account_visibility_trigger();

DO $$
DECLARE org record;
BEGIN
  FOR org IN SELECT id, business_type FROM public.organizations LOOP
    PERFORM public.apply_business_type_gl_account_visibility(org.id, org.business_type);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.apply_business_type_gl_account_visibility(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_business_type_gl_account_visibility(uuid, text) TO service_role;
