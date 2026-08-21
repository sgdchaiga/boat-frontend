-- Add frequently used school expense accounts to the standard chart.
-- Existing and administrator-created accounts are preserved.

CREATE OR REPLACE FUNCTION public.seed_school_regular_expense_accounts(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_id uuid;
  r record;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id is required';
  END IF;

  SELECT id INTO v_parent_id
  FROM public.gl_accounts
  WHERE organization_id = p_organization_id AND account_code = '6000'
  LIMIT 1;

  FOR r IN
    SELECT * FROM (VALUES
      ('6130','Teaching Staff Salaries and Wages'),
      ('6140','Casual Labour and Temporary Staff'),
      ('6150','Staff Medical and Health Costs'),
      ('6160','Recruitment and Staff Development'),
      ('6170','Staff Uniforms and Protective Wear'),
      ('6260','Software, Cloud Services and IT Support'),
      ('6270','Postage, Courier and Delivery'),
      ('6280','Board, Governance and Meeting Expenses'),
      ('6350','Grounds, Gardening and Compound Maintenance'),
      ('6360','Student Meals and School Feeding'),
      ('6370','Textbooks, Teaching and Learning Materials'),
      ('6380','Laboratory and Practical Supplies'),
      ('6390','Examinations and Assessment Materials'),
      ('6430','Computer and ICT Repairs'),
      ('6520','School Bus Running Costs'),
      ('6530','Field Trips and Educational Visits'),
      ('6610','School Events and Functions'),
      ('6620','Sports, Games and Recreation'),
      ('6630','Clubs and Co-curricular Activities'),
      ('6640','Student Welfare, Medical and First Aid'),
      ('6650','Scholarships, Bursaries and Fee Support'),
      ('6660','Sanitary and Hygiene Supplies'),
      ('6920','Emergency and Contingency Expenses')
    ) AS x(account_code, account_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.gl_accounts
      WHERE organization_id = p_organization_id AND account_code = r.account_code
    ) THEN
      INSERT INTO public.gl_accounts(
        id, organization_id, account_code, account_name, account_type,
        category, parent_id, is_active, business_type
      ) VALUES (
        gen_random_uuid(), p_organization_id, r.account_code, r.account_name,
        'expense', 'expense', v_parent_id, true, 'school'
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_school_regular_expense_accounts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_school_regular_expense_accounts(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.seed_school_regular_expenses_on_organization_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(COALESCE(NEW.business_type, '')) = 'school' THEN
    PERFORM public.seed_school_regular_expense_accounts(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organizations_school_regular_expenses ON public.organizations;
CREATE TRIGGER trg_organizations_school_regular_expenses
AFTER INSERT OR UPDATE OF business_type ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.seed_school_regular_expenses_on_organization_change();

DO $$
DECLARE school_org record;
BEGIN
  FOR school_org IN
    SELECT id FROM public.organizations WHERE lower(COALESCE(business_type, '')) = 'school'
  LOOP
    PERFORM public.seed_school_regular_expense_accounts(school_org.id);
  END LOOP;
END $$;

COMMENT ON FUNCTION public.seed_school_regular_expense_accounts(uuid) IS
  'Adds the frequently used school expense accounts without changing custom chart entries.';
