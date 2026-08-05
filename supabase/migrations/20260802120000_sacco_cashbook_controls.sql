-- Audited SACCO cashbook approval, correction and void controls.
ALTER TABLE public.sacco_cashbook_entries
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending','approved','voided','replaced')),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS replaced_by_entry_id uuid REFERENCES public.sacco_cashbook_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_of_entry_id uuid REFERENCES public.sacco_cashbook_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correction_reason text;

CREATE INDEX IF NOT EXISTS idx_sacco_cashbook_approval
  ON public.sacco_cashbook_entries(organization_id, approval_status, entry_date DESC);

CREATE OR REPLACE FUNCTION public.approve_sacco_cashbook_entry(p_organization_id uuid, p_entry_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff WHERE id=auth.uid() AND organization_id=p_organization_id AND lower(role) IN ('admin','super_admin','manager','accountant')) THEN
    RAISE EXCEPTION 'You do not have permission to approve cashbook entries';
  END IF;
  UPDATE sacco_cashbook_entries SET approval_status='approved', approved_by=auth.uid(), approved_at=now(), updated_by=auth.uid()
  WHERE id=p_entry_id AND organization_id=p_organization_id AND approval_status='pending' AND created_by IS DISTINCT FROM auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry is unavailable, already processed, or cannot be self-approved'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_sacco_cashbook_entry(p_organization_id uuid, p_entry_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_old sacco_cashbook_entries%ROWTYPE; v_reversal uuid; v_journal uuid; v_balance numeric:=0;
BEGIN
  IF coalesce(trim(p_reason),'')='' THEN RAISE EXCEPTION 'A void reason is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM staff WHERE id=auth.uid() AND organization_id=p_organization_id AND lower(role) IN ('admin','super_admin','manager','accountant')) THEN RAISE EXCEPTION 'You do not have permission to void cashbook entries'; END IF;
  SELECT * INTO v_old FROM sacco_cashbook_entries WHERE id=p_entry_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_old.approval_status IN ('voided','replaced') OR v_old.reversal_of_entry_id IS NOT NULL THEN RAISE EXCEPTION 'Entry cannot be voided'; END IF;
  v_reversal:=gen_random_uuid();
  SELECT coalesce(balance,0) INTO v_balance FROM sacco_cashbook_entries WHERE organization_id=p_organization_id ORDER BY entry_date DESC,created_at DESC LIMIT 1;
  IF v_old.journal_entry_id IS NOT NULL THEN
    INSERT INTO journal_entries(entry_date,description,reference_type,reference_id,created_by,organization_id,is_posted,is_deleted)
    VALUES(current_date,'Reversal: '||v_old.narration||' — '||trim(p_reason),'sacco_cashbook_reversal',v_reversal,auth.uid(),p_organization_id,true,false) RETURNING id INTO v_journal;
    INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order)
    SELECT v_journal,gl_account_id,credit,debit,'Reversal: '||coalesce(line_description,v_old.narration),sort_order FROM journal_entry_lines WHERE journal_entry_id=v_old.journal_entry_id;
  END IF;
  INSERT INTO sacco_cashbook_entries(id,organization_id,entry_date,description,reference,category,sacco_member_id,member_name,debit,credit,balance,transaction_type,narration,gl_account_id,voucher_no,deposit_amount,withdraw_amount,loan_id,loan_no,account_no,client_no,payment_channel,journal_entry_id,created_by,approval_status,reversal_of_entry_id,correction_reason)
  VALUES(v_reversal,p_organization_id,current_date,'Reversal: '||v_old.narration,v_old.voucher_no,'Reversal',v_old.sacco_member_id,v_old.member_name,v_old.withdraw_amount,v_old.deposit_amount,v_balance-v_old.deposit_amount+v_old.withdraw_amount,'Reversal','Reversal: '||v_old.narration||' — '||trim(p_reason),v_old.gl_account_id,v_old.voucher_no,v_old.withdraw_amount,v_old.deposit_amount,v_old.loan_id,v_old.loan_no,v_old.account_no,v_old.client_no,v_old.payment_channel,v_journal,auth.uid(),'approved',v_old.id,trim(p_reason));
  UPDATE sacco_cashbook_entries SET approval_status='voided',correction_reason=trim(p_reason),updated_by=auth.uid() WHERE id=v_old.id;
  RETURN v_reversal;
END;
$$;

CREATE OR REPLACE FUNCTION public.correct_sacco_cashbook_entry(p_organization_id uuid, p_entry_id uuid, p_reason text, p_narration text, p_voucher_no text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_old sacco_cashbook_entries%ROWTYPE; v_new uuid;
BEGIN
  SELECT * INTO v_old FROM sacco_cashbook_entries WHERE id=p_entry_id AND organization_id=p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  PERFORM void_sacco_cashbook_entry(p_organization_id,p_entry_id,p_reason);
  v_new:=post_sacco_cashbook_entry(p_organization_id,v_old.transaction_type,v_old.entry_date,coalesce(nullif(trim(p_narration),''),v_old.narration),v_old.sacco_member_id,v_old.member_name,v_old.gl_account_id,coalesce(p_voucher_no,v_old.voucher_no),v_old.deposit_amount,v_old.withdraw_amount,v_old.loan_id,v_old.loan_no,v_old.account_no,v_old.client_no,v_old.payment_channel);
  UPDATE sacco_cashbook_entries SET approval_status='replaced',replaced_by_entry_id=v_new WHERE id=p_entry_id;
  UPDATE sacco_cashbook_entries SET correction_reason=trim(p_reason) WHERE id=v_new;
  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_sacco_cashbook_entry(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_sacco_cashbook_entry(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_sacco_cashbook_entry(uuid,uuid,text,text,text) TO authenticated;
