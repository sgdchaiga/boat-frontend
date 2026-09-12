-- School cashbook classifications are recorded separately from the financial account.
-- Keep posting-time labels so renamed subvotes do not rewrite historical cashbooks.
BEGIN;
ALTER TABLE public.general_business_cashbook_entries
  ADD COLUMN school_vote_id uuid REFERENCES public.school_budget_votes(id) ON DELETE RESTRICT,
  ADD COLUMN school_subvote_id uuid REFERENCES public.school_budget_subvotes(id) ON DELETE RESTRICT,
  ADD COLUMN school_vote_label text,
  ADD COLUMN school_subvote_label text,
  ADD CONSTRAINT school_cashbook_dimension_pair CHECK (
    (school_vote_id IS NULL AND school_subvote_id IS NULL AND school_vote_label IS NULL AND school_subvote_label IS NULL)
    OR (school_vote_id IS NOT NULL AND school_subvote_id IS NOT NULL AND school_vote_label IS NOT NULL AND school_subvote_label IS NOT NULL)
  );
CREATE INDEX school_cashbook_subvote_date ON public.general_business_cashbook_entries
  (organization_id, school_subvote_id, transaction_date) WHERE school_subvote_id IS NOT NULL;

CREATE FUNCTION public.validate_school_cashbook_dimensions() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.school_vote_id IS DISTINCT FROM OLD.school_vote_id
      OR NEW.school_subvote_id IS DISTINCT FROM OLD.school_subvote_id
      OR NEW.school_vote_label IS DISTINCT FROM OLD.school_vote_label
      OR NEW.school_subvote_label IS DISTINCT FROM OLD.school_subvote_label THEN
      RAISE EXCEPTION 'Posted school classifications are immutable; use correction or void';
    END IF;
  ELSIF NEW.school_subvote_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM school_budget_subvotes s JOIN school_budget_votes v ON v.id=s.vote_id
      JOIN organizations o ON o.id=s.organization_id
      WHERE s.id=NEW.school_subvote_id AND s.vote_id=NEW.school_vote_id
        AND s.organization_id=NEW.organization_id AND v.organization_id=NEW.organization_id
        AND o.business_type='school'
    ) THEN RAISE EXCEPTION 'Vote and subvote must belong to this school'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_school_cashbook_dimensions BEFORE INSERT OR UPDATE
ON public.general_business_cashbook_entries FOR EACH ROW EXECUTE FUNCTION public.validate_school_cashbook_dimensions();

CREATE OR REPLACE FUNCTION public.post_school_cashbook_entry(
  p_organization_id uuid, p_transaction_date date, p_headquarters text,
  p_payment_method text, p_description text, p_supplier_name text,
  p_customer_name text, p_counterpart_gl_account_id uuid,
  p_cash_gl_account_id uuid, p_cash_in numeric, p_cash_out numeric, p_reference text, p_subvote_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_entry_id uuid := gen_random_uuid(); v_journal_id uuid; v_sub school_budget_subvotes%rowtype; v_vote school_budget_votes%rowtype;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND organization_id = p_organization_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id=p_organization_id AND business_type='school') THEN
    RAISE EXCEPTION 'School cashbook posting requires a school organization';
  END IF;
  IF p_subvote_id IS NOT NULL THEN
    SELECT * INTO v_sub FROM school_budget_subvotes WHERE id=p_subvote_id AND organization_id=p_organization_id AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Select an active subvote belonging to this school'; END IF;
    SELECT * INTO v_vote FROM school_budget_votes WHERE id=v_sub.vote_id AND organization_id=p_organization_id AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The subvote must belong to an active vote in this school'; END IF;
    IF v_sub.default_gl_account_id IS NULL OR v_sub.default_gl_account_id IS DISTINCT FROM p_counterpart_gl_account_id THEN
      RAISE EXCEPTION 'Subvote account mapping is missing or changed; refresh and select the subvote again';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM gl_accounts WHERE id IN (p_counterpart_gl_account_id,p_cash_gl_account_id)
      AND organization_id=p_organization_id AND is_active GROUP BY organization_id HAVING count(*)=2) THEN
    RAISE EXCEPTION 'Choose two distinct active accounts belonging to this school';
  END IF;
  IF coalesce(trim(p_description),'') = '' THEN RAISE EXCEPTION 'Description is required'; END IF;
  IF NOT ((p_cash_in > 0 AND p_cash_out = 0) OR (p_cash_out > 0 AND p_cash_in = 0)) THEN
    RAISE EXCEPTION 'Enter either cash in or cash out';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM gl_accounts WHERE id IN (p_counterpart_gl_account_id,p_cash_gl_account_id) AND organization_id=p_organization_id GROUP BY organization_id HAVING count(*)=2) THEN
    RAISE EXCEPTION 'Both GL accounts must belong to this organization';
  END IF;

  INSERT INTO journal_entries(entry_date,description,reference_type,reference_id,created_by,organization_id,is_posted,is_deleted)
  VALUES(p_transaction_date,p_description,'general_business_cashbook',v_entry_id,auth.uid(),p_organization_id,true,false)
  RETURNING id INTO v_journal_id;

  IF p_cash_in > 0 THEN
    INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order) VALUES
      (v_journal_id,p_cash_gl_account_id,p_cash_in,0,p_description,1),
      (v_journal_id,p_counterpart_gl_account_id,0,p_cash_in,p_description,2);
  ELSE
    INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order) VALUES
      (v_journal_id,p_counterpart_gl_account_id,p_cash_out,0,p_description,1),
      (v_journal_id,p_cash_gl_account_id,0,p_cash_out,p_description,2);
  END IF;

  INSERT INTO general_business_cashbook_entries(id,organization_id,transaction_date,headquarters,payment_method,description,supplier_name,customer_name,counterpart_gl_account_id,cash_gl_account_id,cash_in,cash_out,reference,journal_entry_id,created_by,school_vote_id,school_subvote_id,school_vote_label,school_subvote_label)
  VALUES(v_entry_id,p_organization_id,p_transaction_date,nullif(trim(p_headquarters),''),p_payment_method,p_description,nullif(trim(p_supplier_name),''),nullif(trim(p_customer_name),''),p_counterpart_gl_account_id,p_cash_gl_account_id,p_cash_in,p_cash_out,nullif(trim(p_reference),''),v_journal_id,auth.uid(),v_vote.id,v_sub.id,v_vote.vote_code||' — '||v_vote.vote_name,v_sub.subvote_code||' — '||v_sub.subvote_name);
  RETURN v_entry_id;
END; $$;


REVOKE ALL ON FUNCTION public.post_school_cashbook_entry(uuid,date,text,text,text,text,text,uuid,uuid,numeric,numeric,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_school_cashbook_entry(uuid,date,text,text,text,text,text,uuid,uuid,numeric,numeric,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.void_general_cashbook_entry(p_organization_id uuid,p_entry_id uuid,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE old general_business_cashbook_entries%rowtype; rid uuid:=gen_random_uuid(); jid uuid;
BEGIN
 IF NOT gb_cashbook_can_control(p_organization_id) THEN RAISE EXCEPTION 'You do not have permission to void cashbook entries'; END IF;
 IF coalesce(trim(p_reason),'')='' THEN RAISE EXCEPTION 'A void reason is required'; END IF;
 SELECT * INTO old FROM general_business_cashbook_entries WHERE id=p_entry_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND OR old.approval_status IN ('voided','replaced') OR old.reversal_of_entry_id IS NOT NULL THEN RAISE EXCEPTION 'Entry cannot be voided'; END IF;
 INSERT INTO journal_entries(entry_date,description,reference_type,reference_id,created_by,organization_id,is_posted,is_deleted)
 VALUES(current_date,'Reversal: '||old.description||' — '||trim(p_reason),old.workspace_type||'_cashbook_reversal',rid,auth.uid(),p_organization_id,true,false) RETURNING id INTO jid;
 INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order)
 SELECT jid,gl_account_id,credit,debit,'Reversal: '||coalesce(line_description,old.description),sort_order FROM journal_entry_lines WHERE journal_entry_id=old.journal_entry_id;
 INSERT INTO general_business_cashbook_entries(id,organization_id,transaction_date,headquarters,payment_method,description,supplier_name,customer_name,counterpart_gl_account_id,cash_gl_account_id,cash_in,cash_out,reference,journal_entry_id,created_by,workspace_type,approval_status,reversal_of_entry_id,correction_reason,school_vote_id,school_subvote_id,school_vote_label,school_subvote_label)
 VALUES(rid,p_organization_id,current_date,old.headquarters,old.payment_method,'Reversal: '||old.description,old.supplier_name,old.customer_name,old.counterpart_gl_account_id,old.cash_gl_account_id,old.cash_out,old.cash_in,old.reference,jid,auth.uid(),old.workspace_type,'approved',old.id,trim(p_reason),old.school_vote_id,old.school_subvote_id,old.school_vote_label,old.school_subvote_label);
 UPDATE general_business_cashbook_entries SET approval_status='voided',correction_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() WHERE id=old.id;
 RETURN rid;
END $$;

-- Copy original accounts and classifications, even if the mapping has since changed.
CREATE OR REPLACE FUNCTION public.correct_general_cashbook_entry(p_organization_id uuid,p_entry_id uuid,p_reason text,p_description text,p_reference text) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE old general_business_cashbook_entries%rowtype; nid uuid:=gen_random_uuid(); jid uuid; description_text text;
BEGIN
 SELECT * INTO old FROM general_business_cashbook_entries WHERE id=p_entry_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
 PERFORM void_general_cashbook_entry(p_organization_id,p_entry_id,p_reason);
 description_text:=coalesce(nullif(trim(p_description),''),old.description);
 INSERT INTO journal_entries(entry_date,description,reference_type,reference_id,created_by,organization_id,is_posted,is_deleted)
 VALUES(old.transaction_date,description_text,old.workspace_type||'_cashbook',nid,auth.uid(),p_organization_id,true,false) RETURNING id INTO jid;
 INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order)
 SELECT jid,gl_account_id,debit,credit,description_text,sort_order FROM journal_entry_lines WHERE journal_entry_id=old.journal_entry_id;
 INSERT INTO general_business_cashbook_entries(id,organization_id,transaction_date,headquarters,payment_method,description,supplier_name,customer_name,counterpart_gl_account_id,cash_gl_account_id,cash_in,cash_out,reference,journal_entry_id,created_by,workspace_type,correction_reason,comments,school_vote_id,school_subvote_id,school_vote_label,school_subvote_label)
 VALUES(nid,p_organization_id,old.transaction_date,old.headquarters,old.payment_method,description_text,old.supplier_name,old.customer_name,old.counterpart_gl_account_id,old.cash_gl_account_id,old.cash_in,old.cash_out,nullif(trim(p_reference),''),jid,auth.uid(),old.workspace_type,trim(p_reason),old.comments,old.school_vote_id,old.school_subvote_id,old.school_vote_label,old.school_subvote_label);
 UPDATE general_business_cashbook_entries SET approval_status='replaced',replaced_by_entry_id=nid WHERE id=p_entry_id;
 RETURN nid;
END $$;
COMMIT;
