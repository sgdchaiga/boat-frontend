-- A scheduled-use rule must name the P&L account that receives consumption.
ALTER TABLE public.school_inventory_consumption_rules
  ADD COLUMN IF NOT EXISTS expense_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE RESTRICT;

ALTER TABLE public.school_inventory_consumption_review_lines
  ADD COLUMN IF NOT EXISTS expense_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.create_school_inventory_consumption_review(
  p_period_start date,
  p_period_end date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_review_id uuid;
  v_source_id uuid := gen_random_uuid();
  v_rule record;
  v_days numeric;
  v_expected numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_org := public.auth_organization_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'No active organization — switch organization and try again'; END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Choose a valid start and end date';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.school_inventory_consumption_rules
    WHERE organization_id = v_org AND active = true AND expense_gl_account_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Configure an expense account for every active consumption rate before posting a period';
  END IF;

  v_days := (p_period_end - p_period_start) + 1;
  INSERT INTO public.school_inventory_consumption_reviews (
    organization_id, period_start, period_end, auto_consumption_source_id, created_by
  ) VALUES (v_org, p_period_start, p_period_end, v_source_id, auth.uid())
  RETURNING id INTO v_review_id;

  FOR v_rule IN
    SELECT r.*
    FROM public.school_inventory_consumption_rules r
    JOIN public.products p ON p.id = r.product_id AND p.organization_id = r.organization_id
    WHERE r.organization_id = v_org AND r.active = true AND coalesce(p.track_inventory, true) = true
  LOOP
    v_expected := round(v_rule.quantity_per_cycle * v_days /
      CASE v_rule.cadence WHEN 'daily' THEN 1 WHEN 'weekly' THEN 7 ELSE 30.4375 END, 3);
    IF v_expected <= 0 THEN CONTINUE; END IF;

    INSERT INTO public.school_inventory_consumption_review_lines (
      review_id, organization_id, rule_id, product_id, expected_quantity, expense_gl_account_id
    ) VALUES (v_review_id, v_org, v_rule.id, v_rule.product_id, v_expected, v_rule.expense_gl_account_id);

    INSERT INTO public.product_stock_movements (
      organization_id, product_id, movement_date, source_type, source_id,
      quantity_in, quantity_out, unit_cost, note
    ) VALUES (
      v_org, v_rule.product_id, (p_period_end::text || 'T12:00:00Z')::timestamptz,
      'adjustment', v_source_id, 0, v_expected, null,
      'Scheduled school use | [MOVEMENT_TYPE:consumption] [PL_GL:' || v_rule.expense_gl_account_id || '] [SCHOOL_CONSUMPTION_REVIEW:' || v_review_id || ']'
    );
  END LOOP;
  RETURN v_review_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_school_inventory_consumption_review(
  p_review_id uuid,
  p_actuals jsonb,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_review public.school_inventory_consumption_reviews%ROWTYPE;
  v_line record;
  v_actual numeric;
  v_variance numeric;
  v_source_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_org := public.auth_organization_id();
  SELECT * INTO v_review FROM public.school_inventory_consumption_reviews
    WHERE id = p_review_id AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consumption review was not found'; END IF;
  IF v_review.status <> 'open' THEN RAISE EXCEPTION 'This consumption review has already been posted'; END IF;

  FOR v_line IN SELECT * FROM public.school_inventory_consumption_review_lines WHERE review_id = p_review_id
  LOOP
    SELECT nullif(value->>'actual_quantity', '')::numeric INTO v_actual
    FROM jsonb_array_elements(coalesce(p_actuals, '[]'::jsonb)) value
    WHERE (value->>'line_id')::uuid = v_line.id LIMIT 1;
    IF v_actual IS NULL OR v_actual < 0 THEN
      RAISE EXCEPTION 'Enter a non-negative actual quantity for every item';
    END IF;
    IF v_line.expense_gl_account_id IS NULL THEN
      RAISE EXCEPTION 'Each consumption line needs a configured expense account before it can be posted';
    END IF;
    v_variance := round(v_actual - v_line.expected_quantity, 3);
    UPDATE public.school_inventory_consumption_review_lines
      SET actual_quantity = v_actual, variance_quantity = v_variance
      WHERE id = v_line.id;

    IF abs(v_variance) >= 0.0005 THEN
      INSERT INTO public.product_stock_movements (
        organization_id, product_id, movement_date, source_type, source_id,
        quantity_in, quantity_out, unit_cost, note
      ) VALUES (
        v_org, v_line.product_id, (v_review.period_end::text || 'T12:00:00Z')::timestamptz,
        'adjustment', v_source_id,
        CASE WHEN v_variance < 0 THEN abs(v_variance) ELSE 0 END,
        CASE WHEN v_variance > 0 THEN v_variance ELSE 0 END,
        null,
        'Actual consumption adjustment | [MOVEMENT_TYPE:consumption] [PL_GL:' || v_line.expense_gl_account_id || '] [SCHOOL_CONSUMPTION_REVIEW:' || p_review_id || ']'
      );
    END IF;
  END LOOP;

  UPDATE public.school_inventory_consumption_reviews
    SET status = 'posted', variance_source_id = v_source_id, review_note = nullif(trim(p_note), ''),
        reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = p_review_id;
  RETURN v_source_id;
END;
$$;

COMMENT ON COLUMN public.school_inventory_consumption_rules.expense_gl_account_id IS
  'Profit-and-loss expense account debited when the scheduled stock use is posted.';
COMMENT ON COLUMN public.school_inventory_consumption_review_lines.expense_gl_account_id IS
  'Expense account snapshotted from the rate rule for the period review and its variance.';
