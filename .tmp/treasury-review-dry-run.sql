BEGIN;
CREATE TABLE public.treasury_expense_review_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  request_id uuid NOT NULL, edited_by uuid NOT NULL, edited_at timestamptz NOT NULL DEFAULT now(),
  before_data jsonb NOT NULL, after_data jsonb NOT NULL
);
ALTER TABLE public.treasury_expense_review_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.treasury_expense_review_audit FROM anon, authenticated;

-- Edits and approvals lock the same request. All source lines, totals and audit
-- records commit together; a stale review cannot overwrite newer changes.
CREATE OR REPLACE FUNCTION public.review_treasury_expense(
  p_request_id uuid, p_expected_updated_at timestamptz,
  p_changes jsonb DEFAULT NULL, p_approve boolean DEFAULT false,
  p_bank_charges_account_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE req public.treasury_requests%ROWTYPE; exp public.expenses%ROWTYPE;
  actor public.staff%ROWTYPE; before_data jsonb; entries jsonb; item jsonb; total numeric(18,2);
  line public.expense_lines%ROWTYPE; journal_lines jsonb := '[]'; fees_id uuid; gl_id uuid;
  debit_amount numeric(18,2); vat_amount numeric(18,2); fees_amount numeric(18,2); journal_id uuid;
BEGIN
  SELECT * INTO actor FROM public.staff WHERE id=auth.uid() AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sign in with an active staff account'; END IF;
  SELECT * INTO req FROM public.treasury_requests WHERE id=p_request_id AND organization_id=actor.organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense request not found in your organization'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=req.organization_id AND enable_treasury) THEN RAISE EXCEPTION 'Treasury is not enabled'; END IF;
  IF COALESCE(
    (SELECT allowed FROM public.staff_permission_overrides WHERE organization_id=req.organization_id AND staff_id=actor.id AND permission_key='page:treasury'),
    (SELECT allowed FROM public.organization_permissions WHERE organization_id=req.organization_id AND role_key=actor.role AND permission_key='page:treasury'),true
  ) = false THEN RAISE EXCEPTION 'Treasury access denied'; END IF;
  IF req.source_type<>'expense' OR req.status<>'pending_approval' THEN RAISE EXCEPTION 'Only pending expenses can be edited or approved'; END IF;
  IF p_expected_updated_at IS NULL OR req.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'This request changed. Reload its details before continuing.'; END IF;
  SELECT * INTO STRICT exp FROM public.expenses WHERE id=req.source_id AND organization_id=req.organization_id FOR UPDATE;
  IF exp.status='cancelled' THEN RAISE EXCEPTION 'Cancelled expenses cannot be edited or approved'; END IF;
  IF EXISTS(SELECT 1 FROM public.journal_entries WHERE reference_type='expense' AND reference_id=exp.id AND NOT is_deleted) THEN RAISE EXCEPTION 'This expense already has a posted journal and cannot be changed here'; END IF;
  PERFORM 1 FROM public.expense_lines WHERE expense_id=exp.id FOR UPDATE;
  IF p_changes IS NOT NULL THEN
    SELECT jsonb_build_object('expense',to_jsonb(exp),'lines',COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.sort_order,l.id),'[]'),'request',to_jsonb(req))
      INTO before_data FROM public.expense_lines l WHERE l.expense_id=exp.id;
    entries:=p_changes->'lines';
    IF jsonb_typeof(entries) IS DISTINCT FROM 'array' OR jsonb_array_length(entries)=0 THEN RAISE EXCEPTION 'Expense entries are required'; END IF;
    IF jsonb_array_length(entries)<>(SELECT count(*) FROM public.expense_lines WHERE expense_id=exp.id)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(entries) r GROUP BY r->>'id' HAVING count(*)>1)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(entries) r WHERE NOT EXISTS(SELECT 1 FROM public.expense_lines l WHERE l.id=(r->>'id')::uuid AND l.expense_id=exp.id))
    THEN RAISE EXCEPTION 'Expense entries changed. Reload before editing.'; END IF;
    IF NULLIF(trim(p_changes->>'description'),'') IS NULL OR NULLIF(p_changes->>'expense_date','') IS NULL THEN RAISE EXCEPTION 'Date and particulars are required'; END IF;
    IF NULLIF(p_changes->>'vendor_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vendors WHERE id=(p_changes->>'vendor_id')::uuid AND organization_id=req.organization_id) THEN RAISE EXCEPTION 'Payee must belong to your organization'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(entries) LOOP
      IF EXISTS(SELECT 1 FROM unnest(ARRAY[item->>'amount',item->>'vat_amount',item->>'bank_charges',item->>'quantity']) n WHERE n IS NULL OR n IN ('NaN','Infinity','-Infinity') OR n::numeric<0)
        OR (item->>'quantity')::numeric<=0 THEN RAISE EXCEPTION 'Entry amounts must be non-negative and quantity greater than zero'; END IF;
      IF NULLIF(item->>'vendor_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vendors WHERE id=(item->>'vendor_id')::uuid AND organization_id=req.organization_id) THEN RAISE EXCEPTION 'Entry payee must belong to your organization'; END IF;
      IF NULLIF(item->>'expense_gl_account_id','') IS NULL OR NULLIF(item->>'source_cash_gl_account_id','') IS NULL THEN RAISE EXCEPTION 'Expense and funding accounts are required'; END IF;
      UPDATE public.expense_lines SET
        expense_gl_account_id=(item->>'expense_gl_account_id')::uuid, source_cash_gl_account_id=(item->>'source_cash_gl_account_id')::uuid,
        amount=round((item->>'amount')::numeric,2), vat_amount=round((item->>'vat_amount')::numeric,2), bank_charges=round((item->>'bank_charges')::numeric,2),
        quantity=(item->>'quantity')::numeric, comment=NULLIF(trim(item->>'comment'),''), vendor_id=NULLIF(item->>'vendor_id','')::uuid,
        vat_gl_account_id=NULLIF(item->>'vat_gl_account_id','')::uuid, bank_charges_gl_account_id=NULLIF(item->>'bank_charges_gl_account_id','')::uuid
      WHERE id=(item->>'id')::uuid AND expense_id=exp.id;
    END LOOP;
    UPDATE public.expenses SET description=trim(p_changes->>'description'),expense_date=(p_changes->>'expense_date')::date,
      vendor_id=NULLIF(p_changes->>'vendor_id','')::uuid WHERE id=exp.id RETURNING * INTO exp;
  END IF;
  total:=0;
  FOR line IN SELECT * FROM public.expense_lines WHERE expense_id=exp.id ORDER BY sort_order,id LOOP
    debit_amount:=round(line.amount,2); vat_amount:=round(COALESCE(line.vat_amount,0),2); fees_amount:=round(COALESCE(line.bank_charges,0),2);
    fees_id:=COALESCE(line.bank_charges_gl_account_id,p_bank_charges_account_id);
    FOREACH gl_id IN ARRAY ARRAY[line.expense_gl_account_id,line.source_cash_gl_account_id,
      CASE WHEN vat_amount>0 THEN COALESCE(line.vat_gl_account_id,line.expense_gl_account_id) END,
      CASE WHEN fees_amount>0 THEN fees_id END] LOOP
      IF gl_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.gl_accounts WHERE id=gl_id AND organization_id=req.organization_id AND is_active) THEN RAISE EXCEPTION 'Choose active GL accounts belonging to your organization'; END IF;
    END LOOP;
    IF fees_amount>0 AND fees_id IS NULL THEN RAISE EXCEPTION 'Choose a GL account for bank charges'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.gl_accounts WHERE id=line.source_cash_gl_account_id AND account_type='asset') THEN RAISE EXCEPTION 'Source of funds must be an asset account'; END IF;
    total:=total+debit_amount+vat_amount+fees_amount;
    IF debit_amount>0 THEN journal_lines:=journal_lines||jsonb_build_array(jsonb_build_object('gl_account_id',line.expense_gl_account_id,'debit',debit_amount,'credit',0,'line_description',COALESCE(NULLIF(line.comment,''),exp.description))); END IF;
    IF vat_amount>0 THEN journal_lines:=journal_lines||jsonb_build_array(jsonb_build_object('gl_account_id',COALESCE(line.vat_gl_account_id,line.expense_gl_account_id),'debit',vat_amount,'credit',0,'line_description','VAT')); END IF;
    IF fees_amount>0 THEN journal_lines:=journal_lines||jsonb_build_array(jsonb_build_object('gl_account_id',fees_id,'debit',fees_amount,'credit',0,'line_description','Bank charges')); END IF;
    IF debit_amount+vat_amount+fees_amount>0 THEN journal_lines:=journal_lines||jsonb_build_array(jsonb_build_object('gl_account_id',line.source_cash_gl_account_id,'debit',0,'credit',debit_amount+vat_amount+fees_amount,'line_description','Source of funds')); END IF;
  END LOOP;
  IF total<=0 THEN RAISE EXCEPTION 'Expense total must be greater than zero'; END IF;
  IF p_changes IS NOT NULL THEN
    UPDATE public.expenses SET amount=total WHERE id=exp.id RETURNING * INTO exp;
    UPDATE public.treasury_requests SET purpose=exp.description,amount=total,vendor_id=exp.vendor_id,
      payee_name=COALESCE((SELECT name FROM public.vendors WHERE id=exp.vendor_id),NULLIF(trim(p_changes->>'payee_name'),'')) WHERE id=req.id RETURNING * INTO req;
    INSERT INTO public.treasury_expense_review_audit(organization_id,request_id,edited_by,before_data,after_data)
    SELECT req.organization_id,req.id,actor.id,before_data,jsonb_build_object('expense',to_jsonb(exp),'request',to_jsonb(req),'lines',jsonb_agg(to_jsonb(l) ORDER BY l.sort_order,l.id)) FROM public.expense_lines l WHERE l.expense_id=exp.id;
  ELSIF total IS DISTINCT FROM exp.amount OR total IS DISTINCT FROM req.amount THEN
    RAISE EXCEPTION 'Expense total does not match its entries. Edit and save the request before approving.';
  END IF;
  IF p_approve THEN
    journal_id:=public.create_journal_entry_atomic(exp.expense_date,exp.description,'expense',exp.id,actor.id,journal_lines,req.organization_id);
    UPDATE public.treasury_requests SET status='disbursed',approved_by=actor.id,approved_at=now(),disbursed_by=actor.id,disbursed_at=now() WHERE id=req.id RETURNING * INTO req;
  END IF;
  RETURN jsonb_build_object('updated_at',req.updated_at,'amount',req.amount,'status',req.status,'journal_id',journal_id);
END;
$$;
REVOKE ALL ON FUNCTION public.review_treasury_expense(uuid,timestamptz,jsonb,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_treasury_expense(uuid,timestamptz,jsonb,boolean,uuid) TO authenticated;

-- Run only in a transaction that ends with ROLLBACK.
DO $$
<<review_test>>
DECLARE actor_id uuid; org_id uuid; expense_id uuid; request_id uuid; line_id uuid; expense_gl uuid; cash_gl uuid;
  token timestamptz; payload jsonb; result jsonb; journal_id uuid; count_lines integer;
BEGIN
  SELECT s.id,s.organization_id INTO STRICT actor_id,org_id FROM public.staff s JOIN public.organizations o ON o.id=s.organization_id
    WHERE s.is_active AND s.role='admin' AND o.enable_treasury ORDER BY s.created_at LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub',actor_id::text,true);
  INSERT INTO public.gl_accounts(organization_id,account_code,account_name,account_type,category) VALUES(org_id,'test-review-exp-'||gen_random_uuid()::text,'Review test expense','expense','expense') RETURNING id INTO expense_gl;
  INSERT INTO public.gl_accounts(organization_id,account_code,account_name,account_type,category) VALUES(org_id,'test-review-cash-'||gen_random_uuid()::text,'Review test cash','asset','cash') RETURNING id INTO cash_gl;
  INSERT INTO public.expenses(organization_id,amount,description,expense_date) VALUES(org_id,100,'Before review',current_date) RETURNING id INTO expense_id;
  INSERT INTO public.expense_lines(expense_id,expense_gl_account_id,source_cash_gl_account_id,amount,quantity) VALUES(expense_id,expense_gl,cash_gl,100,2) RETURNING id INTO line_id;
  INSERT INTO public.treasury_requests(organization_id,source_type,source_id,request_type,purpose,amount,status) VALUES(org_id,'expense',expense_id,'expense','Before review',100,'pending_approval') RETURNING id,updated_at INTO request_id,token;
  SELECT jsonb_build_object('description','Corrected particulars','expense_date',current_date,'payee_name','Test payee','lines',jsonb_build_array(to_jsonb(l)||jsonb_build_object('amount',200,'vat_amount',36,'bank_charges',0,'comment','Corrected entry'))) INTO payload FROM public.expense_lines l WHERE id=line_id;
  result:=public.review_treasury_expense(request_id,token,payload,false);
  IF (result->>'amount')::numeric<>236 OR result->>'status'<>'pending_approval' THEN RAISE EXCEPTION 'Save did not update queue total while retaining pending status'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.expenses WHERE id=expense_id AND amount=236 AND description='Corrected particulars') THEN RAISE EXCEPTION 'Source expense was not saved'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.treasury_expense_review_audit a WHERE a.request_id=review_test.request_id) THEN RAISE EXCEPTION 'Missing edit audit'; END IF;
  BEGIN
    PERFORM public.review_treasury_expense(request_id,(result->>'updated_at')::timestamptz,
      jsonb_set(payload,'{lines,0,source_cash_gl_account_id}',to_jsonb(expense_gl::text)),false);
    RAISE EXCEPTION 'Non-asset funding account was accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'Source of funds must be an asset%' THEN RAISE; END IF; END;
  IF NOT EXISTS(SELECT 1 FROM public.expense_lines WHERE id=line_id AND source_cash_gl_account_id=cash_gl) THEN RAISE EXCEPTION 'Failed save was not rolled back'; END IF;
  BEGIN
    PERFORM public.review_treasury_expense(request_id,token-interval '1 second',payload,false);
    RAISE EXCEPTION 'Stale update was accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'This request changed%' THEN RAISE; END IF; END;
  result:=public.review_treasury_expense(request_id,(result->>'updated_at')::timestamptz,NULL,true);
  journal_id:=(result->>'journal_id')::uuid;
  IF result->>'status'<>'disbursed' OR journal_id IS NULL THEN RAISE EXCEPTION 'Approval did not post'; END IF;
  SELECT count(*) INTO count_lines FROM public.journal_entry_lines WHERE journal_entry_id=journal_id;
  IF count_lines<>3 THEN RAISE EXCEPTION 'Expected expense, VAT and funding journal entries'; END IF;
  IF (SELECT sum(debit) FROM public.journal_entry_lines WHERE journal_entry_id=journal_id)<>236 OR
     (SELECT sum(credit) FROM public.journal_entry_lines WHERE journal_entry_id=journal_id)<>236 THEN RAISE EXCEPTION 'Edited journal amounts incorrect'; END IF;
  BEGIN
    PERFORM public.review_treasury_expense(request_id,(result->>'updated_at')::timestamptz,payload,false);
    RAISE EXCEPTION 'Approved expense was editable';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'Only pending expenses%' THEN RAISE; END IF; END;
END;
$$;

ROLLBACK;