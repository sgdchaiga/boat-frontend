-- Phase 5: explicit, revocable aggregate-only institutional access. No member
-- records, transaction rows, contacts, or identifiers are exposed through this path.
CREATE TABLE IF NOT EXISTS public.vsla_institutional_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vsla_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  institution_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scopes text[] NOT NULL CHECK(scopes <@ ARRAY['aggregate_health','training_progress','exception_counts']::text[]),
  active boolean NOT NULL DEFAULT true,
  consented_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  consented_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  UNIQUE(vsla_organization_id,institution_organization_id)
);
ALTER TABLE public.vsla_institutional_authorizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY vsla_institutional_authorizations_read ON public.vsla_institutional_authorizations FOR SELECT TO authenticated USING(public.is_platform_admin() OR vsla_organization_id=public.auth_staff_org_id() OR institution_organization_id=public.auth_staff_org_id());
REVOKE ALL ON public.vsla_institutional_authorizations FROM authenticated;
GRANT SELECT ON public.vsla_institutional_authorizations TO authenticated;

CREATE OR REPLACE FUNCTION public.vsla_v12_set_institutional_authorization(p_institution_organization_id uuid,p_scopes text[],p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
  IF v_org IS NULL OR NOT public.vsla_v12_actor_has_role(v_org,NULL,ARRAY['chairperson','treasurer']) THEN RAISE EXCEPTION 'Your VSLA role cannot manage institutional data sharing'; END IF;
  IF p_institution_organization_id IS NULL OR p_scopes IS NULL OR NOT (p_scopes <@ ARRAY['aggregate_health','training_progress','exception_counts']::text[]) THEN RAISE EXCEPTION 'Institutional authorization scopes are invalid'; END IF;
  INSERT INTO public.vsla_institutional_authorizations(vsla_organization_id,institution_organization_id,scopes,active,consented_by,consented_at,revoked_by,revoked_at)
  VALUES(v_org,p_institution_organization_id,p_scopes,p_active,CASE WHEN p_active THEN auth.uid() ELSE NULL END,now(),CASE WHEN p_active THEN NULL ELSE auth.uid() END,CASE WHEN p_active THEN NULL ELSE now() END)
  ON CONFLICT(vsla_organization_id,institution_organization_id) DO UPDATE SET scopes=EXCLUDED.scopes,active=EXCLUDED.active,consented_by=CASE WHEN EXCLUDED.active THEN auth.uid() ELSE vsla_institutional_authorizations.consented_by END,consented_at=CASE WHEN EXCLUDED.active THEN now() ELSE vsla_institutional_authorizations.consented_at END,revoked_by=CASE WHEN EXCLUDED.active THEN NULL ELSE auth.uid() END,revoked_at=CASE WHEN EXCLUDED.active THEN NULL ELSE now() END;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,after_data) VALUES(v_org,auth.uid(),'institutional_data_sharing_updated','vsla_institutional_authorizations',jsonb_build_object('institution_organization_id',p_institution_organization_id,'scopes',p_scopes,'active',p_active));
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_institutional_overview()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_institution uuid;
BEGIN
  SELECT organization_id INTO v_institution FROM public.staff WHERE id=auth.uid();
  IF v_institution IS NULL THEN RAISE EXCEPTION 'Staff authorization required'; END IF;
  RETURN jsonb_build_object('groups',coalesce((SELECT jsonb_agg(jsonb_build_object('organization_id',a.vsla_organization_id,'group_name',o.name,'active_cycle',c.name,'active_members',coalesce(m.active_members,0),'posted_savings',coalesce(f.savings,0),'outstanding_loans',coalesce(l.outstanding,0),'unresolved_payment_exceptions',coalesce(x.exceptions,0)) ORDER BY o.name) FROM public.vsla_institutional_authorizations a JOIN public.organizations o ON o.id=a.vsla_organization_id LEFT JOIN LATERAL(SELECT name FROM public.vsla_cycles WHERE organization_id=a.vsla_organization_id AND status='active' ORDER BY starts_on DESC LIMIT 1) c ON true LEFT JOIN LATERAL(SELECT count(*) active_members FROM public.vsla_members WHERE organization_id=a.vsla_organization_id AND status='active') m ON true LEFT JOIN LATERAL(SELECT sum(amount) savings FROM public.vsla_financial_events WHERE organization_id=a.vsla_organization_id AND event_type='savings_received' AND status='posted') f ON true LEFT JOIN LATERAL(SELECT sum(outstanding_balance) outstanding FROM public.vsla_v12_loans WHERE organization_id=a.vsla_organization_id AND status='disbursed') l ON true LEFT JOIN LATERAL(SELECT count(*) exceptions FROM public.boat_pay_payment_intents WHERE organization_id=a.vsla_organization_id AND status='reversal_pending') x ON true WHERE a.institution_organization_id=v_institution AND a.active AND 'aggregate_health'=ANY(a.scopes)),'[]'::jsonb),'privacy','Aggregate-only: individual members, transactions, and contact information are intentionally excluded.');
END $$;
REVOKE ALL ON FUNCTION public.vsla_v12_set_institutional_authorization(uuid,text[],boolean),public.vsla_v12_institutional_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_set_institutional_authorization(uuid,text[],boolean),public.vsla_v12_institutional_overview() TO authenticated;
