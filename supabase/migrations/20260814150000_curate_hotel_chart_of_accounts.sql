-- Keep hotel charts focused on the chart configured by each organization plus
-- hotel-relevant standard additions. Never delete accounts: unused unrelated
-- template accounts are made inactive, while posted accounts remain visible so
-- historical reports and drill-downs are preserved.

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
  SELECT lower(COALESCE(NULLIF(trim(p_business_type), ''), business_type, 'other'))
    INTO bt
  FROM public.organizations
  WHERE id = p_organization_id;

  IF bt IS NULL THEN RAISE EXCEPTION 'Organization not found'; END IF;

  hidden_codes := CASE
    WHEN bt = 'manufacturing' THEN ARRAY[]::text[]
    WHEN bt IN ('hotel', 'hospitality') THEN ARRAY[
      -- Manufacturing-only inventory and property.
      '1170', '1171', '1172', '1176', '1250',
      -- School and clinic revenue.
      '4130', '4150',
      -- Manufacturing-only revenue and cost of sales.
      '4161', '4162',
      '5130', '5131', '5132', '5133', '5134', '5135', '5136',
      -- Factory-only overheads.
      '6800', '6810', '6811', '6812', '6813', '6814', '6815', '6816',
      '6817', '6818', '6819'
    ]
    ELSE ARRAY[
      '1170', '1171', '1172', '1173', '1174', '1175', '1176', '1250',
      '4161', '4162',
      '5130', '5131', '5132', '5133', '5134', '5135', '5136',
      '6800', '6810', '6811', '6812', '6813', '6814', '6815', '6816',
      '6817', '6818', '6819'
    ]
  END;

  IF cardinality(hidden_codes) = 0 THEN RETURN; END IF;

  UPDATE public.gl_accounts ga
  SET is_active = false
  WHERE ga.organization_id = p_organization_id
    AND ga.account_code = ANY(hidden_codes)
    AND ga.is_active = true
    AND NOT EXISTS (
      WITH RECURSIVE account_tree AS (
        SELECT ga.id
        UNION ALL
        SELECT child.id
        FROM public.gl_accounts child
        JOIN account_tree parent_account ON child.parent_id = parent_account.id
      )
      SELECT 1
      FROM account_tree account_node
      JOIN public.journal_entry_lines jel ON jel.gl_account_id = account_node.id
    );
END;
$$;

COMMENT ON FUNCTION public.apply_business_type_gl_account_visibility(uuid, text) IS
  'Keeps each organization chart plus relevant business-type additions; disables only unused unrelated standard-template accounts.';

-- Apply the curated chart to every existing hotel. Mixed businesses are not
-- narrowed because their additional lines of business are intentional.
DO $$
DECLARE org record;
BEGIN
  FOR org IN
    SELECT id, business_type
    FROM public.organizations
    WHERE lower(COALESCE(business_type, '')) IN ('hotel', 'hospitality')
  LOOP
    PERFORM public.apply_business_type_gl_account_visibility(org.id, org.business_type);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.apply_business_type_gl_account_visibility(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_business_type_gl_account_visibility(uuid, text) TO service_role;
