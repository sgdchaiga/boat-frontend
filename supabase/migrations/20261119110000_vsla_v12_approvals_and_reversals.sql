-- BOAT VSLA v1.2 / Phase 1: restricted-event approvals and correction by reversal.
-- This migration applies only to v1.2 events; legacy VSLA records stay intact.

CREATE TABLE IF NOT EXISTS public.vsla_approval_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('loan_disbursed','expense_paid','cash_adjustment','shareout_accrual','shareout_payment','reversal')),
  minimum_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (minimum_amount >= 0),
  maker_roles text[] NOT NULL DEFAULT ARRAY['treasurer','secretary','chairperson'],
  checker_roles text[] NOT NULL DEFAULT ARRAY['chairperson','group_auditor','institutional_supervisor'],
  require_distinct_users boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, transaction_type)
);

CREATE TABLE IF NOT EXISTS public.vsla_financial_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES public.vsla_approval_policies(id) ON DELETE SET NULL,
  event_id uuid NOT NULL REFERENCES public.vsla_financial_events(id) ON DELETE RESTRICT,
  group_id uuid REFERENCES public.vsla_groups(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  submitted_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  UNIQUE (event_id)
);
CREATE INDEX IF NOT EXISTS idx_vsla_v12_approval_queue ON public.vsla_financial_approval_requests(organization_id,status,submitted_at);

ALTER TABLE public.vsla_financial_events
  ADD CONSTRAINT vsla_financial_events_approval_request_fkey
  FOREIGN KEY (approval_request_id) REFERENCES public.vsla_financial_approval_requests(id) ON DELETE RESTRICT;

ALTER TABLE public.vsla_approval_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vsla_financial_approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY vsla_approval_policies_read ON public.vsla_approval_policies FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
CREATE POLICY vsla_approval_policies_manage ON public.vsla_approval_policies FOR ALL TO authenticated
  USING (public.is_platform_admin() OR organization_id=public.auth_staff_org_id())
  WITH CHECK (public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
CREATE POLICY vsla_financial_approval_requests_read ON public.vsla_financial_approval_requests FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
DROP POLICY IF EXISTS vsla_group_role_assignments_manage ON public.vsla_group_role_assignments;
CREATE POLICY vsla_group_role_assignments_manage ON public.vsla_group_role_assignments FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
DROP POLICY IF EXISTS vsla_approval_policies_manage ON public.vsla_approval_policies;
CREATE POLICY vsla_approval_policies_manage ON public.vsla_approval_policies FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
REVOKE ALL ON public.vsla_financial_approval_requests FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.vsla_approval_policies TO authenticated;
GRANT SELECT ON public.vsla_financial_approval_requests TO authenticated;

-- Baseline policies are installed when an organization enters v1.2. They can
-- only be altered by a platform administrator, preventing a maker from
-- loosening the rule that protects their own transaction.
CREATE OR REPLACE FUNCTION public.set_vsla_workflow_version(
  p_organization_id uuid, p_workflow_version text, p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform administrator access is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id=p_organization_id AND business_type='vsla') THEN RAISE EXCEPTION 'VSLA organization not found'; END IF;
  IF p_workflow_version NOT IN ('legacy','v1_2') THEN RAISE EXCEPTION 'Unsupported VSLA workflow version'; END IF;
  INSERT INTO public.vsla_workflow_settings(organization_id,workflow_version,changed_at,changed_by,change_reason)
  VALUES(p_organization_id,p_workflow_version,now(),auth.uid(),nullif(trim(coalesce(p_reason,'')),''))
  ON CONFLICT(organization_id) DO UPDATE SET workflow_version=EXCLUDED.workflow_version,changed_at=EXCLUDED.changed_at,
    changed_by=EXCLUDED.changed_by,change_reason=EXCLUDED.change_reason;
  IF p_workflow_version='v1_2' THEN
    INSERT INTO public.vsla_approval_policies(organization_id,transaction_type,created_by)
    SELECT p_organization_id, rule.transaction_type, auth.uid()
    FROM unnest(ARRAY['loan_disbursed','expense_paid','cash_adjustment','shareout_accrual','shareout_payment','reversal']::text[]) AS rule(transaction_type)
    ON CONFLICT(organization_id,transaction_type) DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_actor_has_role(
  p_organization_id uuid, p_group_id uuid, p_roles text[]
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.vsla_group_role_assignments a
    WHERE a.organization_id=p_organization_id AND a.active AND a.staff_id=auth.uid()
      AND (a.group_id IS NULL OR a.group_id=p_group_id)
      AND lower(a.role)=ANY(ARRAY(SELECT lower(x) FROM unnest(p_roles) AS x))
  )
$$;
REVOKE ALL ON FUNCTION public.vsla_v12_actor_has_role(uuid,uuid,text[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.vsla_v12_create_financial_draft(
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
  IF p_event_type NOT IN ('loan_disbursed','expense_paid','cash_adjustment','shareout_accrual','shareout_payment','reversal') THEN
    RAISE EXCEPTION 'Only restricted v1.2 actions may be created as financial drafts';
  END IF;
  IF p_amount<=0 OR nullif(trim(coalesce(p_reference,'')),'') IS NULL THEN RAISE EXCEPTION 'A positive amount and reference are required'; END IF;
  SELECT id INTO v_id FROM public.vsla_financial_events WHERE organization_id=v_org AND idempotency_key=p_idempotency_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.vsla_financial_events(organization_id,group_id,cycle_id,member_id,meeting_id,event_type,status,amount,effective_date,reference,idempotency_key,metadata,created_by)
  VALUES(v_org,p_group_id,p_cycle_id,p_member_id,p_meeting_id,p_event_type,'draft',p_amount,coalesce(p_effective_date,current_date),trim(p_reference),p_idempotency_key,coalesce(p_metadata,'{}'::jsonb),auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Routine collections are posted immediately. High-risk actions must first go
-- through a draft and an independent approval request.
CREATE OR REPLACE FUNCTION public.vsla_v12_post_financial_event(
  p_event_type text, p_amount numeric, p_idempotency_key uuid, p_reference text,
  p_group_id uuid DEFAULT NULL, p_cycle_id uuid DEFAULT NULL, p_member_id uuid DEFAULT NULL,
  p_meeting_id uuid DEFAULT NULL, p_effective_date date DEFAULT current_date,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_id uuid;
BEGIN
  IF p_event_type IN ('loan_disbursed','expense_paid','cash_adjustment','shareout_accrual','shareout_payment','reversal') THEN
    RAISE EXCEPTION 'This action requires a draft and independent approval';
  END IF;
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
  IF v_org IS NULL THEN RAISE EXCEPTION 'Staff authorization required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vsla_workflow_settings WHERE organization_id=v_org AND workflow_version='v1_2') THEN
    RAISE EXCEPTION 'VSLA v1.2 is not enabled for this organization';
  END IF;
  IF p_amount<=0 OR nullif(trim(coalesce(p_reference,'')),'') IS NULL THEN RAISE EXCEPTION 'A positive amount and reference are required'; END IF;
  SELECT id INTO v_id FROM public.vsla_financial_events WHERE organization_id=v_org AND idempotency_key=p_idempotency_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.vsla_financial_events(organization_id,group_id,cycle_id,member_id,meeting_id,event_type,amount,effective_date,reference,idempotency_key,metadata,created_by,posted_at)
  VALUES(v_org,p_group_id,p_cycle_id,p_member_id,p_meeting_id,p_event_type,p_amount,coalesce(p_effective_date,current_date),trim(p_reference),p_idempotency_key,coalesce(p_metadata,'{}'::jsonb),auth.uid(),now())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_submit_financial_draft(p_event_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.vsla_financial_events%ROWTYPE; p public.vsla_approval_policies%ROWTYPE; v_request uuid;
BEGIN
  SELECT * INTO e FROM public.vsla_financial_events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR e.organization_id<>public.auth_staff_org_id() THEN RAISE EXCEPTION 'Financial draft not found'; END IF;
  IF e.status<>'draft' THEN RAISE EXCEPTION 'Only a draft can be submitted'; END IF;
  SELECT * INTO p FROM public.vsla_approval_policies
  WHERE organization_id=e.organization_id AND transaction_type=e.event_type AND active AND e.amount>=minimum_amount
  ORDER BY minimum_amount DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active approval policy is configured for this restricted action'; END IF;
  IF NOT public.vsla_v12_actor_has_role(e.organization_id,e.group_id,p.maker_roles) THEN RAISE EXCEPTION 'Your VSLA role cannot submit this action'; END IF;
  INSERT INTO public.vsla_financial_approval_requests(organization_id,policy_id,event_id,group_id,submitted_by)
  VALUES(e.organization_id,p.id,e.id,e.group_id,auth.uid()) RETURNING id INTO v_request;
  UPDATE public.vsla_financial_events SET status='pending_approval',approval_request_id=v_request WHERE id=e.id;
  RETURN v_request;
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_decide_financial_approval(
  p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.vsla_financial_approval_requests%ROWTYPE; e public.vsla_financial_events%ROWTYPE; p public.vsla_approval_policies%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.vsla_financial_approval_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR r.organization_id<>public.auth_staff_org_id() OR r.status<>'pending' THEN RAISE EXCEPTION 'Approval request is not pending'; END IF;
  SELECT * INTO e FROM public.vsla_financial_events WHERE id=r.event_id FOR UPDATE;
  SELECT * INTO p FROM public.vsla_approval_policies WHERE id=r.policy_id;
  IF NOT FOUND OR NOT public.vsla_v12_actor_has_role(r.organization_id,r.group_id,p.checker_roles) THEN RAISE EXCEPTION 'Your VSLA role cannot approve this action'; END IF;
  IF p.require_distinct_users AND r.submitted_by=auth.uid() THEN RAISE EXCEPTION 'Maker and checker must be different users'; END IF;
  UPDATE public.vsla_financial_approval_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    decided_by=auth.uid(),decided_at=now(),decision_note=nullif(trim(coalesce(p_note,'')), '') WHERE id=r.id;
  UPDATE public.vsla_financial_events SET status=CASE WHEN p_approve THEN 'posted' ELSE 'rejected' END,
    posted_at=CASE WHEN p_approve THEN now() ELSE NULL END WHERE id=e.id;
  RETURN e.id;
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_reverse_financial_event(
  p_event_id uuid, p_idempotency_key uuid, p_reference text, p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.vsla_financial_events%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO e FROM public.vsla_financial_events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR e.organization_id<>public.auth_staff_org_id() OR e.status<>'posted' THEN RAISE EXCEPTION 'Only posted events can be reversed'; END IF;
  IF nullif(trim(coalesce(p_reason,'')), '') IS NULL THEN RAISE EXCEPTION 'A reversal reason is required'; END IF;
  SELECT id INTO v_id FROM public.vsla_financial_events WHERE organization_id=e.organization_id AND idempotency_key=p_idempotency_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.vsla_financial_events(organization_id,group_id,cycle_id,member_id,meeting_id,event_type,status,amount,effective_date,reference,idempotency_key,reversal_of_id,metadata,created_by,posted_at)
  VALUES(e.organization_id,e.group_id,e.cycle_id,e.member_id,e.meeting_id,'reversal','posted',e.amount,current_date,trim(p_reference),p_idempotency_key,e.id,jsonb_build_object('reason',trim(p_reason)),auth.uid(),now()) RETURNING id INTO v_id;
  UPDATE public.vsla_financial_events SET status='reversed' WHERE id=e.id;
  RETURN v_id;
END $$;

-- A reversal changes only the status of the original event; it never changes
-- the amount, parties, date, reference, or original evidence.
CREATE OR REPLACE FUNCTION public.vsla_v12_protect_posted_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'VSLA v1.2 financial events are immutable; post a reversal instead'; END IF;
  IF OLD.status IN ('posted','reversed') AND NOT (
    OLD.status='posted' AND NEW.status='reversed' AND
    (to_jsonb(OLD)-'status')=(to_jsonb(NEW)-'status')
  ) THEN RAISE EXCEPTION 'Posted VSLA v1.2 financial events are immutable; post a reversal instead'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_vsla_v12_approval_audit ON public.vsla_financial_approval_requests;
CREATE TRIGGER trg_vsla_v12_approval_audit AFTER INSERT OR UPDATE ON public.vsla_financial_approval_requests
FOR EACH ROW EXECUTE FUNCTION public.vsla_v12_capture_audit_event();

REVOKE ALL ON FUNCTION public.vsla_v12_create_financial_draft(text,numeric,uuid,text,uuid,uuid,uuid,uuid,date,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vsla_v12_submit_financial_draft(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vsla_v12_decide_financial_approval(uuid,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vsla_v12_reverse_financial_event(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_create_financial_draft(text,numeric,uuid,text,uuid,uuid,uuid,uuid,date,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vsla_v12_submit_financial_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vsla_v12_decide_financial_approval(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vsla_v12_reverse_financial_event(uuid,uuid,text,text) TO authenticated;
