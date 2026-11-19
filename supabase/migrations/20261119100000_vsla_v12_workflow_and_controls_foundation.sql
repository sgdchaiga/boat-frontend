-- BOAT VSLA v1.2 / Phase 1 foundation.
-- This is deliberately additive: existing organizations remain on the legacy
-- workflow until a platform administrator explicitly enables v1_2.

CREATE TABLE IF NOT EXISTS public.vsla_workflow_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  workflow_version text NOT NULL DEFAULT 'legacy'
    CHECK (workflow_version IN ('legacy', 'v1_2')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  change_reason text
);

INSERT INTO public.vsla_workflow_settings (organization_id, workflow_version, change_reason)
SELECT id, 'legacy', 'v1.2 control foundation rollout'
FROM public.organizations WHERE business_type = 'vsla'
ON CONFLICT (organization_id) DO NOTHING;

ALTER TABLE public.vsla_workflow_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vsla_workflow_settings_read ON public.vsla_workflow_settings;
CREATE POLICY vsla_workflow_settings_read ON public.vsla_workflow_settings FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR organization_id = public.auth_staff_org_id());
REVOKE ALL ON public.vsla_workflow_settings FROM authenticated;
GRANT SELECT ON public.vsla_workflow_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.set_vsla_workflow_version(
  p_organization_id uuid,
  p_workflow_version text,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform administrator access is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id=p_organization_id AND business_type='vsla') THEN
    RAISE EXCEPTION 'VSLA organization not found';
  END IF;
  IF p_workflow_version NOT IN ('legacy','v1_2') THEN RAISE EXCEPTION 'Unsupported VSLA workflow version'; END IF;
  INSERT INTO public.vsla_workflow_settings(organization_id,workflow_version,changed_at,changed_by,change_reason)
  VALUES(p_organization_id,p_workflow_version,now(),auth.uid(),nullif(trim(coalesce(p_reason,'')),''))
  ON CONFLICT(organization_id) DO UPDATE SET workflow_version=EXCLUDED.workflow_version,
    changed_at=EXCLUDED.changed_at,changed_by=EXCLUDED.changed_by,change_reason=EXCLUDED.change_reason;
END; $$;
REVOKE ALL ON FUNCTION public.set_vsla_workflow_version(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_vsla_workflow_version(uuid,text,text) TO authenticated;

-- Group-specific roles are separate from staff roles, enabling a member of a
-- supporting institution to be an auditor without receiving operating rights.
CREATE TABLE IF NOT EXISTS public.vsla_group_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_id uuid REFERENCES public.vsla_groups(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.vsla_members(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('chairperson','treasurer','secretary','loan_committee','member','group_auditor','institutional_supervisor')),
  active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CHECK (staff_id IS NOT NULL OR member_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vsla_group_role_staff ON public.vsla_group_role_assignments(group_id,staff_id,role) WHERE staff_id IS NOT NULL AND active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vsla_group_role_member ON public.vsla_group_role_assignments(group_id,member_id,role) WHERE member_id IS NOT NULL AND active;
ALTER TABLE public.vsla_group_role_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY vsla_group_role_assignments_read ON public.vsla_group_role_assignments FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
CREATE POLICY vsla_group_role_assignments_manage ON public.vsla_group_role_assignments FOR ALL TO authenticated
  USING (public.is_platform_admin() OR organization_id=public.auth_staff_org_id())
  WITH CHECK (public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
GRANT SELECT,INSERT,UPDATE ON public.vsla_group_role_assignments TO authenticated;

-- v1.2 events are append-only. Legacy tables are intentionally untouched so
-- historical data and the legacy workflow remain available during migration.
CREATE TABLE IF NOT EXISTS public.vsla_financial_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_id uuid REFERENCES public.vsla_groups(id) ON DELETE RESTRICT,
  cycle_id uuid REFERENCES public.vsla_cycles(id) ON DELETE RESTRICT,
  member_id uuid REFERENCES public.vsla_members(id) ON DELETE RESTRICT,
  meeting_id uuid REFERENCES public.vsla_meetings(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('savings_received','loan_disbursed','loan_repayment','fine_received','social_fund_received','social_fund_paid','expense_paid','cash_adjustment','shareout_accrual','shareout_payment','reversal')),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','pending_approval','posted','reversed','rejected')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  effective_date date NOT NULL DEFAULT current_date,
  reference text NOT NULL,
  idempotency_key uuid NOT NULL,
  reversal_of_id uuid REFERENCES public.vsla_financial_events(id) ON DELETE RESTRICT,
  approval_request_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  UNIQUE(organization_id,reference),
  UNIQUE(organization_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_vsla_financial_events_org_date ON public.vsla_financial_events(organization_id,effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_vsla_financial_events_cycle ON public.vsla_financial_events(cycle_id,created_at DESC);
ALTER TABLE public.vsla_financial_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY vsla_financial_events_read ON public.vsla_financial_events FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
REVOKE ALL ON public.vsla_financial_events FROM authenticated;
GRANT SELECT ON public.vsla_financial_events TO authenticated;

CREATE TABLE IF NOT EXISTS public.vsla_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text,
  approval_reference uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vsla_audit_events_org_created ON public.vsla_audit_events(organization_id,created_at DESC);
ALTER TABLE public.vsla_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY vsla_audit_events_read ON public.vsla_audit_events FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
REVOKE ALL ON public.vsla_audit_events FROM authenticated;
GRANT SELECT ON public.vsla_audit_events TO authenticated;

CREATE OR REPLACE FUNCTION public.vsla_v12_capture_audit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_id uuid; v_action text;
BEGIN
  v_org := COALESCE(NEW.organization_id, OLD.organization_id);
  v_id := COALESCE(NEW.id, OLD.id);
  v_action := lower(TG_OP) || ':' || TG_TABLE_NAME;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,before_data,after_data)
  VALUES(v_org,auth.uid(),v_action,TG_TABLE_NAME,v_id,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END);
  RETURN COALESCE(NEW,OLD);
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_protect_posted_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'VSLA v1.2 financial events are immutable; post a reversal instead'; END IF;
  IF OLD.status IN ('posted','reversed') THEN RAISE EXCEPTION 'Posted VSLA v1.2 financial events are immutable; post a reversal instead'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_vsla_v12_event_audit ON public.vsla_financial_events;
CREATE TRIGGER trg_vsla_v12_event_audit AFTER INSERT OR UPDATE ON public.vsla_financial_events
FOR EACH ROW EXECUTE FUNCTION public.vsla_v12_capture_audit_event();
DROP TRIGGER IF EXISTS trg_vsla_v12_event_immutable ON public.vsla_financial_events;
CREATE TRIGGER trg_vsla_v12_event_immutable BEFORE UPDATE OR DELETE ON public.vsla_financial_events
FOR EACH ROW EXECUTE FUNCTION public.vsla_v12_protect_posted_event();

CREATE OR REPLACE FUNCTION public.vsla_v12_post_financial_event(
  p_event_type text, p_amount numeric, p_idempotency_key uuid, p_reference text,
  p_group_id uuid DEFAULT NULL, p_cycle_id uuid DEFAULT NULL, p_member_id uuid DEFAULT NULL,
  p_meeting_id uuid DEFAULT NULL, p_effective_date date DEFAULT current_date,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_id uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
  IF v_org IS NULL THEN RAISE EXCEPTION 'Staff authorization required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vsla_workflow_settings WHERE organization_id=v_org AND workflow_version='v1_2') THEN
    RAISE EXCEPTION 'VSLA v1.2 is not enabled for this organization';
  END IF;
  IF p_amount<=0 OR nullif(trim(coalesce(p_reference,'')),'') IS NULL THEN RAISE EXCEPTION 'A positive amount and reference are required'; END IF;
  SELECT id INTO v_id FROM public.vsla_financial_events
  WHERE organization_id=v_org AND idempotency_key=p_idempotency_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.vsla_financial_events(organization_id,group_id,cycle_id,member_id,meeting_id,event_type,amount,effective_date,reference,idempotency_key,metadata,created_by,posted_at)
  VALUES(v_org,p_group_id,p_cycle_id,p_member_id,p_meeting_id,p_event_type,p_amount,coalesce(p_effective_date,current_date),trim(p_reference),p_idempotency_key,coalesce(p_metadata,'{}'::jsonb),auth.uid(),now())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.vsla_v12_post_financial_event(text,numeric,uuid,text,uuid,uuid,uuid,uuid,date,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_post_financial_event(text,numeric,uuid,text,uuid,uuid,uuid,uuid,date,jsonb) TO authenticated;
