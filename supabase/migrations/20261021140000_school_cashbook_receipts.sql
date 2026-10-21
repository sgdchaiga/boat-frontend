CREATE OR REPLACE FUNCTION public.post_school_cashbook_receipt(
  p_organization_id uuid, p_transaction_date date, p_payment_method text,
  p_description text, p_customer_name text, p_cash_gl_account_id uuid,
  p_reference text, p_allocations jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_entry_id uuid:=gen_random_uuid(); v_journal_id uuid; v_first record; v_item jsonb; v_total numeric:=0; v_sort integer:=0; v_sub school_budget_subvotes%rowtype; v_vote school_budget_votes%rowtype;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff WHERE id=auth.uid() AND organization_id=p_organization_id) THEN RAISE EXCEPTION 'Not authorized for this organization'; END IF;
  IF coalesce(trim(p_description),'')='' OR jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations)=0 THEN RAISE EXCEPTION 'Description and at least one receipt allocation are required'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    IF coalesce((v_item->>'amount')::numeric,0)<=0 THEN RAISE EXCEPTION 'Every allocation must have an amount'; END IF;
    SELECT * INTO v_sub FROM school_budget_subvotes WHERE id=(v_item->>'subvote_id')::uuid AND organization_id=p_organization_id AND is_active;
    IF NOT FOUND OR v_sub.default_gl_account_id IS DISTINCT FROM (v_item->>'gl_account_id')::uuid THEN RAISE EXCEPTION 'Each allocation needs an active, correctly mapped school subvote'; END IF;
    SELECT * INTO v_vote FROM school_budget_votes WHERE id=v_sub.vote_id AND organization_id=p_organization_id AND is_active; IF NOT FOUND THEN RAISE EXCEPTION 'Allocation vote is not active'; END IF;
    v_total:=v_total+(v_item->>'amount')::numeric;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM gl_accounts WHERE id=p_cash_gl_account_id AND organization_id=p_organization_id AND is_active) THEN RAISE EXCEPTION 'Choose an active cash or bank account'; END IF;
  SELECT (value->>'subvote_id')::uuid AS subvote_id,(value->>'gl_account_id')::uuid AS gl_account_id INTO v_first FROM jsonb_array_elements(p_allocations) LIMIT 1;
  SELECT * INTO v_sub FROM school_budget_subvotes WHERE id=v_first.subvote_id; SELECT * INTO v_vote FROM school_budget_votes WHERE id=v_sub.vote_id;
  INSERT INTO journal_entries(entry_date,description,reference_type,reference_id,created_by,organization_id,is_posted,is_deleted) VALUES(p_transaction_date,p_description,'school_cashbook_receipt',v_entry_id,auth.uid(),p_organization_id,true,false) RETURNING id INTO v_journal_id;
  INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order) VALUES(v_journal_id,p_cash_gl_account_id,v_total,0,p_description,1);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP v_sort:=v_sort+1; INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order) VALUES(v_journal_id,(v_item->>'gl_account_id')::uuid,0,(v_item->>'amount')::numeric,p_description,v_sort+1); END LOOP;
  INSERT INTO general_business_cashbook_entries(id,organization_id,transaction_date,payment_method,description,customer_name,counterpart_gl_account_id,cash_gl_account_id,cash_in,cash_out,reference,journal_entry_id,created_by,school_vote_id,school_subvote_id,school_vote_label,school_subvote_label)
    VALUES(v_entry_id,p_organization_id,p_transaction_date,p_payment_method,p_description,nullif(trim(p_customer_name),''),v_first.gl_account_id,p_cash_gl_account_id,v_total,0,nullif(trim(p_reference),''),v_journal_id,auth.uid(),v_vote.id,v_sub.id,v_vote.vote_code||' — '||v_vote.vote_name,v_sub.subvote_code||' — '||v_sub.subvote_name);
  v_sort:=0; FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP v_sort:=v_sort+1; SELECT * INTO v_sub FROM school_budget_subvotes WHERE id=(v_item->>'subvote_id')::uuid; INSERT INTO school_cashbook_entry_lines(organization_id,cashbook_entry_id,school_vote_id,school_subvote_id,gl_account_id,amount,sort_order) VALUES(p_organization_id,v_entry_id,v_sub.vote_id,v_sub.id,(v_item->>'gl_account_id')::uuid,(v_item->>'amount')::numeric,v_sort); END LOOP;
  RETURN v_entry_id;
END $$;
REVOKE ALL ON FUNCTION public.post_school_cashbook_receipt(uuid,date,text,text,text,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_school_cashbook_receipt(uuid,date,text,text,text,uuid,text,jsonb) TO authenticated;
