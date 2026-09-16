-- A completed payroll payment settles the salary liability and reduces the
-- selected treasury account.  Keep this atomic so a checkbox cannot create
-- duplicate cash journals.
ALTER TABLE public.payroll_org_settings
  ADD COLUMN IF NOT EXISTS payroll_bank_payment_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payroll_mobile_money_payment_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payroll_cash_payment_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.payroll_payments
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.post_payroll_payment(
  p_payment_id uuid,
  p_payment_date date,
  p_payment_method text,
  p_payment_reference text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  p public.payroll_payments%ROWTYPE;
  s public.payroll_org_settings%ROWTYPE;
  cash_gl uuid;
  journal_id uuid;
  paid_at_value timestamptz;
BEGIN
  SELECT * INTO p FROM public.payroll_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll payment not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff WHERE id = auth.uid() AND organization_id = p.organization_id) THEN
    RAISE EXCEPTION 'Not authorized for this payroll payment';
  END IF;
  IF p.journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'This payroll payment is already posted to the ledger';
  END IF;
  IF p_payment_date IS NULL THEN RAISE EXCEPTION 'Payment date is required'; END IF;
  IF p_payment_method NOT IN ('bank','mobile_money','cash') THEN RAISE EXCEPTION 'Choose Bank, Mobile money, or Cash'; END IF;
  SELECT * INTO s FROM public.payroll_org_settings WHERE organization_id = p.organization_id;
  IF s.salaries_payable_gl_account_id IS NULL THEN RAISE EXCEPTION 'Configure Salaries payable in Payroll settings'; END IF;
  cash_gl := CASE p_payment_method
    WHEN 'bank' THEN s.payroll_bank_payment_gl_account_id
    WHEN 'mobile_money' THEN s.payroll_mobile_money_payment_gl_account_id
    ELSE s.payroll_cash_payment_gl_account_id
  END;
  IF cash_gl IS NULL THEN RAISE EXCEPTION 'Configure the payroll % payment account in Payroll settings', replace(p_payment_method, '_', ' '); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gl_accounts WHERE id = cash_gl AND organization_id = p.organization_id AND is_active) THEN
    RAISE EXCEPTION 'The selected payroll payment account is inactive or unavailable';
  END IF;
  paid_at_value := p_payment_date::timestamp AT TIME ZONE 'Africa/Kampala';
  journal_id := public.create_journal_entry_atomic(
    p_payment_date,
    'Payroll payment' || CASE WHEN nullif(trim(p_payment_reference),'') IS NULL THEN '' ELSE ' — ' || trim(p_payment_reference) END,
    'payroll_payment', p.id, auth.uid(),
    jsonb_build_array(
      jsonb_build_object('gl_account_id', s.salaries_payable_gl_account_id, 'debit', p.amount, 'credit', 0, 'line_description', 'Salary paid'),
      jsonb_build_object('gl_account_id', cash_gl, 'debit', 0, 'credit', p.amount, 'line_description', initcap(replace(p_payment_method, '_', ' ')) || ' payment')
    ), p.organization_id
  );
  UPDATE public.payroll_payments
  SET status = 'paid', payment_method = p_payment_method, payment_reference = nullif(trim(p_payment_reference),''),
      paid_at = paid_at_value, journal_entry_id = journal_id, updated_at = now()
  WHERE id = p.id;
  IF NOT EXISTS (SELECT 1 FROM public.payroll_payments WHERE payroll_run_id = p.payroll_run_id AND status <> 'paid') THEN
    UPDATE public.payroll_runs SET status = 'paid', paid_at = paid_at_value WHERE id = p.payroll_run_id;
  END IF;
  RETURN journal_id;
END $$;
REVOKE ALL ON FUNCTION public.post_payroll_payment(uuid,date,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_payroll_payment(uuid,date,text,text) TO authenticated;
