-- Phase 5: explainable loan decision support. This is advisory only and never
-- creates, approves, or changes a loan.
CREATE TABLE IF NOT EXISTS public.vsla_v12_eligibility_policies (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  minimum_savings numeric(18,2) NOT NULL DEFAULT 0 CHECK(minimum_savings>=0),
  minimum_savings_meetings integer NOT NULL DEFAULT 3 CHECK(minimum_savings_meetings>=0),
  minimum_repayment_rate numeric(5,2) NOT NULL DEFAULT 80 CHECK(minimum_repayment_rate BETWEEN 0 AND 100),
  maximum_loan_to_savings_ratio numeric(8,2) NOT NULL DEFAULT 3 CHECK(maximum_loan_to_savings_ratio>0),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.staff(id) ON DELETE SET NULL
);
ALTER TABLE public.vsla_v12_eligibility_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY vsla_v12_eligibility_policies_read ON public.vsla_v12_eligibility_policies FOR SELECT TO authenticated USING(public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
REVOKE ALL ON public.vsla_v12_eligibility_policies FROM authenticated;
GRANT SELECT ON public.vsla_v12_eligibility_policies TO authenticated;

CREATE OR REPLACE FUNCTION public.vsla_v12_assess_loan_eligibility(p_member_id uuid,p_requested_amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; p public.vsla_v12_eligibility_policies%ROWTYPE; v_savings numeric:=0; v_saving_meetings integer:=0; v_active_debt numeric:=0; v_total_due numeric:=0; v_total_paid numeric:=0; v_repayment_rate numeric; v_max_amount numeric; v_conditions jsonb; v_recommendation text;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
  IF v_org IS NULL OR NOT EXISTS(SELECT 1 FROM public.vsla_workflow_settings WHERE organization_id=v_org AND workflow_version='v1_2') THEN RAISE EXCEPTION 'VSLA v1.2 is not enabled for this organization'; END IF;
  IF p_requested_amount<=0 OR NOT EXISTS(SELECT 1 FROM public.vsla_members WHERE id=p_member_id AND organization_id=v_org AND status='active') THEN RAISE EXCEPTION 'An active member and positive requested amount are required'; END IF;
  SELECT * INTO p FROM public.vsla_v12_eligibility_policies WHERE organization_id=v_org;
  IF NOT FOUND THEN INSERT INTO public.vsla_v12_eligibility_policies(organization_id,updated_by) VALUES(v_org,auth.uid()) RETURNING * INTO p; END IF;
  SELECT coalesce(sum(amount),0),count(DISTINCT meeting_id) INTO v_savings,v_saving_meetings FROM public.vsla_financial_events WHERE organization_id=v_org AND member_id=p_member_id AND event_type='savings_received' AND status='posted';
  SELECT coalesce(sum(outstanding_balance),0),coalesce(sum(total_due),0),coalesce(sum(total_due-outstanding_balance),0) INTO v_active_debt,v_total_due,v_total_paid FROM public.vsla_v12_loans WHERE organization_id=v_org AND member_id=p_member_id AND status IN ('disbursed','closed');
  v_repayment_rate:=CASE WHEN v_total_due>0 THEN round(v_total_paid*100/v_total_due,2) ELSE NULL END;
  v_max_amount:=greatest(0,round(v_savings*p.maximum_loan_to_savings_ratio-v_active_debt,2));
  v_conditions:=jsonb_build_array(
    jsonb_build_object('rule','minimum_savings','passed',v_savings>=p.minimum_savings,'actual',v_savings,'required',p.minimum_savings),
    jsonb_build_object('rule','savings_history','passed',v_saving_meetings>=p.minimum_savings_meetings,'actual',v_saving_meetings,'required',p.minimum_savings_meetings),
    jsonb_build_object('rule','repayment_performance','passed',v_repayment_rate IS NULL OR v_repayment_rate>=p.minimum_repayment_rate,'actual',v_repayment_rate,'required',p.minimum_repayment_rate),
    jsonb_build_object('rule','exposure_limit','passed',p_requested_amount<=v_max_amount,'actual',p_requested_amount,'maximum',v_max_amount)
  );
  v_recommendation:=CASE WHEN v_savings<p.minimum_savings OR v_saving_meetings<p.minimum_savings_meetings OR (v_repayment_rate IS NOT NULL AND v_repayment_rate<p.minimum_repayment_rate) THEN 'not_recommended' WHEN p_requested_amount>v_max_amount THEN 'needs_review' ELSE 'within_policy' END;
  RETURN jsonb_build_object('member_id',p_member_id,'requested_amount',p_requested_amount,'recommended_maximum',v_max_amount,'recommendation',v_recommendation,'advisory',true,'conditions',v_conditions,'explanation','This decision support does not approve, reject, or create a loan. The group retains its independent approval workflow.');
END $$;
REVOKE ALL ON FUNCTION public.vsla_v12_assess_loan_eligibility(uuid,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_assess_loan_eligibility(uuid,numeric) TO authenticated;
