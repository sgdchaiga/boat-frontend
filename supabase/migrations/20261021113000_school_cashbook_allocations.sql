-- A school cashbook row may allocate one payment across several vote heads.
-- Keep the existing cashbook header/journal model and attach the familiar
-- voucher fields and allocation detail to it.
BEGIN;

ALTER TABLE public.general_business_cashbook_entries
  ADD COLUMN IF NOT EXISTS cheque_number text,
  ADD COLUMN IF NOT EXISTS payment_voucher_number text;

CREATE TABLE IF NOT EXISTS public.school_cashbook_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cashbook_entry_id uuid NOT NULL REFERENCES public.general_business_cashbook_entries(id) ON DELETE CASCADE,
  school_vote_id uuid NOT NULL REFERENCES public.school_budget_votes(id) ON DELETE RESTRICT,
  school_subvote_id uuid NOT NULL REFERENCES public.school_budget_subvotes(id) ON DELETE RESTRICT,
  gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS school_cashbook_entry_lines_entry_idx ON public.school_cashbook_entry_lines(cashbook_entry_id, sort_order);
ALTER TABLE public.school_cashbook_entry_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_cashbook_entry_lines_org ON public.school_cashbook_entry_lines
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.staff s WHERE s.id=auth.uid() AND s.organization_id=organization_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.staff s WHERE s.id=auth.uid() AND s.organization_id=organization_id));

CREATE OR REPLACE FUNCTION public.post_school_cashbook_payment(
  p_organization_id uuid, p_transaction_date date, p_payment_method text,
  p_description text, p_supplier_name text, p_cash_gl_account_id uuid,
  p_reference text, p_cheque_number text, p_payment_voucher_number text,
  p_allocations jsonb, p_wht_amount numeric DEFAULT 0, p_wht_gl_account_id uuid DEFAULT NULL,
  p_nssf_amount numeric DEFAULT 0, p_nssf_gl_account_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE
  v_entry_id uuid:=gen_random_uuid(); v_journal_id uuid; v_first record; v_item jsonb;
  v_total numeric:=0; v_cash_out numeric; v_wht numeric:=coalesce(p_wht_amount,0); v_nssf numeric:=coalesce(p_nssf_amount,0);
  v_sort integer:=0; v_sub school_budget_subvotes%rowtype; v_vote school_budget_votes%rowtype;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff WHERE id=auth.uid() AND organization_id=p_organization_id) THEN RAISE EXCEPTION 'Not authorized for this organization'; END IF;
  IF coalesce(trim(p_description),'')='' OR jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations)=0 THEN RAISE EXCEPTION 'Description and at least one cashbook allocation are required'; END IF;
  IF v_wht<0 OR v_nssf<0 OR (v_wht>0 AND p_wht_gl_account_id IS NULL) OR (v_nssf>0 AND p_nssf_gl_account_id IS NULL) THEN RAISE EXCEPTION 'Choose a liability account for every statutory deduction'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    IF coalesce((v_item->>'amount')::numeric,0)<=0 THEN RAISE EXCEPTION 'Every allocation must have an amount'; END IF;
    SELECT * INTO v_sub FROM school_budget_subvotes WHERE id=(v_item->>'subvote_id')::uuid AND organization_id=p_organization_id AND is_active;
    IF NOT FOUND OR v_sub.default_gl_account_id IS DISTINCT FROM (v_item->>'gl_account_id')::uuid THEN RAISE EXCEPTION 'Each allocation needs an active, correctly mapped school subvote'; END IF;
    SELECT * INTO v_vote FROM school_budget_votes WHERE id=v_sub.vote_id AND organization_id=p_organization_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Allocation vote is not active'; END IF;
    v_total:=v_total+(v_item->>'amount')::numeric;
  END LOOP;
  v_cash_out:=v_total-v_wht-v_nssf;
  IF v_cash_out<=0 THEN RAISE EXCEPTION 'Deductions must be less than the allocated total'; END IF;
  IF NOT EXISTS (SELECT 1 FROM gl_accounts WHERE id=p_cash_gl_account_id AND organization_id=p_organization_id AND is_active) THEN RAISE EXCEPTION 'Choose an active cash or bank account'; END IF;
  IF (v_wht>0 AND NOT EXISTS (SELECT 1 FROM gl_accounts WHERE id=p_wht_gl_account_id AND organization_id=p_organization_id AND is_active)) OR (v_nssf>0 AND NOT EXISTS (SELECT 1 FROM gl_accounts WHERE id=p_nssf_gl_account_id AND organization_id=p_organization_id AND is_active)) THEN RAISE EXCEPTION 'Deduction account is invalid'; END IF;

  SELECT (value->>'subvote_id')::uuid AS subvote_id,(value->>'gl_account_id')::uuid AS gl_account_id INTO v_first FROM jsonb_array_elements(p_allocations) LIMIT 1;
  SELECT * INTO v_sub FROM school_budget_subvotes WHERE id=v_first.subvote_id; SELECT * INTO v_vote FROM school_budget_votes WHERE id=v_sub.vote_id;
  INSERT INTO journal_entries(entry_date,description,reference_type,reference_id,created_by,organization_id,is_posted,is_deleted)
    VALUES(p_transaction_date,p_description,'school_cashbook_payment',v_entry_id,auth.uid(),p_organization_id,true,false) RETURNING id INTO v_journal_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    v_sort:=v_sort+1;
    INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order)
      VALUES(v_journal_id,(v_item->>'gl_account_id')::uuid,(v_item->>'amount')::numeric,0,p_description,v_sort);
  END LOOP;
  IF v_wht>0 THEN v_sort:=v_sort+1; INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order) VALUES(v_journal_id,p_wht_gl_account_id,0,v_wht,'Withholding tax (WHT)',v_sort); END IF;
  IF v_nssf>0 THEN v_sort:=v_sort+1; INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order) VALUES(v_journal_id,p_nssf_gl_account_id,0,v_nssf,'NSSF deduction',v_sort); END IF;
  IF v_cash_out>0 THEN v_sort:=v_sort+1; INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order) VALUES(v_journal_id,p_cash_gl_account_id,0,v_cash_out,p_description,v_sort); END IF;
  INSERT INTO general_business_cashbook_entries(id,organization_id,transaction_date,payment_method,description,supplier_name,counterpart_gl_account_id,cash_gl_account_id,cash_in,cash_out,reference,journal_entry_id,created_by,school_vote_id,school_subvote_id,school_vote_label,school_subvote_label,cheque_number,payment_voucher_number)
    VALUES(v_entry_id,p_organization_id,p_transaction_date,p_payment_method,p_description,nullif(trim(p_supplier_name),''),v_first.gl_account_id,p_cash_gl_account_id,0,v_cash_out,nullif(trim(p_reference),''),v_journal_id,auth.uid(),v_vote.id,v_sub.id,v_vote.vote_code||' — '||v_vote.vote_name,v_sub.subvote_code||' — '||v_sub.subvote_name,nullif(trim(p_cheque_number),''),nullif(trim(p_payment_voucher_number),''));
  v_sort:=0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    v_sort:=v_sort+1; SELECT * INTO v_sub FROM school_budget_subvotes WHERE id=(v_item->>'subvote_id')::uuid;
    INSERT INTO school_cashbook_entry_lines(organization_id,cashbook_entry_id,school_vote_id,school_subvote_id,gl_account_id,amount,sort_order) VALUES(p_organization_id,v_entry_id,v_sub.vote_id,v_sub.id,(v_item->>'gl_account_id')::uuid,(v_item->>'amount')::numeric,v_sort);
  END LOOP;
  RETURN v_entry_id;
END $$;
REVOKE ALL ON FUNCTION public.post_school_cashbook_payment(uuid,date,text,text,text,uuid,text,text,text,jsonb,numeric,uuid,numeric,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_school_cashbook_payment(uuid,date,text,text,text,uuid,text,text,text,jsonb,numeric,uuid,numeric,uuid) TO authenticated;
COMMIT;
