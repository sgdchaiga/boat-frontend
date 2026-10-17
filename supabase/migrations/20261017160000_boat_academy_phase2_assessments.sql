-- Phase 2: server-scored assessments, certificates, and a delivery-ready reminder outbox.

CREATE TABLE IF NOT EXISTS public.academy_assessment_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.academy_assessments(id) ON DELETE CASCADE,
  question_order integer NOT NULL CHECK (question_order > 0),
  prompt text NOT NULL,
  options jsonb NOT NULL CHECK (jsonb_typeof(options)='array'),
  correct_option_key text NOT NULL,
  explanation text,
  points integer NOT NULL DEFAULT 1 CHECK (points > 0),
  UNIQUE(assessment_id,question_order)
);

CREATE TABLE IF NOT EXISTS public.academy_assessment_answers (
  attempt_id uuid NOT NULL REFERENCES public.academy_assessment_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.academy_assessment_questions(id) ON DELETE CASCADE,
  selected_option_key text,
  is_correct boolean NOT NULL,
  PRIMARY KEY(attempt_id,question_id)
);

CREATE TABLE IF NOT EXISTS public.academy_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_version_id uuid NOT NULL REFERENCES public.academy_course_versions(id) ON DELETE RESTRICT,
  certificate_number text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,user_id,course_version_id)
);

CREATE TABLE IF NOT EXISTS public.academy_reminder_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.academy_user_assignments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reminder_kind text NOT NULL CHECK(reminder_kind IN ('due_7_days','due_3_days','due_tomorrow','overdue')),
  due_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE(assignment_id,reminder_kind)
);

CREATE INDEX IF NOT EXISTS academy_questions_assessment_idx ON public.academy_assessment_questions(assessment_id,question_order);
CREATE INDEX IF NOT EXISTS academy_reminders_pending_idx ON public.academy_reminder_outbox(organization_id,delivered_at,created_at);

ALTER TABLE public.academy_assessment_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_assessment_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_reminder_outbox ENABLE ROW LEVEL SECURITY;

-- Questions are exposed only through the safe RPC below: never expose answer keys to a learner.
CREATE POLICY academy_questions_manage ON public.academy_assessment_questions FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.academy_assessments a JOIN public.academy_course_versions cv ON cv.id=a.course_version_id JOIN public.academy_courses c ON c.id=cv.course_id WHERE a.id=assessment_id AND public.academy_content_manageable(c.organization_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.academy_assessments a JOIN public.academy_course_versions cv ON cv.id=a.course_version_id JOIN public.academy_courses c ON c.id=cv.course_id WHERE a.id=assessment_id AND public.academy_content_manageable(c.organization_id)));
CREATE POLICY academy_answers_manager_read ON public.academy_assessment_answers FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.academy_assessment_attempts at WHERE at.id=attempt_id AND public.user_is_member_of_org(at.organization_id) AND public.academy_user_can_manage()));
CREATE POLICY academy_certificates_read ON public.academy_certificates FOR SELECT TO authenticated USING (user_id=auth.uid() OR (public.user_is_member_of_org(organization_id) AND public.academy_user_can_manage()));
CREATE POLICY academy_reminders_manager_read ON public.academy_reminder_outbox FOR SELECT TO authenticated USING (public.user_is_member_of_org(organization_id) AND public.academy_user_can_manage());

CREATE OR REPLACE FUNCTION public.get_academy_assessment(p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_assessment public.academy_assessments;
BEGIN
  SELECT a.* INTO v_assessment FROM public.academy_assessments a JOIN public.academy_course_versions cv ON cv.id=a.course_version_id JOIN public.academy_courses c ON c.id=cv.course_id
  WHERE a.id=p_assessment_id AND a.is_active AND public.academy_content_visible(c.organization_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Assessment not available'; END IF;
  RETURN jsonb_build_object('id',v_assessment.id,'title',v_assessment.title,'pass_mark',v_assessment.pass_mark,'questions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',q.id,'prompt',q.prompt,'options',q.options,'points',q.points) ORDER BY q.question_order) FROM public.academy_assessment_questions q WHERE q.assessment_id=v_assessment.id),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.submit_academy_assessment(p_organization_id uuid,p_assessment_id uuid,p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_course_version uuid; v_total integer; v_earned integer; v_score numeric; v_pass numeric; v_attempt uuid; v_passed boolean;
BEGIN
  IF NOT public.user_is_member_of_org(p_organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT a.course_version_id,a.pass_mark INTO v_course_version,v_pass FROM public.academy_assessments a WHERE a.id=p_assessment_id AND a.is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assessment not available'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.academy_user_assignments ua WHERE ua.organization_id=p_organization_id AND ua.user_id=auth.uid() AND ua.course_version_id=v_course_version) THEN RAISE EXCEPTION 'Assessment is not assigned to this learner'; END IF;
  SELECT coalesce(sum(points),0) INTO v_total FROM public.academy_assessment_questions WHERE assessment_id=p_assessment_id;
  IF v_total=0 THEN RAISE EXCEPTION 'Assessment has no questions'; END IF;
  INSERT INTO public.academy_assessment_attempts(organization_id,user_id,assessment_id) VALUES(p_organization_id,auth.uid(),p_assessment_id) RETURNING id INTO v_attempt;
  INSERT INTO public.academy_assessment_answers(attempt_id,question_id,selected_option_key,is_correct)
  SELECT v_attempt,q.id,p_answers ->> q.id::text,(p_answers ->> q.id::text)=q.correct_option_key FROM public.academy_assessment_questions q WHERE q.assessment_id=p_assessment_id;
  SELECT coalesce(sum(q.points) FILTER (WHERE ans.is_correct),0) INTO v_earned FROM public.academy_assessment_answers ans JOIN public.academy_assessment_questions q ON q.id=ans.question_id WHERE ans.attempt_id=v_attempt;
  v_score := round((100.0*v_earned/v_total)::numeric,2); v_passed := v_score >= v_pass;
  UPDATE public.academy_assessment_attempts SET score=v_score,status=CASE WHEN v_passed THEN 'passed' ELSE 'failed' END,submitted_at=now() WHERE id=v_attempt;
  IF v_passed THEN
    INSERT INTO public.academy_certificates(organization_id,user_id,course_version_id,certificate_number)
    VALUES(p_organization_id,auth.uid(),v_course_version,'BOAT-ACA-'||to_char(now(),'YYYYMMDD')||'-'||upper(left(replace(auth.uid()::text,'-',''),8)))
    ON CONFLICT(organization_id,user_id,course_version_id) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('attempt_id',v_attempt,'score',v_score,'passed',v_passed,'pass_mark',v_pass);
END $$;

CREATE OR REPLACE FUNCTION public.queue_academy_due_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.academy_reminder_outbox(organization_id,assignment_id,user_id,reminder_kind,due_at)
  SELECT a.organization_id,a.id,a.user_id,CASE WHEN a.due_at < now() THEN 'overdue' WHEN a.due_at::date=current_date+1 THEN 'due_tomorrow' WHEN a.due_at::date=current_date+3 THEN 'due_3_days' ELSE 'due_7_days' END,a.due_at
  FROM public.academy_user_assignments a WHERE a.status <> 'completed' AND a.due_at IS NOT NULL AND a.due_at::date IN (current_date-1,current_date+1,current_date+3,current_date+7)
  ON CONFLICT(assignment_id,reminder_kind) DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.get_academy_assessment(uuid),public.submit_academy_assessment(uuid,uuid,jsonb),public.queue_academy_due_reminders() TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.academy_assessment_attempts TO authenticated;

-- A short knowledge check for each Phase 1 course. Options intentionally contain no
-- financial values or live-transaction actions.
DO $$
DECLARE r record; v_assessment uuid;
BEGIN
  FOR r IN SELECT cv.id AS course_version_id, cv.title FROM public.academy_course_versions cv JOIN public.academy_courses c ON c.id=cv.course_id WHERE c.organization_id IS NULL AND cv.version=1 AND c.course_key IN ('hotel-front-desk-basics','sacco-member-and-teller-basics','school-fees-and-collections','retail-pos-basics','manufacturing-production-basics','accounting-period-controls') LOOP
    SELECT id INTO v_assessment FROM public.academy_assessments WHERE course_version_id=r.course_version_id;
    IF v_assessment IS NULL THEN INSERT INTO public.academy_assessments(course_version_id,title,pass_mark) VALUES(r.course_version_id,r.title||' knowledge check',70) RETURNING id INTO v_assessment; END IF;
    INSERT INTO public.academy_assessment_questions(assessment_id,question_order,prompt,options,correct_option_key,explanation,points)
    VALUES(v_assessment,1,'What is the safest next action when a BOAT workflow shows a mismatch or exception?','[{"key":"a","label":"Post it quickly and fix it later"},{"key":"b","label":"Stop, review the source details and follow the approved exception process"},{"key":"c","label":"Delete the record and start again"}]'::jsonb,'b','Review and escalate through the approved process rather than forcing a live transaction.',1)
    ON CONFLICT(assessment_id,question_order) DO UPDATE SET prompt=EXCLUDED.prompt,options=EXCLUDED.options,correct_option_key=EXCLUDED.correct_option_key,explanation=EXCLUDED.explanation,points=EXCLUDED.points;
  END LOOP;
END $$;
