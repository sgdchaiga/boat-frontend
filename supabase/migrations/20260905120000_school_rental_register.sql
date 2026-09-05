-- Monthly property charges use the normal customer invoices and payment allocations.
CREATE TABLE public.school_rental_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  tenant_id uuid REFERENCES public.retail_customers(id),
  monthly_rent numeric(15,2) NOT NULL CHECK (monthly_rent > 0),
  due_day integer NOT NULL DEFAULT 1 CHECK (due_day BETWEEN 1 AND 28),
  revenue_account_id uuid NOT NULL REFERENCES public.gl_accounts(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
ALTER TABLE public.school_rental_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_rental_properties_org ON public.school_rental_properties
  FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()))
  WITH CHECK (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()));
GRANT SELECT, INSERT, UPDATE ON public.school_rental_properties TO authenticated;

CREATE FUNCTION public.validate_school_rental_property() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.retail_customers WHERE id = NEW.tenant_id AND organization_id = NEW.organization_id
  ) THEN RAISE EXCEPTION 'Tenant must belong to this school'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gl_accounts WHERE id = NEW.revenue_account_id
    AND organization_id = NEW.organization_id AND is_active AND account_type IN ('income', 'revenue'))
  THEN RAISE EXCEPTION 'Select an active rental income account belonging to this school'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER school_rental_property_validate BEFORE INSERT OR UPDATE ON public.school_rental_properties
  FOR EACH ROW EXECUTE FUNCTION public.validate_school_rental_property();

ALTER TABLE public.retail_invoices
  ADD COLUMN rental_property_id uuid REFERENCES public.school_rental_properties(id),
  ADD COLUMN rental_month date;
ALTER TABLE public.retail_invoices ADD CONSTRAINT rental_invoice_month_check CHECK (
  (rental_property_id IS NULL AND rental_month IS NULL) OR
  (rental_property_id IS NOT NULL AND rental_month IS NOT NULL AND extract(day FROM rental_month) = 1)
);
CREATE UNIQUE INDEX school_rental_invoice_month_unique
  ON public.retail_invoices (organization_id, rental_property_id, rental_month)
  WHERE rental_property_id IS NOT NULL;

CREATE FUNCTION public.charge_school_rental_month(p_property_id uuid, p_month date, p_amount numeric)
RETURNS public.retail_invoices LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
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
END; $$;
REVOKE ALL ON FUNCTION public.charge_school_rental_month(uuid, date, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.charge_school_rental_month(uuid, date, numeric) TO authenticated;

-- Issued rent is an accounting document: property/tenant setup changes must not rewrite its history.
CREATE FUNCTION public.protect_school_rental_invoice() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.rental_property_id IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Issued rental invoices cannot be deleted'; END IF;
    IF (NEW.organization_id, NEW.rental_property_id, NEW.rental_month, NEW.customer_id, NEW.customer_name,
        NEW.total, NEW.subtotal, NEW.tax_amount, NEW.issue_date, NEW.invoice_number)
      IS DISTINCT FROM
       (OLD.organization_id, OLD.rental_property_id, OLD.rental_month, OLD.customer_id, OLD.customer_name,
        OLD.total, OLD.subtotal, OLD.tax_amount, OLD.issue_date, OLD.invoice_number)
      OR NEW.status NOT IN ('sent', 'paid') THEN
      RAISE EXCEPTION 'Issued rental charges cannot be changed; use an accounting adjustment for corrections';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER school_rental_invoice_protect BEFORE UPDATE OR DELETE ON public.retail_invoices
  FOR EACH ROW EXECUTE FUNCTION public.protect_school_rental_invoice();
