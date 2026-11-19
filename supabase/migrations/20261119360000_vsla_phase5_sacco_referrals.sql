-- Phase 5: preserve a VSLA's identity. A SACCO referral is an approved,
-- aggregate export request, never an automatic member migration or funds transfer.
CREATE TABLE IF NOT EXISTS public.vsla_sacco_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vsla_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sacco_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending_approval' CHECK(status IN ('pending_approval','approved','rejected','withdrawn','exported')),
  reason text NOT NULL,
  financial_snapshot jsonb NOT NULL,
  requested_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  exported_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_vsla_sacco_referrals_vsla_status ON public.vsla_sacco_referrals(vsla_organization_id,status,requested_at DESC);
ALTER TABLE public.vsla_sacco_referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY vsla_sacco_referrals_read ON public.vsla_sacco_referrals FOR SELECT TO authenticated USING(public.is_platform_admin() OR vsla_organization_id=public.auth_staff_org_id() OR sacco_organization_id=public.auth_staff_org_id());
REVOKE ALL ON public.vsla_sacco_referrals FROM authenticated;
GRANT SELECT ON public.vsla_sacco_referrals TO authenticated;

CREATE OR REPLACE FUNCTION public.vsla_v12_create_sacco_referral(p_sacco_organization_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_id uuid; v_snapshot jsonb;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
  IF v_org IS NULL OR NOT public.vsla_v12_actor_has_role(v_org,NULL,ARRAY['chairperson','treasurer']) THEN RAISE EXCEPTION 'Your VSLA role cannot create a SACCO referral'; END IF;
  IF nullif(trim(coalesce(p_reason,'')),'') IS NULL OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_sacco_organization_id AND business_type='sacco') THEN RAISE EXCEPTION 'A valid SACCO organization and referral reason are required'; END IF;
  IF EXISTS(SELECT 1 FROM public.vsla_sacco_referrals WHERE vsla_organization_id=v_org AND status IN ('pending_approval','approved','exported')) THEN RAISE EXCEPTION 'An active SACCO referral already exists for this VSLA'; END IF;
  SELECT jsonb_build_object('generated_at',now(),'active_members',(SELECT count(*) FROM public.vsla_members WHERE organization_id=v_org AND status='active'),'posted_savings',(SELECT coalesce(sum(amount),0) FROM public.vsla_financial_events WHERE organization_id=v_org AND event_type='savings_received' AND status='posted'),'outstanding_loans',(SELECT coalesce(sum(outstanding_balance),0) FROM public.vsla_v12_loans WHERE organization_id=v_org AND status='disbursed'),'active_cycle',(SELECT name FROM public.vsla_cycles WHERE organization_id=v_org AND status='active' ORDER BY starts_on DESC LIMIT 1)) INTO v_snapshot;
  INSERT INTO public.vsla_sacco_referrals(vsla_organization_id,sacco_organization_id,reason,financial_snapshot,requested_by) VALUES(v_org,p_sacco_organization_id,trim(p_reason),v_snapshot,auth.uid()) RETURNING id INTO v_id;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,after_data,reason) VALUES(v_org,auth.uid(),'sacco_referral_requested','vsla_sacco_referrals',v_id,v_snapshot,trim(p_reason));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_decide_sacco_referral(p_referral_id uuid,p_approve boolean,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.vsla_sacco_referrals%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform administrator approval is required for SACCO referrals'; END IF;
  SELECT * INTO r FROM public.vsla_sacco_referrals WHERE id=p_referral_id FOR UPDATE;
  IF NOT FOUND OR r.status<>'pending_approval' THEN RAISE EXCEPTION 'SACCO referral is not pending approval'; END IF;
  UPDATE public.vsla_sacco_referrals SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,decided_by=auth.uid(),decided_at=now(),decision_note=nullif(trim(coalesce(p_note,'')),'') WHERE id=r.id;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,after_data,reason) VALUES(r.vsla_organization_id,auth.uid(),'sacco_referral_decided','vsla_sacco_referrals',r.id,jsonb_build_object('approved',p_approve),nullif(trim(coalesce(p_note,'')),''));
END $$;
REVOKE ALL ON FUNCTION public.vsla_v12_create_sacco_referral(uuid,text),public.vsla_v12_decide_sacco_referral(uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_create_sacco_referral(uuid,text),public.vsla_v12_decide_sacco_referral(uuid,boolean,text) TO authenticated;
