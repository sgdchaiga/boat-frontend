-- First-release disbursement channel: credit the member's existing ordinary
-- savings account. This uses the existing loan and savings ledgers; no wallet or
-- duplicate member account is introduced.

ALTER TABLE public.sacco_mobile_money_settings
  ADD COLUMN IF NOT EXISTS member_savings_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.sacco_loan_disbursements
  ADD COLUMN IF NOT EXISTS savings_account_id uuid REFERENCES public.sacco_member_savings_accounts(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.disburse_sacco_loan_to_savings(p_loan_id uuid, p_savings_account_id uuid DEFAULT NULL)
RETURNS public.sacco_loan_disbursements
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_staff public.staff%ROWTYPE; v_loan public.sacco_loans%ROWTYPE; v_member public.sacco_members%ROWTYPE;
  v_settings public.sacco_mobile_money_settings%ROWTYPE; v_account public.sacco_member_savings_accounts%ROWTYPE;
  v_out public.sacco_loan_disbursements%ROWTYPE; v_journal uuid; v_ref text; v_existing boolean:=false;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Only SACCO staff may disburse a loan'; END IF;
  SELECT * INTO v_loan FROM public.sacco_loans WHERE id=p_loan_id AND organization_id=v_staff.organization_id FOR UPDATE;
  IF NOT FOUND OR v_loan.status<>'pending' OR v_loan.approval_stage<2 THEN RAISE EXCEPTION 'Loan is not cleared for disbursement'; END IF;
  SELECT * INTO v_member FROM public.sacco_members WHERE id=v_loan.sacco_member_id AND organization_id=v_staff.organization_id;
  IF NOT FOUND OR NOT v_member.is_active THEN RAISE EXCEPTION 'Loan member is not active'; END IF;
  SELECT * INTO v_settings FROM public.sacco_mobile_money_settings WHERE organization_id=v_staff.organization_id;
  IF NOT FOUND OR v_settings.loan_receivable_gl_account_id IS NULL OR v_settings.member_savings_gl_account_id IS NULL THEN
    RAISE EXCEPTION 'Configure loan-receivable and member-savings GL accounts before disbursing';
  END IF;
  IF p_savings_account_id IS NULL THEN
    SELECT * INTO v_account FROM public.sacco_member_savings_accounts
    WHERE organization_id=v_staff.organization_id AND sacco_member_id=v_loan.sacco_member_id AND is_active=true
      AND upper(coalesce(savings_product_code,'')) NOT LIKE '%SHARE%' AND upper(coalesce(savings_product_code,'')) NOT LIKE 'SHR%'
    ORDER BY created_at LIMIT 1;
  ELSE
    SELECT * INTO v_account FROM public.sacco_member_savings_accounts WHERE id=p_savings_account_id AND organization_id=v_staff.organization_id AND sacco_member_id=v_loan.sacco_member_id AND is_active=true;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member has no active ordinary savings account to receive this loan'; END IF;
  SELECT * INTO v_out FROM public.sacco_loan_disbursements WHERE organization_id=v_staff.organization_id AND sacco_loan_id=v_loan.id FOR UPDATE;
  v_existing:=FOUND;
  IF FOUND AND v_out.status='paid' THEN RETURN v_out; END IF;
  v_ref:='SACSAV-'||replace(v_loan.id::text,'-','');
  IF NOT v_existing THEN
    INSERT INTO public.sacco_loan_disbursements(organization_id,sacco_loan_id,sacco_member_id,amount,phone_number,network,status,provider,provider_reference,authorized_by,savings_account_id,paid_at,processed_at)
    VALUES(v_staff.organization_id,v_loan.id,v_member.id,v_loan.amount,coalesce(v_member.phone,''),'mtn','processing','internal_savings',v_ref,v_staff.id,v_account.id,now(),now()) RETURNING * INTO v_out;
  ELSE
    UPDATE public.sacco_loan_disbursements SET status='processing',provider='internal_savings',provider_reference=v_ref,savings_account_id=v_account.id,authorized_by=v_staff.id,authorized_at=now(),processed_at=now(),failure_reason=NULL
    WHERE id=v_out.id RETURNING * INTO v_out;
  END IF;
  -- Post journal before crediting the member account, so an incomplete accounting
  -- configuration cannot create spendable money.
  INSERT INTO public.journal_entries(entry_date,description,reference_type,reference_id,created_by,organization_id,is_posted,is_deleted)
  VALUES(current_date,'Loan disbursement credited to savings — '||v_ref,'sacco_loan_disbursement',v_out.id,v_staff.id,v_staff.organization_id,true,false)
  ON CONFLICT(reference_type,reference_id) WHERE (reference_id IS NOT NULL AND is_deleted=false) DO NOTHING RETURNING id INTO v_journal;
  IF v_journal IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description)
    VALUES(v_journal,v_settings.loan_receivable_gl_account_id,v_loan.amount,0,'Loan principal'),(v_journal,v_settings.member_savings_gl_account_id,0,v_loan.amount,'Member savings account credit');
  END IF;
  UPDATE public.sacco_member_savings_accounts SET balance=balance+v_loan.amount WHERE id=v_account.id AND organization_id=v_staff.organization_id;
  UPDATE public.sacco_loans SET status='disbursed',balance=amount,paid_amount=0,disbursement_date=current_date WHERE id=v_loan.id AND status='pending';
  UPDATE public.sacco_loan_disbursements SET status='paid',paid_at=now(),provider_response=jsonb_build_object('channel','internal_savings','account_number',v_account.account_number) WHERE id=v_out.id RETURNING * INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.disburse_sacco_loan_to_savings(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disburse_sacco_loan_to_savings(uuid,uuid) TO authenticated;
COMMENT ON FUNCTION public.disburse_sacco_loan_to_savings(uuid,uuid) IS 'Atomic approved-loan disbursement to the member ordinary savings account, with journal posting.';
