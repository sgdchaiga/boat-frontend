-- Keep school charts focused on education operations. Unrelated template
-- accounts are never deleted because journal history must remain intact.

CREATE OR REPLACE FUNCTION public.curate_school_chart_of_accounts(p_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed_count integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = p_organization_id
      AND lower(COALESCE(business_type, '')) = 'school'
  ) THEN
    RAISE EXCEPTION 'Organization is not a school';
  END IF;

  -- Seed first so code collisions are converted to the canonical school name,
  -- type and business tag before unrelated accounts are assessed.
  PERFORM public.seed_school_chart_of_accounts(p_organization_id);
  PERFORM public.seed_school_regular_expense_accounts(p_organization_id);

  WITH unrelated AS (
    SELECT ga.id
    FROM public.gl_accounts ga
    WHERE ga.organization_id = p_organization_id
      AND ga.is_active = true
      AND lower(COALESCE(ga.business_type, '')) <> 'school'
      AND concat_ws(' ', ga.account_name, ga.category) ~* (
        'raw materials?|manufacturing|work in progress|finished goods|factory |production |' ||
        'cost of goods manufactured|scrap inventory|guest room|room revenue|housekeeping|' ||
        'bar sales|bar inventory|kitchen sales|restaurant sales|patient|pharmacy|laboratory revenue|' ||
        'loan portfolio|loan principal|borrower|member savings|share[- ]?out|teller vault'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entry_lines jel WHERE jel.gl_account_id = ga.id
      )
  )
  UPDATE public.gl_accounts ga
  SET is_active = false
  FROM unrelated
  WHERE ga.id = unrelated.id;

  GET DIAGNOSTICS changed_count = ROW_COUNT;
  RETURN changed_count;
END;
$$;

COMMENT ON FUNCTION public.curate_school_chart_of_accounts(uuid) IS
  'Seeds the canonical school chart and deactivates unused accounts belonging to unrelated industry templates.';

REVOKE ALL ON FUNCTION public.curate_school_chart_of_accounts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.curate_school_chart_of_accounts(uuid) TO service_role;

DO $$
DECLARE school_org record;
BEGIN
  FOR school_org IN
    SELECT id FROM public.organizations
    WHERE lower(COALESCE(business_type, '')) = 'school'
  LOOP
    PERFORM public.curate_school_chart_of_accounts(school_org.id);
  END LOOP;
END $$;
