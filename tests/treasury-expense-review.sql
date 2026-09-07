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
