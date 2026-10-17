-- Phase 3: interactive walkthroughs, isolated practice scenarios, and AI-ready session records.
-- These tables deliberately do not reference operational/financial transaction tables.

CREATE TABLE IF NOT EXISTS public.academy_walkthroughs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  walkthrough_key text NOT NULL,
  page_key text NOT NULL,
  module_key text NOT NULL,
  role_keys text[] NOT NULL DEFAULT '{}',
  title text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  steps jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(steps)='array'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT(organization_id,walkthrough_key,version)
);

CREATE TABLE IF NOT EXISTS public.academy_practice_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_version_id uuid REFERENCES public.academy_course_versions(id) ON DELETE CASCADE,
  scenario_key text NOT NULL,
  title text NOT NULL,
  instructions text NOT NULL,
  prompt_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  pass_mark numeric(5,2) NOT NULL DEFAULT 70 CHECK(pass_mark BETWEEN 0 AND 100),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT(organization_id,scenario_key)
);

CREATE TABLE IF NOT EXISTS public.academy_practice_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES public.academy_practice_scenarios(id) ON DELETE CASCADE,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  score numeric(5,2),
  status text NOT NULL DEFAULT 'started' CHECK(status IN ('started','passed','failed')),
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.academy_certification_paths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  path_key text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  required_course_version_ids uuid[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT(organization_id,path_key)
);

CREATE TABLE IF NOT EXISTS public.academy_assistant_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_key text,
  provider text NOT NULL DEFAULT 'unconfigured',
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.academy_assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.academy_assistant_sessions(id) ON DELETE CASCADE,
  actor text NOT NULL CHECK(actor IN ('user','assistant','system')),
  content text NOT NULL,
  safety_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.academy_walkthroughs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_practice_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_practice_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_certification_paths ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_assistant_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_assistant_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY academy_walkthroughs_read ON public.academy_walkthroughs FOR SELECT TO authenticated USING (is_active AND public.academy_content_visible(organization_id));
CREATE POLICY academy_walkthroughs_manage ON public.academy_walkthroughs FOR ALL TO authenticated USING (public.academy_content_manageable(organization_id)) WITH CHECK(public.academy_content_manageable(organization_id));
CREATE POLICY academy_scenarios_read ON public.academy_practice_scenarios FOR SELECT TO authenticated USING (is_active AND public.academy_content_visible(organization_id));
CREATE POLICY academy_scenarios_manage ON public.academy_practice_scenarios FOR ALL TO authenticated USING (public.academy_content_manageable(organization_id)) WITH CHECK(public.academy_content_manageable(organization_id));
CREATE POLICY academy_practice_attempts_own ON public.academy_practice_attempts FOR ALL TO authenticated USING (public.user_is_member_of_org(organization_id) AND user_id=auth.uid()) WITH CHECK(public.user_is_member_of_org(organization_id) AND user_id=auth.uid());
CREATE POLICY academy_paths_read ON public.academy_certification_paths FOR SELECT TO authenticated USING (is_active AND public.academy_content_visible(organization_id));
CREATE POLICY academy_paths_manage ON public.academy_certification_paths FOR ALL TO authenticated USING (public.academy_content_manageable(organization_id)) WITH CHECK(public.academy_content_manageable(organization_id));
CREATE POLICY academy_assistant_sessions_own ON public.academy_assistant_sessions FOR ALL TO authenticated USING (public.user_is_member_of_org(organization_id) AND user_id=auth.uid()) WITH CHECK(public.user_is_member_of_org(organization_id) AND user_id=auth.uid());
CREATE POLICY academy_assistant_messages_own ON public.academy_assistant_messages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.academy_assistant_sessions s WHERE s.id=session_id AND s.user_id=auth.uid() AND public.user_is_member_of_org(s.organization_id)));

CREATE OR REPLACE FUNCTION public.submit_academy_practice_scenario(p_organization_id uuid,p_scenario_id uuid,p_response jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_expected jsonb; v_pass numeric; v_score numeric; v_attempt uuid;
BEGIN
  IF NOT public.user_is_member_of_org(p_organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT expected_response,pass_mark INTO v_expected,v_pass FROM public.academy_practice_scenarios WHERE id=p_scenario_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Practice scenario is not available'; END IF;
  -- Exact JSON match is intentional for v1 scenarios. No operational records are created.
  v_score := CASE WHEN p_response=v_expected THEN 100 ELSE 0 END;
  INSERT INTO public.academy_practice_attempts(organization_id,user_id,scenario_id,response,score,status,submitted_at)
  VALUES(p_organization_id,auth.uid(),p_scenario_id,p_response,v_score,CASE WHEN v_score>=v_pass THEN 'passed' ELSE 'failed' END,now()) RETURNING id INTO v_attempt;
  RETURN jsonb_build_object('attempt_id',v_attempt,'score',v_score,'passed',v_score>=v_pass);
END $$;

CREATE OR REPLACE FUNCTION public.issue_academy_path_certificate(p_organization_id uuid,p_path_id uuid)
RETURNS public.academy_certification_paths LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_path public.academy_certification_paths;
BEGIN
  IF NOT public.user_is_member_of_org(p_organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT * INTO v_path FROM public.academy_certification_paths WHERE id=p_path_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Certification path unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_path.required_course_version_ids) course_id WHERE NOT EXISTS (SELECT 1 FROM public.academy_certificates c WHERE c.organization_id=p_organization_id AND c.user_id=auth.uid() AND c.course_version_id=course_id)) THEN RAISE EXCEPTION 'Complete every required course before certification'; END IF;
  RETURN v_path;
END $$;

GRANT SELECT ON public.academy_walkthroughs,public.academy_practice_scenarios,public.academy_certification_paths TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.academy_practice_attempts,public.academy_assistant_sessions TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_academy_practice_scenario(uuid,uuid,jsonb),public.issue_academy_path_certificate(uuid,uuid) TO authenticated;

INSERT INTO public.academy_walkthroughs(organization_id,walkthrough_key,page_key,module_key,title,steps)
VALUES(NULL,'safe-exception-handling','learning_centre','general','Handling an exception safely','[{"id":"identify","title":"Identify the exception","body":"Pause when BOAT shows a mismatch, missing evidence or a control warning."},{"id":"review","title":"Review the evidence","body":"Check the source details and page guidance before taking any action."},{"id":"escalate","title":"Use the approved route","body":"Escalate through your organization process rather than forcing a live transaction."}]'::jsonb)
ON CONFLICT(organization_id,walkthrough_key,version) DO UPDATE SET title=EXCLUDED.title,steps=EXCLUDED.steps,is_active=true;

INSERT INTO public.academy_practice_scenarios(organization_id,course_version_id,scenario_key,title,instructions,prompt_data,expected_response)
SELECT NULL,cv.id,c.course_key||'-exception-practice','Handle an operational exception','Choose the safest response to an exception. This is an isolated Academy exercise; it cannot post or modify BOAT operational data.','{"situation":"A workflow shows a mismatch that you cannot explain from the current record.","choices":["Post and correct it later","Review source evidence and escalate through the approved process","Delete the record"]}'::jsonb,'{"decision":"review_and_escalate"}'::jsonb
FROM public.academy_courses c JOIN public.academy_course_versions cv ON cv.course_id=c.id AND cv.version=1
WHERE c.organization_id IS NULL AND c.course_key IN ('hotel-front-desk-basics','sacco-member-and-teller-basics','school-fees-and-collections','retail-pos-basics','manufacturing-production-basics','accounting-period-controls')
ON CONFLICT(organization_id,scenario_key) DO UPDATE SET title=EXCLUDED.title,instructions=EXCLUDED.instructions,prompt_data=EXCLUDED.prompt_data,expected_response=EXCLUDED.expected_response,is_active=true;
