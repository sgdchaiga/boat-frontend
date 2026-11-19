-- Guided v1.2 operating rules. The server is the only configuration writer.
CREATE TABLE IF NOT EXISTS public.vsla_v12_group_configuration (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
 default_interest_rate numeric(9,4) NOT NULL DEFAULT 10 CHECK(default_interest_rate>=0), default_loan_term_meetings integer NOT NULL DEFAULT 4 CHECK(default_loan_term_meetings>0),
 meeting_schedule text, updated_by uuid REFERENCES public.staff(id), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vsla_v12_group_configuration ENABLE ROW LEVEL SECURITY;
CREATE POLICY vsla_v12_group_configuration_read ON public.vsla_v12_group_configuration FOR SELECT TO authenticated USING(public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
REVOKE ALL ON public.vsla_v12_group_configuration FROM authenticated; GRANT SELECT ON public.vsla_v12_group_configuration TO authenticated;
CREATE OR REPLACE FUNCTION public.vsla_v12_update_configuration(p_share_value numeric,p_max_shares integer,p_interest_rate numeric,p_loan_term integer,p_allowed_variance numeric,p_meeting_schedule text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid;
BEGIN
 SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
 IF v_org IS NULL OR NOT EXISTS(SELECT 1 FROM public.vsla_workflow_settings WHERE organization_id=v_org AND workflow_version='v1_2') THEN RAISE EXCEPTION 'VSLA v1.2 is not enabled for this organization'; END IF;
 IF NOT public.vsla_v12_actor_has_role(v_org,NULL,ARRAY['chairperson','treasurer','secretary']) THEN RAISE EXCEPTION 'Your VSLA role cannot change group configuration'; END IF;
 IF p_share_value<=0 OR p_max_shares<=0 OR p_interest_rate<0 OR p_loan_term<=0 OR p_allowed_variance<0 THEN RAISE EXCEPTION 'Configuration values are invalid'; END IF;
 INSERT INTO public.vsla_settings(organization_id,share_value,max_shares_per_meeting) VALUES(v_org,p_share_value,p_max_shares) ON CONFLICT(organization_id) DO UPDATE SET share_value=EXCLUDED.share_value,max_shares_per_meeting=EXCLUDED.max_shares_per_meeting;
 INSERT INTO public.vsla_cash_reconciliation_controls(organization_id,allowed_variance,updated_by) VALUES(v_org,p_allowed_variance,auth.uid()) ON CONFLICT(organization_id) DO UPDATE SET allowed_variance=EXCLUDED.allowed_variance,updated_by=EXCLUDED.updated_by,updated_at=now();
 INSERT INTO public.vsla_v12_group_configuration(organization_id,default_interest_rate,default_loan_term_meetings,meeting_schedule,updated_by) VALUES(v_org,p_interest_rate,p_loan_term,nullif(trim(coalesce(p_meeting_schedule,'')),''),auth.uid()) ON CONFLICT(organization_id) DO UPDATE SET default_interest_rate=EXCLUDED.default_interest_rate,default_loan_term_meetings=EXCLUDED.default_loan_term_meetings,meeting_schedule=EXCLUDED.meeting_schedule,updated_by=EXCLUDED.updated_by,updated_at=now();
END $$;
REVOKE ALL ON FUNCTION public.vsla_v12_update_configuration(numeric,integer,numeric,integer,numeric,text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.vsla_v12_update_configuration(numeric,integer,numeric,integer,numeric,text) TO authenticated;
