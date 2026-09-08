-- Route every product-linked PO/GRN debit to the product department's purchase
-- account. Generic inventory and expense defaults are only for transactions
-- that genuinely have no item/department context.

CREATE OR REPLACE FUNCTION public.repair_po_bill_purchase_account_journals(p_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  repaired integer := 0;
  source_total numeric;
  bill_total numeric;
  invalid_count integer;
BEGIN
  IF p_organization_id IS NULL THEN RAISE EXCEPTION 'organization_id is required'; END IF;
  IF auth.uid() IS NOT NULL
     AND public.auth_organization_id() IS DISTINCT FROM p_organization_id
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR r IN
    SELECT je.id AS journal_id, b.id AS bill_id, b.purchase_order_id, b.amount
    FROM public.journal_entries je
    JOIN public.bills b ON b.id = je.reference_id
    WHERE je.organization_id = p_organization_id
      AND je.reference_type = 'bill'
      AND je.is_deleted = false
      AND je.is_posted = true
      AND b.purchase_order_id IS NOT NULL
  LOOP
    SELECT count(*) FILTER (
             WHERE poi.product_id IS NULL
                OR p.id IS NULL
                OR p.department_id IS NULL
                OR dgs.purchases_gl_account_id IS NULL
           ),
           COALESCE(sum(COALESCE(poi.quantity, 0) * COALESCE(poi.cost_price, 0)), 0)
      INTO invalid_count, source_total
    FROM public.purchase_order_items poi
    LEFT JOIN public.products p ON p.id = poi.product_id
    LEFT JOIN public.journal_gl_department_settings dgs
      ON dgs.organization_id = p_organization_id AND dgs.department_id = p.department_id
    WHERE poi.purchase_order_id = r.purchase_order_id;

    IF invalid_count > 0 OR source_total <= 0 THEN
      CONTINUE;
    END IF;

    bill_total := COALESCE(r.amount, 0);
    DELETE FROM public.journal_entry_lines
    WHERE journal_entry_id = r.journal_id AND debit > 0;

    INSERT INTO public.journal_entry_lines (
      id, journal_entry_id, gl_account_id, debit, credit, line_description, dimensions
    )
    WITH grouped AS (
      SELECT dgs.purchases_gl_account_id AS gl_account_id,
             p.department_id,
             d.name AS department_name,
             sum(COALESCE(poi.quantity, 0) * COALESCE(poi.cost_price, 0)) AS raw_amount
      FROM public.purchase_order_items poi
      JOIN public.products p ON p.id = poi.product_id
      JOIN public.departments d ON d.id = p.department_id
      JOIN public.journal_gl_department_settings dgs
        ON dgs.organization_id = p_organization_id
       AND dgs.department_id = p.department_id
       AND dgs.purchases_gl_account_id IS NOT NULL
      WHERE poi.purchase_order_id = r.purchase_order_id
      GROUP BY dgs.purchases_gl_account_id, p.department_id, d.name
    ), scaled AS (
      SELECT *,
             row_number() OVER (ORDER BY department_id) AS rn,
             count(*) OVER () AS cnt,
             round(bill_total * raw_amount / source_total, 2) AS scaled_amount
      FROM grouped
    ), final AS (
      SELECT *,
             CASE WHEN rn = cnt
               THEN bill_total - COALESCE(sum(scaled_amount) OVER (ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)
               ELSE scaled_amount
             END AS amount
      FROM scaled
    )
    SELECT gen_random_uuid(), r.journal_id, gl_account_id, amount, 0,
           department_name || ' purchases (GRN)',
           jsonb_build_object('department_id', department_id)
    FROM final
    WHERE amount > 0;

    repaired := repaired + 1;
  END LOOP;
  RETURN repaired;
END;
$$;

GRANT EXECUTE ON FUNCTION public.repair_po_bill_purchase_account_journals(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_po_bill_purchase_account_journals(uuid) TO service_role;

-- Correct incomplete item masters in the affected hotel before rebuilding its
-- PO-linked bill journals.
DO $$
DECLARE
  v_org uuid;
  v_kitchen uuid;
  v_admin_expense uuid;
  v_generic_opex uuid;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE name = 'TTIMMS Hotel' LIMIT 1;
  IF v_org IS NULL THEN RETURN; END IF;

  SELECT id INTO v_kitchen FROM public.departments
  WHERE organization_id = v_org AND lower(name) = 'kitchen' LIMIT 1;
  UPDATE public.products
  SET department_id = v_kitchen
  WHERE organization_id = v_org
    AND department_id IS NULL
    AND lower(name) IN ('bread', 'chill', 'honey');

  SELECT id INTO v_generic_opex FROM public.gl_accounts
  WHERE organization_id = v_org AND account_code = '6000' LIMIT 1;
  UPDATE public.journal_gl_settings s
  SET expense_gl_account_id = v_generic_opex, updated_at = now()
  FROM public.gl_accounts current_expense
  WHERE s.organization_id = v_org
    AND current_expense.id = s.expense_gl_account_id
    AND current_expense.account_code = '6100'
    AND lower(current_expense.account_name) LIKE '%personnel%';

  PERFORM public.repair_po_bill_purchase_account_journals(v_org);

  -- Review and reclassify the clearly identifiable manual administrative costs.
  UPDATE public.journal_entry_lines jel
  SET gl_account_id = target.id
  FROM public.journal_entries je
  JOIN public.gl_accounts target ON target.organization_id = je.organization_id
  WHERE jel.journal_entry_id = je.id
    AND je.organization_id = v_org
    AND je.reference_type = 'expense'
    AND je.is_deleted = false
    AND lower(COALESCE(jel.line_description, '')) = 'chef joseph'
    AND target.account_code = '6100';

  UPDATE public.journal_entry_lines jel
  SET gl_account_id = target.id
  FROM public.journal_entries je
  JOIN public.gl_accounts target ON target.organization_id = je.organization_id
  WHERE jel.journal_entry_id = je.id
    AND je.organization_id = v_org
    AND je.reference_type = 'expense'
    AND je.is_deleted = false
    AND target.account_code = CASE lower(COALESCE(jel.line_description, ''))
      WHEN 'jelly for sauna' THEN '5004'
      WHEN 'toilet paper' THEN '6422'
      WHEN 'bomba repair' THEN '6320'
      WHEN 'transport for town council' THEN '6411'
      WHEN 'millet for staff' THEN '6180'
    END
    AND lower(COALESCE(jel.line_description, '')) IN (
      'jelly for sauna', 'toilet paper', 'bomba repair',
      'transport for town council', 'millet for staff'
    );
END;
$$;
