-- BOAT Control Centre, phase 2: controlled configuration, manual checks, investigations and referral workflow.

CREATE TABLE public.control_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pack_code text NOT NULL DEFAULT 'custom', rule_code text NOT NULL, name text NOT NULL, module_key text NOT NULL, control_area text NOT NULL,
  branch_id uuid, branch_type text, configuration jsonb NOT NULL DEFAULT '{}'::jsonb, severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('critical','high','warning','low')),
  create_exception boolean NOT NULL DEFAULT true, escalation_hours integer CHECK (escalation_hours IS NULL OR escalation_hours > 0), active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, pack_code, rule_code)
);

CREATE TABLE public.control_check_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL, control_area text NOT NULL, module_key text NOT NULL DEFAULT 'operations', instructions text, active boolean NOT NULL DEFAULT true,
  create_exception_on_failure boolean NOT NULL DEFAULT true, created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);
CREATE TABLE public.control_check_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_id uuid NOT NULL REFERENCES public.control_check_templates(id) ON DELETE CASCADE,
  sequence_no integer NOT NULL, prompt text NOT NULL, required boolean NOT NULL DEFAULT true, UNIQUE(template_id, sequence_no)
);
CREATE TABLE public.control_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.control_check_templates(id) ON DELETE SET NULL, branch_id uuid, branch_type text,
  performed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, reviewed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  performed_at timestamptz NOT NULL DEFAULT now(), expected_amount numeric(14,2), verified_amount numeric(14,2), variance numeric(14,2),
  result text NOT NULL CHECK (result IN ('passed','failed','needs_review')), comments text, linked_exception_id uuid REFERENCES public.control_exceptions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.control_check_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), check_id uuid NOT NULL REFERENCES public.control_checks(id) ON DELETE CASCADE,
  template_item_id uuid REFERENCES public.control_check_template_items(id) ON DELETE SET NULL, result text NOT NULL CHECK (result IN ('passed','failed','not_applicable')), comments text
);

CREATE TABLE public.control_investigations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), investigation_reference text NOT NULL UNIQUE DEFAULT ('CCI-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, title text NOT NULL, scope text, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','awaiting_management_response','closed')),
  responsible_investigator uuid REFERENCES public.staff(id) ON DELETE SET NULL, quantified_loss numeric(14,2) NOT NULL DEFAULT 0, findings text, recommendations text, management_response text, conclusion text,
  closed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, closed_at timestamptz, created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.control_investigation_exceptions (investigation_id uuid NOT NULL REFERENCES public.control_investigations(id) ON DELETE CASCADE, exception_id uuid NOT NULL REFERENCES public.control_exceptions(id) ON DELETE RESTRICT, PRIMARY KEY(investigation_id, exception_id));
CREATE TABLE public.control_investigation_notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), investigation_id uuid NOT NULL REFERENCES public.control_investigations(id) ON DELETE CASCADE, organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, note_type text NOT NULL DEFAULT 'note', body text NOT NULL, created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.control_notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, exception_id uuid REFERENCES public.control_exceptions(id) ON DELETE CASCADE, recipient_id uuid REFERENCES public.staff(id) ON DELETE SET NULL, notification_type text NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','failed','cancelled')), payload jsonb NOT NULL DEFAULT '{}'::jsonb, scheduled_for timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX control_rules_active_idx ON public.control_rules(organization_id, active, module_key);
CREATE INDEX control_checks_org_performed_idx ON public.control_checks(organization_id, performed_at DESC);
CREATE INDEX control_investigations_org_status_idx ON public.control_investigations(organization_id, status, created_at DESC);
CREATE INDEX control_notifications_queue_idx ON public.control_notifications(status, scheduled_for) WHERE status = 'queued';

CREATE OR REPLACE FUNCTION public.create_control_exception(p_organization_id uuid, p_module_key text, p_control_area text, p_title text, p_description text DEFAULT NULL, p_severity text DEFAULT 'warning', p_amount_at_risk numeric DEFAULT 0, p_source_module text DEFAULT NULL, p_source_table text DEFAULT NULL, p_source_id text DEFAULT NULL, p_source_reference text DEFAULT NULL)
RETURNS public.control_exceptions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_exception public.control_exceptions;
BEGIN
  IF NOT public.control_centre_can(p_organization_id, 'manage_exception') THEN RAISE EXCEPTION 'Not authorized to create a control exception'; END IF;
  IF p_severity NOT IN ('critical','high','warning','low') THEN RAISE EXCEPTION 'Invalid severity'; END IF;
  INSERT INTO public.control_exceptions(organization_id,module_key,control_area,title,description,severity,amount_at_risk,source_kind,created_by)
  VALUES(p_organization_id,p_module_key,p_control_area,p_title,p_description,p_severity,GREATEST(COALESCE(p_amount_at_risk,0),0),'manual',auth.uid()) RETURNING * INTO v_exception;
  IF p_source_table IS NOT NULL AND p_source_id IS NOT NULL THEN INSERT INTO public.control_exception_sources(exception_id,organization_id,source_module,source_table,source_id,source_reference) VALUES(v_exception.id,p_organization_id,COALESCE(p_source_module,p_module_key),p_source_table,p_source_id,p_source_reference); END IF;
  PERFORM public.append_control_audit_event(p_organization_id,v_exception.id,NULL,'exception_created',NULL,to_jsonb(v_exception)); RETURN v_exception;
END; $$;

CREATE OR REPLACE FUNCTION public.record_control_check(p_organization_id uuid, p_template_id uuid, p_result text, p_comments text DEFAULT NULL, p_expected_amount numeric DEFAULT NULL, p_verified_amount numeric DEFAULT NULL)
RETURNS public.control_checks LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_template public.control_check_templates; v_check public.control_checks; v_exception uuid;
BEGIN
  IF NOT public.control_centre_can(p_organization_id, 'manage_exception') THEN RAISE EXCEPTION 'Not authorized to record a control check'; END IF;
  SELECT * INTO v_template FROM public.control_check_templates WHERE id=p_template_id AND organization_id=p_organization_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Control check template is unavailable'; END IF;
  IF p_result NOT IN ('passed','failed','needs_review') THEN RAISE EXCEPTION 'Invalid control check result'; END IF;
  IF p_result='failed' AND v_template.create_exception_on_failure THEN SELECT id INTO v_exception FROM public.create_control_exception(p_organization_id,v_template.module_key,v_template.control_area,'Failed control check: ' || v_template.name,p_comments,'high',GREATEST(COALESCE(p_expected_amount,0)-COALESCE(p_verified_amount,0),0)); END IF;
  INSERT INTO public.control_checks(organization_id,template_id,performed_by,result,comments,expected_amount,verified_amount,variance,linked_exception_id) VALUES(p_organization_id,p_template_id,auth.uid(),p_result,p_comments,p_expected_amount,p_verified_amount,CASE WHEN p_expected_amount IS NULL OR p_verified_amount IS NULL THEN NULL ELSE p_verified_amount-p_expected_amount END,v_exception) RETURNING * INTO v_check;
  PERFORM public.append_control_audit_event(p_organization_id,v_exception,NULL,'control_check_recorded',NULL,to_jsonb(v_check)); RETURN v_check;
END; $$;

CREATE OR REPLACE FUNCTION public.upsert_control_rule(p_organization_id uuid, p_pack_code text, p_rule_code text, p_name text, p_module_key text, p_control_area text, p_configuration jsonb DEFAULT '{}'::jsonb, p_severity text DEFAULT 'warning', p_active boolean DEFAULT true)
RETURNS public.control_rules LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_rule public.control_rules;
BEGIN
  IF NOT public.control_centre_can(p_organization_id, 'manage_rule') THEN RAISE EXCEPTION 'Not authorized to configure control rules'; END IF;
  IF p_severity NOT IN ('critical','high','warning','low') THEN RAISE EXCEPTION 'Invalid severity'; END IF;
  INSERT INTO public.control_rules(organization_id,pack_code,rule_code,name,module_key,control_area,configuration,severity,active,created_by)
  VALUES(p_organization_id,p_pack_code,p_rule_code,p_name,p_module_key,p_control_area,COALESCE(p_configuration,'{}'::jsonb),p_severity,p_active,auth.uid())
  ON CONFLICT(organization_id,pack_code,rule_code) DO UPDATE SET name=EXCLUDED.name,module_key=EXCLUDED.module_key,control_area=EXCLUDED.control_area,configuration=EXCLUDED.configuration,severity=EXCLUDED.severity,active=EXCLUDED.active,updated_at=now()
  RETURNING * INTO v_rule;
  PERFORM public.append_control_audit_event(p_organization_id,NULL,NULL,'control_rule_saved',NULL,to_jsonb(v_rule)); RETURN v_rule;
END; $$;

CREATE OR REPLACE FUNCTION public.create_control_investigation(p_organization_id uuid, p_title text, p_scope text DEFAULT NULL, p_exception_ids uuid[] DEFAULT '{}'::uuid[])
RETURNS public.control_investigations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_case public.control_investigations; v_exception uuid;
BEGIN
  IF NOT public.control_centre_can(p_organization_id, 'manage_exception') THEN RAISE EXCEPTION 'Not authorized to manage investigations'; END IF;
  INSERT INTO public.control_investigations(organization_id,title,scope,responsible_investigator,created_by) VALUES(p_organization_id,p_title,p_scope,auth.uid(),auth.uid()) RETURNING * INTO v_case;
  FOREACH v_exception IN ARRAY COALESCE(p_exception_ids,'{}'::uuid[]) LOOP
    INSERT INTO public.control_investigation_exceptions(investigation_id,exception_id)
    SELECT v_case.id,e.id FROM public.control_exceptions e WHERE e.id=v_exception AND e.organization_id=p_organization_id;
  END LOOP;
  PERFORM public.append_control_audit_event(p_organization_id,NULL,NULL,'investigation_created',NULL,to_jsonb(v_case)); RETURN v_case;
END; $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['control_rules','control_check_templates','control_check_template_items','control_checks','control_check_results','control_investigations','control_investigation_exceptions','control_investigation_notes','control_notifications'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  END LOOP;
END $$;
CREATE POLICY control_rules_read ON public.control_rules FOR SELECT TO authenticated USING(public.control_centre_can(organization_id,'view'));
CREATE POLICY control_templates_read ON public.control_check_templates FOR SELECT TO authenticated USING(public.control_centre_can(organization_id,'view'));
CREATE POLICY control_template_items_read ON public.control_check_template_items FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.control_check_templates t WHERE t.id=template_id AND public.control_centre_can(t.organization_id,'view')));
CREATE POLICY control_checks_read ON public.control_checks FOR SELECT TO authenticated USING(public.control_centre_can(organization_id,'view'));
CREATE POLICY control_check_results_read ON public.control_check_results FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.control_checks c WHERE c.id=check_id AND public.control_centre_can(c.organization_id,'view')));
CREATE POLICY control_investigations_read ON public.control_investigations FOR SELECT TO authenticated USING(public.control_centre_can(organization_id,'view'));
CREATE POLICY control_investigation_links_read ON public.control_investigation_exceptions FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.control_investigations i WHERE i.id=investigation_id AND public.control_centre_can(i.organization_id,'view')));
CREATE POLICY control_investigation_notes_read ON public.control_investigation_notes FOR SELECT TO authenticated USING(public.control_centre_can(organization_id,'view'));
REVOKE INSERT,UPDATE,DELETE ON public.control_rules,public.control_check_templates,public.control_check_template_items,public.control_checks,public.control_check_results,public.control_investigations,public.control_investigation_exceptions,public.control_investigation_notes,public.control_notifications FROM anon,authenticated;
GRANT SELECT ON public.control_rules,public.control_check_templates,public.control_check_template_items,public.control_checks,public.control_check_results,public.control_investigations,public.control_investigation_exceptions,public.control_investigation_notes TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_control_exception(uuid,text,text,text,text,text,numeric,text,text,text,text), public.record_control_check(uuid,uuid,text,text,numeric,numeric), public.upsert_control_rule(uuid,text,text,text,text,text,jsonb,text,boolean), public.create_control_investigation(uuid,text,text,uuid[]) TO authenticated;
