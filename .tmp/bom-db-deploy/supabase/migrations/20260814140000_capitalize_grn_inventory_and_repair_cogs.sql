-- BOAT uses perpetual inventory: item receipts capitalize stock; COGS is
-- recognized only when stock is sold or otherwise consumed.

CREATE OR REPLACE FUNCTION public.repair_po_bill_inventory_account_journals(p_organization_id uuid)
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
    SELECT je.id AS journal_id, b.purchase_order_id, b.amount
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
                OR dgs.stock_gl_account_id IS NULL
           ),
           COALESCE(sum(COALESCE(poi.quantity, 0) * COALESCE(poi.cost_price, 0)), 0)
      INTO invalid_count, source_total
    FROM public.purchase_order_items poi
    LEFT JOIN public.products p ON p.id = poi.product_id
    LEFT JOIN public.journal_gl_department_settings dgs
      ON dgs.organization_id = p_organization_id AND dgs.department_id = p.department_id
    WHERE poi.purchase_order_id = r.purchase_order_id;

    IF invalid_count > 0 OR source_total <= 0 THEN CONTINUE; END IF;

    bill_total := COALESCE(r.amount, 0);
    DELETE FROM public.journal_entry_lines
    WHERE journal_entry_id = r.journal_id AND debit > 0;

    INSERT INTO public.journal_entry_lines (
      id, journal_entry_id, gl_account_id, debit, credit, line_description, dimensions
    )
    WITH grouped AS (
      SELECT dgs.stock_gl_account_id AS gl_account_id,
             p.department_id,
             d.name AS department_name,
             sum(COALESCE(poi.quantity, 0) * COALESCE(poi.cost_price, 0)) AS raw_amount
      FROM public.purchase_order_items poi
      JOIN public.products p ON p.id = poi.product_id
      JOIN public.departments d ON d.id = p.department_id
      JOIN public.journal_gl_department_settings dgs
        ON dgs.organization_id = p_organization_id
       AND dgs.department_id = p.department_id
       AND dgs.stock_gl_account_id IS NOT NULL
      WHERE poi.purchase_order_id = r.purchase_order_id
      GROUP BY dgs.stock_gl_account_id, p.department_id, d.name
    ), scaled AS (
      SELECT *, row_number() OVER (ORDER BY department_id) AS rn,
             count(*) OVER () AS cnt,
             round(bill_total * raw_amount / source_total, 2) AS scaled_amount
      FROM grouped
    ), final AS (
      SELECT *, CASE WHEN rn = cnt
        THEN bill_total - COALESCE(sum(scaled_amount) OVER (ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)
        ELSE scaled_amount END AS amount
      FROM scaled
    )
    SELECT gen_random_uuid(), r.journal_id, gl_account_id, amount, 0,
           department_name || ' inventory (GRN)',
           jsonb_build_object('department_id', department_id)
    FROM final WHERE amount > 0;

    repaired := repaired + 1;
  END LOOP;
  RETURN repaired;
END;
$$;

GRANT EXECUTE ON FUNCTION public.repair_po_bill_inventory_account_journals(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_po_bill_inventory_account_journals(uuid) TO service_role;

-- Repair all organizations so historical GRNs no longer inflate COGS.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.organizations LOOP
    PERFORM public.repair_po_bill_inventory_account_journals(r.id);
  END LOOP;
END;
$$;

-- Safety audit: a stock increase may debit inventory, never a purchase/COGS
-- account. Existing adjustment journals are rebuilt by the application using
-- department stock mappings; flag any historical exception for administrators.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.journal_entries je
    JOIN public.journal_entry_lines jel ON jel.journal_entry_id = je.id
    JOIN public.gl_accounts ga ON ga.id = jel.gl_account_id
    WHERE je.reference_type = 'stock_adjustment'
      AND je.is_deleted = false AND je.is_posted = true
      AND jel.debit > 0
      AND lower(COALESCE(jel.line_description, '')) ~ '(surplus|purchase|receipt)'
      AND (ga.category = 'cogs' OR ga.account_type = 'expense')
  ) THEN
    RAISE WARNING 'Historical stock increases posted to expense/COGS exist; run the inventory movement journal repair from Accounting.';
  END IF;
END;
$$;
