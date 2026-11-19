-- A material cash variance is a controlled adjustment, not a warning alone.
CREATE OR REPLACE FUNCTION public.vsla_v12_request_cash_variance_approval(p_reconciliation_id uuid,p_idempotency_key uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.vsla_v12_cash_reconciliations%ROWTYPE; v_event uuid; v_request uuid;
BEGIN
 SELECT * INTO r FROM public.vsla_v12_cash_reconciliations WHERE id=p_reconciliation_id FOR UPDATE;
 IF NOT FOUND OR r.organization_id<>public.auth_staff_org_id() OR r.status<>'requires_approval' THEN RAISE EXCEPTION 'Cash variance does not require approval'; END IF;
 IF r.approval_request_id IS NOT NULL THEN RETURN r.approval_request_id; END IF;
 SELECT id INTO v_event FROM public.vsla_financial_events WHERE organization_id=r.organization_id AND idempotency_key=p_idempotency_key;
 IF v_event IS NULL THEN
  INSERT INTO public.vsla_financial_events(organization_id,meeting_id,event_type,status,amount,effective_date,reference,idempotency_key,metadata,created_by)
  VALUES(r.organization_id,r.meeting_id,'cash_adjustment','draft',abs(r.variance),current_date,'V12-CASH-VAR-'||replace(p_idempotency_key::text,'-',''),p_idempotency_key,jsonb_build_object('reconciliation_id',r.id,'variance',r.variance),auth.uid()) RETURNING id INTO v_event;
 END IF;
 v_request:=public.vsla_v12_submit_financial_draft(v_event);
 UPDATE public.vsla_v12_cash_reconciliations SET approval_request_id=v_request WHERE id=r.id;
 RETURN v_request;
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_decide_financial_approval(p_request_id uuid,p_approve boolean,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.vsla_financial_approval_requests%ROWTYPE; e public.vsla_financial_events%ROWTYPE; p public.vsla_approval_policies%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.vsla_financial_approval_requests WHERE id=p_request_id FOR UPDATE; IF NOT FOUND OR r.organization_id<>public.auth_staff_org_id() OR r.status<>'pending' THEN RAISE EXCEPTION 'Approval request is not pending'; END IF;
 SELECT * INTO e FROM public.vsla_financial_events WHERE id=r.event_id FOR UPDATE; SELECT * INTO p FROM public.vsla_approval_policies WHERE id=r.policy_id;
 IF NOT FOUND OR NOT public.vsla_v12_actor_has_role(r.organization_id,r.group_id,p.checker_roles) THEN RAISE EXCEPTION 'Your VSLA role cannot approve this action'; END IF;
 IF p.require_distinct_users AND r.submitted_by=auth.uid() THEN RAISE EXCEPTION 'Maker and checker must be different users'; END IF;
 UPDATE public.vsla_financial_approval_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,decided_by=auth.uid(),decided_at=now(),decision_note=nullif(trim(coalesce(p_note,'')),'') WHERE id=r.id;
 UPDATE public.vsla_financial_events SET status=CASE WHEN p_approve THEN 'posted' ELSE 'rejected' END,posted_at=CASE WHEN p_approve THEN now() ELSE NULL END WHERE id=e.id;
 IF e.event_type='loan_disbursed' THEN UPDATE public.vsla_v12_loans SET status=CASE WHEN p_approve THEN 'disbursed' ELSE 'rejected' END,disbursed_at=CASE WHEN p_approve THEN now() ELSE NULL END WHERE disbursement_event_id=e.id; END IF;
 IF e.event_type='shareout_accrual' THEN UPDATE public.vsla_v12_shareouts SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,approved_at=CASE WHEN p_approve THEN now() ELSE NULL END WHERE approval_event_id=e.id; END IF;
 IF e.event_type='cash_adjustment' AND p_approve THEN UPDATE public.vsla_v12_cash_reconciliations SET status='reconciled' WHERE approval_request_id=r.id; END IF;
 RETURN e.id;
END $$;
REVOKE ALL ON FUNCTION public.vsla_v12_request_cash_variance_approval(uuid,uuid) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.vsla_v12_request_cash_variance_approval(uuid,uuid) TO authenticated;
