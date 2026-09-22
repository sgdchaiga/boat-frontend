-- BOAT Control Centre, phase 1: platform-neutral exception, action and audit foundation.

CREATE TABLE IF NOT EXISTS public.subscription_features (
  code text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]+$'),
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscription_plan_features (
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  feature_code text NOT NULL REFERENCES public.subscription_features(code) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (plan_id, feature_code)
);

CREATE TABLE IF NOT EXISTS public.organization_feature_overrides (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature_code text NOT NULL REFERENCES public.subscription_features(code) ON DELETE CASCADE,
  enabled boolean NOT NULL,
  expires_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, feature_code)
);

INSERT INTO public.subscription_features(code, name, description)
VALUES ('control_centre', 'BOAT Control Centre', 'Centralized control exceptions, actions and audit trail.')
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.has_organization_feature(p_organization_id uuid, p_feature_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT o.enabled
     FROM public.organization_feature_overrides o
     WHERE o.organization_id = p_organization_id
       AND o.feature_code = p_feature_code
       AND (o.expires_at IS NULL OR o.expires_at > now())),
    EXISTS (
      SELECT 1
      FROM public.organization_subscriptions s
      JOIN public.subscription_plan_features pf ON pf.plan_id = s.plan_id
      WHERE s.organization_id = p_organization_id
        AND s.status IN ('trial', 'active')
        AND pf.feature_code = p_feature_code AND pf.enabled
        AND (s.period_end IS NULL OR s.period_end >= CURRENT_DATE)
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.control_centre_can(p_organization_id uuid, p_permission text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  IF public.is_platform_admin() THEN RETURN true; END IF;
  SELECT om.role INTO v_role
  FROM public.organization_members om
  WHERE om.user_id = auth.uid() AND om.organization_id = p_organization_id AND om.is_active = true
  LIMIT 1;
  IF v_role IS NULL THEN
    SELECT s.role INTO v_role FROM public.staff s
    WHERE s.id = auth.uid() AND s.organization_id = p_organization_id AND COALESCE(s.is_active, true)
    LIMIT 1;
  END IF;
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role IN ('super_admin', 'admin', 'manager') THEN RETURN true; END IF;
  IF v_role = 'internal_controller' THEN RETURN p_permission IN ('view', 'manage_exception', 'manage_action'); END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.organization_permissions op
    WHERE op.organization_id = p_organization_id AND op.role_key = v_role
      AND op.permission_key = 'control_' || p_permission AND op.allowed
  );
END;
$$;

INSERT INTO public.organization_role_types(organization_id, role_key, display_name, sort_order)
SELECT id, 'internal_controller', 'Internal Controller / Auditor', 20 FROM public.organizations
ON CONFLICT (organization_id, role_key) DO NOTHING;

INSERT INTO public.organization_permissions(organization_id, role_key, permission_key, allowed)
SELECT o.id, r.role_key, p.permission_key, true
FROM public.organizations o
CROSS JOIN (VALUES ('internal_controller'), ('super_admin'), ('admin'), ('manager')) r(role_key)
CROSS JOIN (VALUES ('control_view'), ('control_manage_exception'), ('control_manage_action'), ('control_manage_rule')) p(permission_key)
ON CONFLICT (organization_id, role_key, permission_key) DO UPDATE SET allowed = EXCLUDED.allowed;

CREATE TABLE IF NOT EXISTS public.control_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_reference text NOT NULL UNIQUE DEFAULT ('CCE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid,
  branch_type text,
  module_key text NOT NULL,
  control_area text NOT NULL,
  control_rule_code text,
  source_kind text NOT NULL DEFAULT 'manual',
  source_fingerprint text,
  title text NOT NULL,
  description text,
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'warning', 'low')),
  amount_at_risk numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_at_risk >= 0),
  detected_at timestamptz NOT NULL DEFAULT now(),
  assigned_to uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  due_date timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','investigating','awaiting_management_response','controller_review','resolved')),
  management_response text,
  controller_comments text,
  resolution text,
  resolved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS control_exceptions_open_fingerprint_uq
  ON public.control_exceptions(organization_id, source_fingerprint)
  WHERE source_fingerprint IS NOT NULL AND status <> 'resolved';
CREATE INDEX IF NOT EXISTS control_exceptions_queue_idx
  ON public.control_exceptions(organization_id, status, severity, due_date, detected_at DESC);

CREATE TABLE IF NOT EXISTS public.control_exception_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id uuid NOT NULL REFERENCES public.control_exceptions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_module text NOT NULL,
  source_table text NOT NULL,
  source_id text NOT NULL,
  source_reference text,
  source_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(exception_id, source_table, source_id)
);

CREATE TABLE IF NOT EXISTS public.control_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id uuid NOT NULL REFERENCES public.control_exceptions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  assigned_to uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  due_date timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','cancelled')),
  completed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS control_actions_queue_idx ON public.control_actions(organization_id, status, due_date);

CREATE TABLE IF NOT EXISTS public.control_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  exception_id uuid REFERENCES public.control_exceptions(id) ON DELETE SET NULL,
  action_id uuid REFERENCES public.control_actions(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS control_audit_events_exception_idx ON public.control_audit_events(exception_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.append_control_audit_event(p_org uuid, p_exception uuid, p_action uuid, p_type text, p_before jsonb, p_after jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.control_audit_events(organization_id, exception_id, action_id, actor_id, event_type, previous_value, new_value)
  VALUES (p_org, p_exception, p_action, auth.uid(), p_type, p_before, p_after);
$$;

CREATE OR REPLACE FUNCTION public.control_exception_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.version = OLD.version + 1; NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_control_exception_touch ON public.control_exceptions;
CREATE TRIGGER trg_control_exception_touch BEFORE UPDATE ON public.control_exceptions FOR EACH ROW EXECUTE FUNCTION public.control_exception_touch();

CREATE OR REPLACE FUNCTION public.transition_control_exception(p_exception_id uuid, p_expected_version integer, p_status text, p_note text DEFAULT NULL)
RETURNS public.control_exceptions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before public.control_exceptions; v_after public.control_exceptions;
BEGIN
  SELECT * INTO v_before FROM public.control_exceptions WHERE id = p_exception_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Control exception not found'; END IF;
  IF NOT public.control_centre_can(v_before.organization_id, 'manage_exception') THEN RAISE EXCEPTION 'Not authorized to update this control exception'; END IF;
  IF v_before.version <> p_expected_version THEN RAISE EXCEPTION 'This exception changed in another session. Refresh and try again.' USING ERRCODE = '40001'; END IF;
  IF p_status NOT IN ('open','assigned','investigating','awaiting_management_response','controller_review','resolved') THEN RAISE EXCEPTION 'Invalid control exception status'; END IF;
  UPDATE public.control_exceptions SET status = p_status,
    controller_comments = CASE WHEN p_note IS NULL THEN controller_comments ELSE p_note END,
    resolved_by = CASE WHEN p_status = 'resolved' THEN auth.uid() ELSE NULL END,
    resolved_at = CASE WHEN p_status = 'resolved' THEN now() ELSE NULL END,
    resolution = CASE WHEN p_status = 'resolved' AND p_note IS NOT NULL THEN p_note ELSE resolution END
  WHERE id = p_exception_id RETURNING * INTO v_after;
  PERFORM public.append_control_audit_event(v_after.organization_id, v_after.id, NULL, 'exception_status_changed', to_jsonb(v_before), to_jsonb(v_after));
  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_control_exception(p_exception_id uuid, p_expected_version integer, p_assigned_to uuid, p_due_date timestamptz DEFAULT NULL)
RETURNS public.control_exceptions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before public.control_exceptions; v_after public.control_exceptions;
BEGIN
  SELECT * INTO v_before FROM public.control_exceptions WHERE id = p_exception_id FOR UPDATE;
  IF NOT FOUND OR NOT public.control_centre_can(v_before.organization_id, 'manage_exception') THEN RAISE EXCEPTION 'Not authorized to assign this control exception'; END IF;
  IF v_before.version <> p_expected_version THEN RAISE EXCEPTION 'This exception changed in another session. Refresh and try again.' USING ERRCODE = '40001'; END IF;
  UPDATE public.control_exceptions SET assigned_to=p_assigned_to, due_date=p_due_date, status=CASE WHEN status='open' THEN 'assigned' ELSE status END WHERE id=p_exception_id RETURNING * INTO v_after;
  PERFORM public.append_control_audit_event(v_after.organization_id, v_after.id, NULL, 'exception_assigned', to_jsonb(v_before), to_jsonb(v_after));
  RETURN v_after;
END;
$$;

ALTER TABLE public.subscription_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plan_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_feature_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_exception_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY control_features_read ON public.subscription_features FOR SELECT TO authenticated USING (true);
CREATE POLICY control_plan_features_read ON public.subscription_plan_features FOR SELECT TO authenticated USING (true);
CREATE POLICY control_feature_overrides_manage ON public.organization_feature_overrides FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY control_exceptions_read ON public.control_exceptions FOR SELECT TO authenticated USING (public.control_centre_can(organization_id, 'view'));
CREATE POLICY control_sources_access ON public.control_exception_sources FOR SELECT TO authenticated USING (public.control_centre_can(organization_id, 'view'));
CREATE POLICY control_actions_read ON public.control_actions FOR SELECT TO authenticated USING (public.control_centre_can(organization_id, 'view'));
CREATE POLICY control_audit_read ON public.control_audit_events FOR SELECT TO authenticated USING (public.control_centre_can(organization_id, 'view'));

REVOKE INSERT, UPDATE, DELETE ON public.control_audit_events FROM anon, authenticated;
GRANT SELECT ON public.subscription_features, public.subscription_plan_features, public.control_exceptions, public.control_exception_sources, public.control_actions, public.control_audit_events TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_organization_feature(uuid, text), public.control_centre_can(uuid, text), public.transition_control_exception(uuid, integer, text, text), public.assign_control_exception(uuid, integer, uuid, timestamptz) TO authenticated;
