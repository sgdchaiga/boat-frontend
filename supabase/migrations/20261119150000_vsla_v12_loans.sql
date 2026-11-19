-- BOAT VSLA v1.2 / Phase 1: approved loan disbursement and controlled repayment.
CREATE TABLE IF NOT EXISTS public.vsla_v12_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cycle_id uuid REFERENCES public.vsla_cycles(id) ON DELETE RESTRICT, member_id uuid NOT NULL REFERENCES public.vsla_members(id) ON DELETE RESTRICT,
  request_meeting_id uuid NOT NULL REFERENCES public.vsla_meetings(id) ON DELETE RESTRICT,
  disbursement_event_id uuid UNIQUE REFERENCES public.vsla_financial_events(id) ON DELETE RESTRICT,
  principal_amount numeric(18,2) NOT NULL CHECK(principal_amount>0), interest_rate_percent numeric(9,4) NOT NULL DEFAULT 0 CHECK(interest_rate_percent>=0),
  duration_meetings integer NOT NULL CHECK(duration_meetings>0), total_due numeric(18,2) NOT NULL, outstanding_balance numeric(18,2) NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','pending_approval','disbursed','closed','rejected')), created_by uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now(), disbursed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_vsla_v12_loans_org_member ON public.vsla_v12_loans(organization_id,member_id,status);
ALTER TABLE public.vsla_v12_loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY vsla_v12_loans_read ON public.vsla_v12_loans FOR SELECT TO authenticated USING(public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
REVOKE ALL ON public.vsla_v12_loans FROM authenticated; GRANT SELECT ON public.vsla_v12_loans TO authenticated;

CREATE OR REPLACE FUNCTION public.vsla_v12_request_loan(p_meeting_id uuid,p_member_id uuid,p_principal numeric,p_interest_rate numeric,p_duration integer,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_cycle uuid; v_loan uuid; v_event uuid; v_request uuid; v_total numeric; v_ref text;
BEGIN
  SELECT organization_id,cycle_id INTO v_org,v_cycle FROM public.vsla_meetings WHERE id=p_meeting_id AND status='open' FOR UPDATE;
  IF v_org IS NULL OR v_org<>public.auth_staff_org_id() THEN RAISE EXCEPTION 'Open meeting not found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vsla_workflow_settings WHERE organization_id=v_org AND workflow_version='v1_2') THEN RAISE EXCEPTION 'VSLA v1.2 is not enabled for this organization'; END IF;
  IF p_principal<=0 OR p_interest_rate<0 OR p_duration<=0 THEN RAISE EXCEPTION 'Loan amount, interest rate, and term must be valid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vsla_members WHERE id=p_member_id AND organization_id=v_org AND status='active') THEN RAISE EXCEPTION 'Active member not found'; END IF;
  SELECT id INTO v_event FROM public.vsla_financial_events WHERE organization_id=v_org AND idempotency_key=p_idempotency_key;
  IF v_event IS NOT NULL THEN RETURN (SELECT jsonb_build_object('event_id',v_event,'loan_id',metadata->>'loan_id') FROM public.vsla_financial_events WHERE id=v_event); END IF;
  v_total:=p_principal+(p_principal*p_interest_rate/100*p_duration); v_ref:='V12-LOAN-'||replace(p_idempotency_key::text,'-','');
  INSERT INTO public.vsla_v12_loans(organization_id,cycle_id,member_id,request_meeting_id,principal_amount,interest_rate_percent,duration_meetings,total_due,outstanding_balance,created_by)
  VALUES(v_org,v_cycle,p_member_id,p_meeting_id,p_principal,p_interest_rate,p_duration,v_total,v_total,auth.uid()) RETURNING id INTO v_loan;
  INSERT INTO public.vsla_financial_events(organization_id,cycle_id,member_id,meeting_id,event_type,status,amount,effective_date,reference,idempotency_key,metadata,created_by)
  VALUES(v_org,v_cycle,p_member_id,p_meeting_id,'loan_disbursed','draft',p_principal,current_date,v_ref,p_idempotency_key,jsonb_build_object('loan_id',v_loan),auth.uid()) RETURNING id INTO v_event;
  UPDATE public.vsla_v12_loans SET disbursement_event_id=v_event WHERE id=v_loan;
  v_request:=public.vsla_v12_submit_financial_draft(v_event);
  UPDATE public.vsla_v12_loans SET status='pending_approval' WHERE id=v_loan;
  RETURN jsonb_build_object('loan_id',v_loan,'event_id',v_event,'approval_request_id',v_request);
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_decide_financial_approval(p_request_id uuid,p_approve boolean,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.vsla_financial_approval_requests%ROWTYPE; e public.vsla_financial_events%ROWTYPE; p public.vsla_approval_policies%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.vsla_financial_approval_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR r.organization_id<>public.auth_staff_org_id() OR r.status<>'pending' THEN RAISE EXCEPTION 'Approval request is not pending'; END IF;
  SELECT * INTO e FROM public.vsla_financial_events WHERE id=r.event_id FOR UPDATE; SELECT * INTO p FROM public.vsla_approval_policies WHERE id=r.policy_id;
  IF NOT FOUND OR NOT public.vsla_v12_actor_has_role(r.organization_id,r.group_id,p.checker_roles) THEN RAISE EXCEPTION 'Your VSLA role cannot approve this action'; END IF;
  IF p.require_distinct_users AND r.submitted_by=auth.uid() THEN RAISE EXCEPTION 'Maker and checker must be different users'; END IF;
  UPDATE public.vsla_financial_approval_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,decided_by=auth.uid(),decided_at=now(),decision_note=nullif(trim(coalesce(p_note,'')),'') WHERE id=r.id;
  UPDATE public.vsla_financial_events SET status=CASE WHEN p_approve THEN 'posted' ELSE 'rejected' END,posted_at=CASE WHEN p_approve THEN now() ELSE NULL END WHERE id=e.id;
  IF e.event_type='loan_disbursed' THEN UPDATE public.vsla_v12_loans SET status=CASE WHEN p_approve THEN 'disbursed' ELSE 'rejected' END,disbursed_at=CASE WHEN p_approve THEN now() ELSE NULL END WHERE disbursement_event_id=e.id; END IF;
  RETURN e.id;
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_receive_loan_repayment(p_meeting_id uuid,p_loan_id uuid,p_amount numeric,p_idempotency_key uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.vsla_meetings%ROWTYPE; l public.vsla_v12_loans%ROWTYPE; v_id uuid; v_ref text; v_balance numeric;
BEGIN
  SELECT * INTO m FROM public.vsla_meetings WHERE id=p_meeting_id AND status='open' FOR UPDATE; SELECT * INTO l FROM public.vsla_v12_loans WHERE id=p_loan_id FOR UPDATE;
  IF m.id IS NULL OR l.id IS NULL OR m.organization_id<>l.organization_id OR m.organization_id<>public.auth_staff_org_id() THEN RAISE EXCEPTION 'Open meeting or loan not found'; END IF;
  IF l.status<>'disbursed' OR p_amount<=0 OR p_amount>l.outstanding_balance THEN RAISE EXCEPTION 'Repayment must be positive and cannot exceed the outstanding balance'; END IF;
  SELECT id INTO v_id FROM public.vsla_financial_events WHERE organization_id=m.organization_id AND idempotency_key=p_idempotency_key; IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  v_balance:=l.outstanding_balance-p_amount; v_ref:='V12-REPAY-'||replace(p_idempotency_key::text,'-','');
  INSERT INTO public.vsla_financial_events(organization_id,cycle_id,member_id,meeting_id,event_type,status,amount,effective_date,reference,idempotency_key,metadata,created_by,posted_at)
  VALUES(m.organization_id,l.cycle_id,l.member_id,m.id,'loan_repayment','posted',p_amount,current_date,v_ref,p_idempotency_key,jsonb_build_object('loan_id',l.id,'balance_after',v_balance),auth.uid(),now()) RETURNING id INTO v_id;
  UPDATE public.vsla_v12_loans SET outstanding_balance=v_balance,status=CASE WHEN v_balance=0 THEN 'closed' ELSE status END WHERE id=l.id; RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.vsla_v12_request_loan(uuid,uuid,numeric,numeric,integer,uuid),public.vsla_v12_receive_loan_repayment(uuid,uuid,numeric,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_request_loan(uuid,uuid,numeric,numeric,integer,uuid),public.vsla_v12_receive_loan_repayment(uuid,uuid,numeric,uuid) TO authenticated;
