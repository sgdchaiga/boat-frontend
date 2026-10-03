-- Manual MVP controls: agency staff verify KYC, confirm permitted payment routing, then issue a policy.
CREATE OR REPLACE FUNCTION public.insurance_confirm_quote_kyc(p_quote_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; BEGIN
 SELECT organization_id INTO v_org FROM public.insurance_quotes WHERE id=p_quote_id FOR UPDATE;
 IF v_org IS NULL OR NOT public.insurance_org_access(v_org) THEN RAISE EXCEPTION 'Quote is not available'; END IF;
 UPDATE public.insurance_quotes SET kyc_status='verified' WHERE id=p_quote_id;
 UPDATE public.insurance_leads SET stage='payment_pending',last_activity_at=now() WHERE id=(SELECT lead_id FROM public.insurance_quotes WHERE id=p_quote_id);
END $$;
CREATE OR REPLACE FUNCTION public.insurance_confirm_quote_payment(p_quote_id uuid, p_reference text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_amount numeric; BEGIN
 SELECT q.organization_id,o.premium_amount INTO v_org,v_amount FROM public.insurance_quotes q JOIN public.insurance_quote_options o ON o.id=q.selected_option_id WHERE q.id=p_quote_id FOR UPDATE;
 IF v_org IS NULL OR NOT public.insurance_org_access(v_org) THEN RAISE EXCEPTION 'Selected quote is not available'; END IF;
 IF (SELECT kyc_status FROM public.insurance_quotes WHERE id=p_quote_id) <> 'verified' THEN RAISE EXCEPTION 'KYC must be verified first'; END IF;
 INSERT INTO public.insurance_payments(organization_id,quote_id,amount,reference,status,confirmed_by,confirmed_at) VALUES(v_org,p_quote_id,coalesce(v_amount,0),nullif(trim(p_reference),''),'received',auth.uid(),now());
 UPDATE public.insurance_quotes SET payment_status='paid' WHERE id=p_quote_id;
 UPDATE public.insurance_leads SET stage='paid',last_activity_at=now() WHERE id=(SELECT lead_id FROM public.insurance_quotes WHERE id=p_quote_id);
END $$;
CREATE OR REPLACE FUNCTION public.insurance_issue_policy(p_quote_id uuid, p_policy_number text, p_start_date date, p_expiry_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q record; o record; new_id uuid; BEGIN
 SELECT * INTO q FROM public.insurance_quotes WHERE id=p_quote_id FOR UPDATE;
 IF q.id IS NULL OR NOT public.insurance_org_access(q.organization_id) THEN RAISE EXCEPTION 'Quote is not available'; END IF;
 IF q.kyc_status <> 'verified' OR q.payment_status <> 'paid' OR q.selected_option_id IS NULL THEN RAISE EXCEPTION 'Selected quote requires verified KYC and paid status'; END IF;
 SELECT * INTO o FROM public.insurance_quote_options WHERE id=q.selected_option_id;
 INSERT INTO public.insurance_policies(organization_id,quote_id,customer_id,policy_number,customer_name,product_name,insurer_name,sum_insured,premium_amount,start_date,expiry_date,status,issued_at) VALUES(q.organization_id,q.id,q.customer_id,p_policy_number,q.customer_name,o.cover_name,o.provider_name,q.sum_insured,o.premium_amount,p_start_date,p_expiry_date,'active',now()) RETURNING id INTO new_id;
 UPDATE public.insurance_leads SET stage='policy_issued',last_activity_at=now() WHERE id=q.lead_id;
 RETURN new_id;
END $$;
GRANT EXECUTE ON FUNCTION public.insurance_confirm_quote_kyc(uuid), public.insurance_confirm_quote_payment(uuid,text), public.insurance_issue_policy(uuid,text,date,date) TO authenticated;
