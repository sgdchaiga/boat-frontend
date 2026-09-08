
DECLARE
  v_property public.school_rental_properties;
  v_invoice public.retail_invoices;
  v_customer public.retail_customers;
  v_org uuid;
  v_receivable uuid;
  v_amount numeric(15,2);
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id = auth.uid();
  IF v_org IS NULL THEN RAISE EXCEPTION 'Sign in to your school before charging rent'; END IF;
  IF p_month IS NULL OR extract(day FROM p_month) <> 1 THEN RAISE EXCEPTION 'Select a valid rental month'; END IF;
  IF p_amount IS NULL OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Monthly charge must be positive';
  END IF;
  v_amount := round(p_amount, 2);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Monthly charge must be positive'; END IF;
  -- Serializes simultaneous requests for the same property; retries return the same invoice.
  SELECT * INTO v_property FROM public.school_rental_properties
    WHERE id = p_property_id AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Property not found in this school'; END IF;
  SELECT * INTO v_invoice FROM public.retail_invoices
    WHERE organization_id = v_org AND rental_property_id = p_property_id AND rental_month = p_month;
  IF FOUND THEN RETURN v_invoice; END IF;
  IF NOT v_property.is_active OR v_property.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Only active properties with a tenant can be charged';
  END IF;
  SELECT * INTO v_customer FROM public.retail_customers WHERE id = v_property.tenant_id AND organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tenant not found'; END IF;
  SELECT receivable_id INTO v_receivable FROM public.journal_gl_settings WHERE organization_id = v_org;
  IF v_receivable IS NULL OR NOT EXISTS (SELECT 1 FROM public.gl_accounts WHERE id = v_receivable
    AND organization_id = v_org AND is_active AND account_type = 'asset') THEN
    RAISE EXCEPTION 'Configure an active receivable account in Journal account settings before charging rent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gl_accounts WHERE id = v_property.revenue_account_id
    AND organization_id = v_org AND is_active AND account_type IN ('income', 'revenue')) THEN
    RAISE EXCEPTION 'The property rental income account is no longer active';
  END IF;
  INSERT INTO public.retail_invoices (organization_id, invoice_number, customer_id, customer_name,
    customer_email, customer_address, issue_date, due_date, status, subtotal, total, created_by,
    rental_property_id, rental_month, notes)
  VALUES (v_org, 'RENT-' || to_char(p_month, 'YYYYMM') || '-' || p_property_id::text,
    v_customer.id, v_customer.name, v_customer.email, v_customer.address, p_month,
    p_month + (v_property.due_day - 1), 'sent', v_amount, v_amount, auth.uid(),
    p_property_id, p_month, 'Monthly rent: ' || v_property.name || ' · ' || to_char(p_month, 'FMMonth YYYY'))
  RETURNING * INTO v_invoice;
  INSERT INTO public.retail_invoice_lines (invoice_id, line_no, description, quantity, unit_price, line_total)
    VALUES (v_invoice.id, 1, 'Rent: ' || v_property.name || ' · ' || to_char(p_month, 'FMMonth YYYY'), 1, v_amount, v_amount);
  -- Invoice and accrual are committed together. Normal debtor receipts settle this receivable.
  PERFORM public.create_journal_entry_atomic(p_month, v_invoice.notes, 'school_rental_invoice',
    v_invoice.id, auth.uid(), jsonb_build_array(
      jsonb_build_object('gl_account_id', v_receivable, 'debit', v_amount, 'credit', 0, 'line_description', v_customer.name),
      jsonb_build_object('gl_account_id', v_property.revenue_account_id, 'debit', 0, 'credit', v_amount, 'line_description', v_property.name)
    ), v_org);
  RETURN v_invoice;
END; 