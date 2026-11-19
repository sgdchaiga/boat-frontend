-- BOAT VSLA v1.2 / Phase 1 completion: variance approval and calculated share-out.
ALTER TABLE public.vsla_v12_cash_reconciliations ADD COLUMN IF NOT EXISTS approval_request_id uuid REFERENCES public.vsla_financial_approval_requests(id) ON DELETE RESTRICT;
CREATE TABLE IF NOT EXISTS public.vsla_v12_shareouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, cycle_id uuid NOT NULL REFERENCES public.vsla_cycles(id) ON DELETE RESTRICT,
 approval_event_id uuid UNIQUE REFERENCES public.vsla_financial_events(id) ON DELETE RESTRICT, status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','pending_approval','approved','rejected')),
 distributable_fund numeric(18,2) NOT NULL, total_shares numeric(18,2) NOT NULL, value_per_share numeric(18,6) NOT NULL, payout_schedule jsonb NOT NULL, prepared_by uuid REFERENCES public.staff(id), prepared_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz, UNIQUE(cycle_id)
);
ALTER TABLE public.vsla_v12_shareouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY vsla_v12_shareout_read ON public.vsla_v12_shareouts FOR SELECT TO authenticated USING(public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
REVOKE ALL ON public.vsla_v12_shareouts FROM authenticated; GRANT SELECT ON public.vsla_v12_shareouts TO authenticated;

CREATE OR REPLACE FUNCTION public.vsla_v12_prepare_shareout(p_cycle_id uuid,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.vsla_cycles%ROWTYPE; v_fund numeric; v_shares numeric; v_value numeric; v_sheet jsonb; v_id uuid; v_event uuid; v_request uuid;
BEGIN
 SELECT * INTO c FROM public.vsla_cycles WHERE id=p_cycle_id FOR UPDATE;
 IF NOT FOUND OR c.organization_id<>public.auth_staff_org_id() OR c.status<>'active' THEN RAISE EXCEPTION 'Active VSLA cycle not found'; END IF;
 IF EXISTS(SELECT 1 FROM public.vsla_v12_loans WHERE cycle_id=c.id AND status='disbursed' AND outstanding_balance>0) THEN RAISE EXCEPTION 'Resolve outstanding v1.2 loans before share-out'; END IF;
 SELECT coalesce(sum(amount) FILTER(WHERE event_type IN('savings_received','loan_repayment','fine_received')),0)-coalesce(sum(amount) FILTER(WHERE event_type IN('loan_disbursed','expense_paid','shareout_payment')),0),coalesce(sum((metadata->>'shares')::numeric) FILTER(WHERE event_type='savings_received'),0) INTO v_fund,v_shares FROM public.vsla_financial_events WHERE cycle_id=c.id AND status='posted';
 IF v_fund<=0 OR v_shares<=0 THEN RAISE EXCEPTION 'A positive reconciled fund and shares are required for share-out'; END IF;
 v_value:=v_fund/v_shares;
 SELECT jsonb_agg(jsonb_build_object('member_id',member_id,'shares',shares,'payout_amount',round(shares*v_value,2)) ORDER BY member_id) INTO v_sheet FROM (SELECT member_id,sum((metadata->>'shares')::numeric) shares FROM public.vsla_financial_events WHERE cycle_id=c.id AND event_type='savings_received' AND status='posted' GROUP BY member_id) x;
 INSERT INTO public.vsla_v12_shareouts(organization_id,cycle_id,distributable_fund,total_shares,value_per_share,payout_schedule,prepared_by) VALUES(c.organization_id,c.id,v_fund,v_shares,v_value,v_sheet,auth.uid()) RETURNING id INTO v_id;
 INSERT INTO public.vsla_financial_events(organization_id,cycle_id,event_type,status,amount,effective_date,reference,idempotency_key,metadata,created_by) VALUES(c.organization_id,c.id,'shareout_accrual','draft',v_fund,current_date,'V12-SHAREOUT-'||replace(p_idempotency_key::text,'-',''),p_idempotency_key,jsonb_build_object('shareout_id',v_id),auth.uid()) RETURNING id INTO v_event;
 UPDATE public.vsla_v12_shareouts SET approval_event_id=v_event,status='pending_approval' WHERE id=v_id; v_request:=public.vsla_v12_submit_financial_draft(v_event);
 RETURN jsonb_build_object('shareout_id',v_id,'approval_request_id',v_request);
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
 RETURN e.id;
END $$;
REVOKE ALL ON FUNCTION public.vsla_v12_prepare_shareout(uuid,uuid) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.vsla_v12_prepare_shareout(uuid,uuid) TO authenticated;
