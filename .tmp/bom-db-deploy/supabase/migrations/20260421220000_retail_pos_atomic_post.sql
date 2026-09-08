-- Atomic retail POS posting: sale header, lines, split payments, stock, and journal in one transaction.

CREATE OR REPLACE FUNCTION public.post_retail_sale_atomic(
  p_sale_id uuid,
  p_organization_id uuid,
  p_created_by uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_total_amount numeric,
  p_amount_paid numeric,
  p_amount_due numeric,
  p_change_amount numeric,
  p_payment_status text,
  p_vat_enabled boolean,
  p_vat_rate numeric,
  p_cashier_session_id uuid,
  p_lines jsonb,
  p_payments jsonb,
  p_journal_entry_date date,
  p_journal_description text,
  p_journal_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_line jsonb;
  v_pay jsonb;
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'sale id is required';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization id is required';
  END IF;
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'at least one sale line is required';
  END IF;
  IF p_payments IS NULL OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'at least one payment line is required';
  END IF;

  SELECT rs.id
  INTO v_existing
  FROM public.retail_sales rs
  WHERE rs.organization_id = p_organization_id
    AND rs.idempotency_key = p_sale_id::text
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.retail_sales (
    id,
    organization_id,
    sale_at,
    idempotency_key,
    customer_id,
    customer_name,
    customer_phone,
    total_amount,
    amount_paid,
    amount_due,
    change_amount,
    payment_status,
    vat_enabled,
    vat_rate,
    created_by,
    cashier_session_id
  ) VALUES (
    p_sale_id,
    p_organization_id,
    now(),
    p_sale_id::text,
    p_customer_id,
    NULLIF(trim(coalesce(p_customer_name, '')), ''),
    NULLIF(trim(coalesce(p_customer_phone, '')), ''),
    coalesce(p_total_amount, 0),
    coalesce(p_amount_paid, 0),
    coalesce(p_amount_due, 0),
    coalesce(p_change_amount, 0),
    coalesce(p_payment_status, 'pending'),
    coalesce(p_vat_enabled, false),
    p_vat_rate,
    p_created_by,
    p_cashier_session_id
  );

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO public.retail_sale_lines (
      sale_id,
      line_no,
      product_id,
      description,
      quantity,
      unit_price,
      line_total,
      unit_cost,
      department_id,
      track_inventory
    ) VALUES (
      p_sale_id,
      coalesce((v_line->>'line_no')::int, 1),
      (v_line->>'product_id')::uuid,
      coalesce(v_line->>'description', ''),
      coalesce((v_line->>'quantity')::numeric, 0),
      coalesce((v_line->>'unit_price')::numeric, 0),
      coalesce((v_line->>'line_total')::numeric, 0),
      nullif(v_line->>'unit_cost', '')::numeric,
      nullif(v_line->>'department_id', '')::uuid,
      coalesce((v_line->>'track_inventory')::boolean, true)
    );

    IF coalesce((v_line->>'track_inventory')::boolean, true) THEN
      INSERT INTO public.product_stock_movements (
        product_id,
        source_type,
        source_id,
        quantity_in,
        quantity_out,
        unit_cost,
        note,
        organization_id
      ) VALUES (
        (v_line->>'product_id')::uuid,
        'sale',
        p_sale_id,
        0,
        coalesce((v_line->>'quantity')::numeric, 0),
        nullif(v_line->>'unit_cost', '')::numeric,
        'Retail POS sale',
        p_organization_id
      );
    END IF;
  END LOOP;

  FOR v_pay IN SELECT value FROM jsonb_array_elements(p_payments)
  LOOP
    INSERT INTO public.retail_sale_payments (
      sale_id,
      payment_method,
      amount,
      payment_status
    ) VALUES (
      p_sale_id,
      coalesce(v_pay->>'method', 'cash'),
      coalesce((v_pay->>'amount')::numeric, 0),
      coalesce(v_pay->>'status', 'pending')
    );

    INSERT INTO public.payments (
      stay_id,
      organization_id,
      retail_customer_id,
      payment_source,
      amount,
      payment_method,
      payment_status,
      transaction_id,
      processed_by,
      source_documents
    ) VALUES (
      null,
      p_organization_id,
      p_customer_id,
      'pos_retail',
      coalesce((v_pay->>'amount')::numeric, 0),
      coalesce(v_pay->>'method', 'cash'),
      coalesce(v_pay->>'status', 'pending'),
      p_sale_id::text,
      p_created_by,
      jsonb_build_object(
        'sale_total', coalesce(p_total_amount, 0),
        'payment_status', coalesce(p_payment_status, 'pending'),
        'amount_paid', coalesce(p_amount_paid, 0),
        'amount_due', coalesce(p_amount_due, 0),
        'customer_name', nullif(trim(coalesce(p_customer_name, '')), ''),
        'customer_phone', nullif(trim(coalesce(p_customer_phone, '')), ''),
        'cashier_session_id', p_cashier_session_id
      )
    );
  END LOOP;

  IF p_journal_lines IS NOT NULL AND jsonb_array_length(p_journal_lines) > 1 THEN
    PERFORM public.create_journal_entry_atomic(
      p_entry_date => coalesce(p_journal_entry_date, current_date),
      p_description => coalesce(nullif(trim(coalesce(p_journal_description, '')), ''), 'POS: Retail POS sale'),
      p_reference_type => 'pos',
      p_reference_id => p_sale_id,
      p_created_by => p_created_by,
      p_lines => p_journal_lines,
      p_organization_id => p_organization_id
    );
  END IF;

  RETURN p_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION public.post_retail_sale_atomic(
  uuid, uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, boolean, numeric, uuid, jsonb, jsonb, date, text, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.post_retail_sale_atomic(
  uuid, uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, boolean, numeric, uuid, jsonb, jsonb, date, text, jsonb
) TO authenticated;

COMMENT ON FUNCTION public.post_retail_sale_atomic(
  uuid, uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, boolean, numeric, uuid, jsonb, jsonb, date, text, jsonb
) IS 'Atomic retail sale post: retail_sales + lines + split payments + stock movements + journal.';
