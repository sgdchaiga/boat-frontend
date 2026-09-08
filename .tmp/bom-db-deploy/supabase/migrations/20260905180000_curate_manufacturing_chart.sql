-- Deactivate unused unrelated template accounts, without deleting journal history.
CREATE OR REPLACE FUNCTION public.curate_manufacturing_chart_of_accounts(p_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE changed_count integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_organization_id AND lower(business_type) = 'manufacturing') THEN
    RETURN 0;
  END IF;

  UPDATE public.gl_accounts ga
  SET is_active = false
  WHERE ga.organization_id = p_organization_id
    AND ga.is_active = true
    AND ga.account_name ~* (
      '\m(hotel|guest|rooms? (revenue|charges?|income)|accommodation|housekeeping|sauna|' ||
      '(bar|kitchen|restaurant|food|beverage|food[[:space:]]*(&|and)[[:space:]]*beverage) (pos|sales|revenue|income|inventory|cost of sales|equipment)|' ||
      'inventory[[:space:]]*[-–—][[:space:]]*(bar|kitchen)|conference[[:space:]]*(&|and)[[:space:]]*events income|' ||
      'laundry (income|revenue)|clinic|patient|consultation|laboratory|medical (service|revenue|fees|supplies|inventory)|pharmacy|dispensary|' ||
      'school|student|tuition|bursary|term fees?|sacco|vsla|microfinance|loan portfolio|loan principal receivable|' ||
      'borrower|member savings|share[- ]?out|teller vault)\M'
    )
    AND NOT EXISTS (
      WITH RECURSIVE account_tree AS (
        SELECT ga.id
        UNION
        SELECT child.id FROM public.gl_accounts child
        JOIN account_tree parent_account ON child.parent_id = parent_account.id
        WHERE child.organization_id = p_organization_id
      )
      SELECT 1 FROM account_tree account_node
      JOIN public.journal_entry_lines jel ON jel.gl_account_id = account_node.id
    );
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  RETURN changed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.curate_manufacturing_chart_of_accounts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.curate_manufacturing_chart_of_accounts(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.curate_manufacturing_chart_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.curate_manufacturing_chart_of_accounts(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.curate_manufacturing_chart_trigger() FROM PUBLIC;

-- Run after the shared standard setup has inserted its template accounts.
DROP TRIGGER IF EXISTS zzz_trg_manufacturing_chart ON public.organizations;
CREATE TRIGGER zzz_trg_manufacturing_chart
AFTER INSERT OR UPDATE OF business_type ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.curate_manufacturing_chart_trigger();

DO $$
DECLARE org record;
BEGIN
  FOR org IN SELECT id FROM public.organizations WHERE lower(business_type) = 'manufacturing' LOOP
    PERFORM public.curate_manufacturing_chart_of_accounts(org.id);
  END LOOP;
END;
$$;
