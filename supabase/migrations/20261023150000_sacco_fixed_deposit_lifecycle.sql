-- Full term-deposit lifecycle: configurable early-break treatment, settlement, renewal and audit.
ALTER TABLE public.sacco_fixed_deposit_products
  ADD COLUMN IF NOT EXISTS early_withdrawal_penalty_rate numeric NOT NULL DEFAULT 0 CHECK (early_withdrawal_penalty_rate BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS renew_principal_and_interest boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS day_count_basis integer NOT NULL DEFAULT 365 CHECK (day_count_basis IN (360,365));
ALTER TABLE public.sacco_fixed_deposits
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by uuid,
  ADD COLUMN IF NOT EXISTS settlement_savings_account_id uuid REFERENCES public.sacco_member_savings_accounts(id),
  ADD COLUMN IF NOT EXISTS early_withdrawal_penalty numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS renewal_of_id uuid REFERENCES public.sacco_fixed_deposits(id);

CREATE OR REPLACE FUNCTION public.settle_sacco_fixed_deposit(p_deposit_id uuid, p_action text, p_savings_account_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_staff staff%ROWTYPE; v_fd sacco_fixed_deposits%ROWTYPE; v_product sacco_fixed_deposit_products%ROWTYPE; v_account sacco_member_savings_accounts%ROWTYPE; v_interest numeric; v_tax numeric; v_penalty numeric:=0; v_payout numeric; v_days integer; v_basis integer:=365; v_renewed uuid; v_previous numeric;
BEGIN
  SELECT * INTO v_staff FROM staff WHERE id=auth.uid(); IF NOT FOUND OR lower(coalesce(v_staff.role,'')) NOT IN ('accountant','manager','admin','super_admin') THEN RAISE EXCEPTION 'Only finance managers, accountants and administrators can settle fixed deposits'; END IF;
  SELECT * INTO v_fd FROM sacco_fixed_deposits WHERE id=p_deposit_id AND organization_id=v_staff.organization_id FOR UPDATE; IF NOT FOUND OR v_fd.status<>'active' THEN RAISE EXCEPTION 'Only active fixed deposits can be settled'; END IF;
  IF p_action NOT IN ('mature','break','renew') THEN RAISE EXCEPTION 'Invalid settlement instruction'; END IF;
  IF p_action IN ('mature','renew') AND current_date<v_fd.maturity_date THEN RAISE EXCEPTION 'Deposit has not reached maturity; use early break if permitted'; END IF;
  SELECT * INTO v_product FROM sacco_fixed_deposit_products WHERE id=v_fd.product_id;
  v_basis:=coalesce(v_product.day_count_basis,365); v_days:=greatest(0,current_date-v_fd.start_date);
  v_interest:=CASE WHEN p_action='break' THEN round(v_fd.amount*v_fd.interest_rate/100*v_days/v_basis,2) ELSE v_fd.interest_earned END;
  v_tax:=round(v_interest*coalesce(v_product.withholding_tax_rate,0)/100,2);
  IF p_action='break' THEN v_penalty:=round(v_fd.amount*coalesce(v_product.early_withdrawal_penalty_rate,0)/100,2); END IF;
  IF p_action='renew' THEN
    INSERT INTO sacco_fixed_deposits(organization_id,sacco_member_id,member_name,amount,interest_rate,term_months,start_date,maturity_date,interest_earned,withholding_tax,net_interest,auto_renew,status,product_id,source_savings_account_id,renewal_of_id)
    VALUES(v_fd.organization_id,v_fd.sacco_member_id,v_fd.member_name,CASE WHEN coalesce(v_product.renew_principal_and_interest,true) THEN v_fd.amount+v_interest-v_tax ELSE v_fd.amount END,v_fd.interest_rate,v_fd.term_months,current_date,current_date+(v_fd.term_months||' months')::interval,CASE WHEN coalesce(v_product.renew_principal_and_interest,true) THEN round((v_fd.amount+v_interest-v_tax)*v_fd.interest_rate/100*v_fd.term_months/12,2) ELSE v_fd.interest_earned END,0,0,v_fd.auto_renew,'active',v_fd.product_id,v_fd.source_savings_account_id,v_fd.id) RETURNING id INTO v_renewed;
    UPDATE sacco_fixed_deposits SET status='renewed',settled_at=now(),settled_by=auth.uid(),net_interest=v_interest-v_tax,withholding_tax=v_tax WHERE id=v_fd.id;
    INSERT INTO sacco_fixed_deposit_events(organization_id,fixed_deposit_id,event_type,amount,note,actor_id) VALUES(v_fd.organization_id,v_fd.id,'renewed',v_fd.amount,'Renewed into '||v_renewed::text,auth.uid()); RETURN v_renewed;
  END IF;
  SELECT * INTO v_account FROM sacco_member_savings_accounts WHERE id=coalesce(p_savings_account_id,v_fd.source_savings_account_id) AND organization_id=v_fd.organization_id AND sacco_member_id=v_fd.sacco_member_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active member savings account for settlement'; END IF;
  v_payout:=greatest(0,v_fd.amount+v_interest-v_tax-v_penalty); UPDATE sacco_member_savings_accounts SET balance=balance+v_payout WHERE id=v_account.id;
  UPDATE sacco_fixed_deposits SET status=CASE WHEN p_action='break' THEN 'withdrawn' ELSE 'matured' END,interest_earned=v_interest,withholding_tax=v_tax,net_interest=v_interest-v_tax,early_withdrawal_penalty=v_penalty,settled_at=now(),settled_by=auth.uid(),settlement_savings_account_id=v_account.id WHERE id=v_fd.id;
  SELECT coalesce(balance,0) INTO v_previous FROM sacco_cashbook_entries WHERE organization_id=v_fd.organization_id ORDER BY created_at DESC LIMIT 1;
  INSERT INTO sacco_cashbook_entries(organization_id,entry_date,description,reference,category,sacco_member_id,member_name,debit,credit,balance) VALUES(v_fd.organization_id,current_date,'Fixed deposit '||CASE WHEN p_action='break' THEN 'early settlement' ELSE 'maturity settlement' END,'FD-'||left(v_fd.id::text,8),'fixed_deposit_settlement',v_fd.sacco_member_id,v_fd.member_name,v_payout,0,coalesce(v_previous,0)+v_payout);
  INSERT INTO sacco_fixed_deposit_events(organization_id,fixed_deposit_id,event_type,amount,note,actor_id) VALUES(v_fd.organization_id,v_fd.id,CASE WHEN p_action='break' THEN 'early_settlement' ELSE 'maturity_settlement' END,v_payout,concat('Interest ',v_interest,', tax ',v_tax,', penalty ',v_penalty),auth.uid()); RETURN v_fd.id;
END $$;
REVOKE ALL ON FUNCTION public.settle_sacco_fixed_deposit(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_sacco_fixed_deposit(uuid,text,uuid) TO authenticated;
