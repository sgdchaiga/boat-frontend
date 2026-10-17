-- BOAT Academy first release.  Content is versioned separately from tenant/user data
-- so a published BOAT lesson can be safely reused by every organization.

CREATE TABLE IF NOT EXISTS public.academy_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_key text NOT NULL,
  business_types text[] NOT NULL DEFAULT '{}',
  module_keys text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (organization_id, course_key)
);

CREATE TABLE IF NOT EXISTS public.academy_course_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.academy_courses(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, version)
);

CREATE TABLE IF NOT EXISTS public.academy_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  lesson_key text NOT NULL,
  module_key text NOT NULL,
  page_key text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (organization_id, lesson_key)
);

CREATE TABLE IF NOT EXISTS public.academy_lesson_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.academy_lessons(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  content jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimated_minutes integer NOT NULL DEFAULT 5 CHECK (estimated_minutes > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, version)
);

CREATE TABLE IF NOT EXISTS public.academy_course_lessons (
  course_version_id uuid NOT NULL REFERENCES public.academy_course_versions(id) ON DELETE CASCADE,
  lesson_version_id uuid NOT NULL REFERENCES public.academy_lesson_versions(id) ON DELETE RESTRICT,
  lesson_order integer NOT NULL CHECK (lesson_order > 0),
  is_required boolean NOT NULL DEFAULT true,
  PRIMARY KEY (course_version_id, lesson_version_id),
  UNIQUE (course_version_id, lesson_order)
);

CREATE TABLE IF NOT EXISTS public.academy_media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'supabase_storage' CHECK (provider IN ('supabase_storage','external_stream')),
  storage_key text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('image','video','document')),
  alt_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (organization_id, storage_key)
);

CREATE TABLE IF NOT EXISTS public.academy_assignment_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_version_id uuid NOT NULL REFERENCES public.academy_course_versions(id) ON DELETE CASCADE,
  business_types text[] NOT NULL DEFAULT '{}',
  module_keys text[] NOT NULL DEFAULT '{}',
  role_keys text[] NOT NULL DEFAULT '{}',
  due_days integer CHECK (due_days IS NULL OR due_days >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.academy_feature_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  release_key text NOT NULL,
  title text NOT NULL,
  course_version_id uuid NOT NULL REFERENCES public.academy_course_versions(id) ON DELETE RESTRICT,
  business_types text[] NOT NULL DEFAULT '{}',
  module_keys text[] NOT NULL DEFAULT '{}',
  role_keys text[] NOT NULL DEFAULT '{}',
  due_days integer NOT NULL DEFAULT 14 CHECK (due_days >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (organization_id, release_key)
);

CREATE TABLE IF NOT EXISTS public.academy_user_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_version_id uuid NOT NULL REFERENCES public.academy_course_versions(id) ON DELETE RESTRICT,
  feature_release_id uuid REFERENCES public.academy_feature_releases(id) ON DELETE SET NULL,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','in_progress','completed','overdue')),
  completed_at timestamptz,
  UNIQUE NULLS NOT DISTINCT (organization_id, user_id, course_version_id, feature_release_id)
);

CREATE TABLE IF NOT EXISTS public.academy_lesson_progress (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_version_id uuid NOT NULL REFERENCES public.academy_lesson_versions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed')),
  percent_complete integer NOT NULL DEFAULT 0 CHECK (percent_complete BETWEEN 0 AND 100),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, lesson_version_id)
);

CREATE TABLE IF NOT EXISTS public.academy_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_version_id uuid NOT NULL REFERENCES public.academy_course_versions(id) ON DELETE CASCADE,
  title text NOT NULL,
  pass_mark numeric(5,2) NOT NULL DEFAULT 70 CHECK (pass_mark BETWEEN 0 AND 100),
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS public.academy_assessment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL REFERENCES public.academy_assessments(id) ON DELETE CASCADE,
  score numeric(5,2),
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','passed','failed')),
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS academy_assignment_user_idx ON public.academy_user_assignments(organization_id, user_id, status, due_at);
CREATE INDEX IF NOT EXISTS academy_lessons_page_idx ON public.academy_lessons(module_key, page_key) WHERE is_active;

-- Self-contained rather than relying on the earlier optional in-app-learning migration.
CREATE OR REPLACE FUNCTION public.academy_user_can_manage()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.staff WHERE id=auth.uid() AND role IN ('admin','manager','super_admin','owner')
  )
$$;

-- Uses existing staff roles and organization business types; no duplicate identity or role tables.
CREATE OR REPLACE FUNCTION public.assign_academy_feature_release(p_release_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_release public.academy_feature_releases; v_count integer;
BEGIN
  SELECT * INTO v_release FROM public.academy_feature_releases WHERE id = p_release_id AND status = 'published';
  IF NOT FOUND THEN RAISE EXCEPTION 'Published Academy feature release not found'; END IF;
  IF NOT public.is_platform_admin() AND NOT (public.academy_user_can_manage() AND (v_release.organization_id IS NULL OR public.user_is_member_of_org(v_release.organization_id))) THEN
    RAISE EXCEPTION 'Not allowed to assign this release';
  END IF;
  INSERT INTO public.academy_user_assignments (organization_id,user_id,course_version_id,feature_release_id,due_at)
  SELECT s.organization_id,s.id,v_release.course_version_id,v_release.id,now() + make_interval(days => v_release.due_days)
  FROM public.staff s JOIN public.organizations o ON o.id=s.organization_id
  WHERE (v_release.organization_id IS NULL OR s.organization_id=v_release.organization_id)
    AND (cardinality(v_release.business_types)=0 OR lower(coalesce(o.business_type::text,'')) = ANY(v_release.business_types))
    AND (cardinality(v_release.role_keys)=0 OR lower(coalesce(s.role::text,'')) = ANY(v_release.role_keys))
  ON CONFLICT (organization_id,user_id,course_version_id,feature_release_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT; RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.academy_assign_published_releases_to_staff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- This trigger must not depend on the identity of a newly provisioned staff
  -- member; it applies the same published-release filters directly.
  INSERT INTO public.academy_user_assignments (organization_id,user_id,course_version_id,feature_release_id,due_at)
  SELECT NEW.organization_id,NEW.id,r.course_version_id,r.id,now() + make_interval(days => r.due_days)
  FROM public.academy_feature_releases r
  JOIN public.organizations o ON o.id=NEW.organization_id
  WHERE r.status='published' AND (r.organization_id IS NULL OR r.organization_id=NEW.organization_id)
    AND (cardinality(r.business_types)=0 OR lower(coalesce(o.business_type::text,'')) = ANY(r.business_types))
    AND (cardinality(r.role_keys)=0 OR lower(coalesce(NEW.role::text,'')) = ANY(r.role_keys))
  ON CONFLICT (organization_id,user_id,course_version_id,feature_release_id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_academy_assign_releases_to_new_staff ON public.staff;
CREATE TRIGGER trg_academy_assign_releases_to_new_staff AFTER INSERT ON public.staff FOR EACH ROW EXECUTE FUNCTION public.academy_assign_published_releases_to_staff();

CREATE OR REPLACE FUNCTION public.academy_publish_release_assignments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status='published' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    NEW.published_at := coalesce(NEW.published_at, now());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_academy_feature_release_publish ON public.academy_feature_releases;
CREATE TRIGGER trg_academy_feature_release_publish BEFORE INSERT OR UPDATE ON public.academy_feature_releases FOR EACH ROW EXECUTE FUNCTION public.academy_publish_release_assignments();

CREATE OR REPLACE FUNCTION public.academy_dispatch_published_release()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status='published' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    PERFORM public.assign_academy_feature_release(NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_academy_dispatch_published_release ON public.academy_feature_releases;
CREATE TRIGGER trg_academy_dispatch_published_release AFTER INSERT OR UPDATE ON public.academy_feature_releases FOR EACH ROW EXECUTE FUNCTION public.academy_dispatch_published_release();

CREATE OR REPLACE FUNCTION public.academy_manager_progress(p_organization_id uuid)
RETURNS TABLE (user_id uuid, full_name text, role text, assigned integer, completed integer, overdue integer, completion_percent numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, coalesce(s.full_name,s.email,s.id::text), s.role::text,
    count(a.id)::integer, count(a.id) FILTER (WHERE a.status='completed')::integer,
    count(a.id) FILTER (WHERE a.due_at < now() AND a.status <> 'completed')::integer,
    CASE WHEN count(a.id)=0 THEN 0 ELSE round(100.0*count(a.id) FILTER (WHERE a.status='completed')/count(a.id),1) END
  FROM public.staff s LEFT JOIN public.academy_user_assignments a ON a.user_id=s.id AND a.organization_id=s.organization_id
  WHERE s.organization_id=p_organization_id AND (public.is_platform_admin() OR (public.academy_user_can_manage() AND public.user_is_member_of_org(p_organization_id)))
  GROUP BY s.id,s.full_name,s.email,s.role;
$$;

-- Content managers publish an organization course and its first lesson atomically.
-- Later revisions are deliberately additive, preserving historic completions.
CREATE OR REPLACE FUNCTION public.publish_organization_academy_course(
  p_organization_id uuid, p_course_key text, p_course_title text, p_course_summary text,
  p_module_key text, p_page_key text, p_lesson_title text, p_lesson_summary text,
  p_content jsonb, p_role_keys text[] DEFAULT '{}', p_release_key text DEFAULT NULL, p_due_days integer DEFAULT 14
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_course uuid; v_course_version uuid; v_lesson uuid; v_lesson_version uuid; v_version integer; v_release uuid;
BEGIN
  IF NOT public.user_is_member_of_org(p_organization_id) OR NOT public.academy_user_can_manage() THEN RAISE EXCEPTION 'Only an organization Academy manager can publish training'; END IF;
  IF btrim(p_course_key)='' OR btrim(p_course_title)='' OR btrim(p_lesson_title)='' THEN RAISE EXCEPTION 'Course key, course title and lesson title are required'; END IF;
  IF p_due_days < 0 THEN RAISE EXCEPTION 'Due days cannot be negative'; END IF;
  INSERT INTO public.academy_courses(organization_id,course_key,module_keys,created_by)
  VALUES(p_organization_id,lower(trim(p_course_key)),ARRAY[lower(trim(p_module_key))],auth.uid())
  ON CONFLICT(organization_id,course_key) DO UPDATE SET module_keys=EXCLUDED.module_keys,updated_at=now()
  RETURNING id INTO v_course;
  SELECT coalesce(max(version),0)+1 INTO v_version FROM public.academy_course_versions WHERE course_id=v_course;
  INSERT INTO public.academy_course_versions(course_id,version,title,summary,status,published_at)
  VALUES(v_course,v_version,trim(p_course_title),coalesce(trim(p_course_summary),''),'published',now()) RETURNING id INTO v_course_version;
  INSERT INTO public.academy_lessons(organization_id,lesson_key,module_key,page_key,created_by)
  VALUES(p_organization_id,lower(trim(p_course_key))||'-lesson',lower(trim(p_module_key)),nullif(trim(p_page_key),''),auth.uid())
  ON CONFLICT(organization_id,lesson_key) DO UPDATE SET module_key=EXCLUDED.module_key,page_key=EXCLUDED.page_key,updated_at=now()
  RETURNING id INTO v_lesson;
  SELECT coalesce(max(version),0)+1 INTO v_version FROM public.academy_lesson_versions WHERE lesson_id=v_lesson;
  INSERT INTO public.academy_lesson_versions(lesson_id,version,title,summary,content,status,published_at)
  VALUES(v_lesson,v_version,trim(p_lesson_title),coalesce(trim(p_lesson_summary),''),coalesce(p_content,'[]'::jsonb),'published',now()) RETURNING id INTO v_lesson_version;
  INSERT INTO public.academy_course_lessons(course_version_id,lesson_version_id,lesson_order,is_required) VALUES(v_course_version,v_lesson_version,1,true);
  IF nullif(trim(coalesce(p_release_key,'')),'') IS NOT NULL THEN
    INSERT INTO public.academy_feature_releases(organization_id,release_key,title,course_version_id,role_keys,due_days,status)
    VALUES(p_organization_id,lower(trim(p_release_key)),trim(p_course_title),v_course_version,coalesce(p_role_keys,'{}'),p_due_days,'published') RETURNING id INTO v_release;
  END IF;
  RETURN jsonb_build_object('course_version_id',v_course_version,'lesson_version_id',v_lesson_version,'feature_release_id',v_release);
END $$;

CREATE OR REPLACE FUNCTION public.complete_academy_lesson(p_organization_id uuid,p_lesson_version_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.user_is_member_of_org(p_organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO public.academy_lesson_progress(organization_id,user_id,lesson_version_id,status,percent_complete,completed_at,updated_at)
  VALUES(p_organization_id,auth.uid(),p_lesson_version_id,'completed',100,now(),now())
  ON CONFLICT(organization_id,user_id,lesson_version_id) DO UPDATE SET status='completed',percent_complete=100,completed_at=coalesce(academy_lesson_progress.completed_at,now()),updated_at=now();
  UPDATE public.academy_user_assignments a SET status='completed',completed_at=coalesce(a.completed_at,now())
  WHERE a.organization_id=p_organization_id AND a.user_id=auth.uid() AND a.status <> 'completed'
    AND NOT EXISTS (SELECT 1 FROM public.academy_course_lessons cl LEFT JOIN public.academy_lesson_progress p ON p.organization_id=p_organization_id AND p.user_id=auth.uid() AND p.lesson_version_id=cl.lesson_version_id AND p.status='completed' WHERE cl.course_version_id=a.course_version_id AND cl.is_required AND p.lesson_version_id IS NULL);
END $$;

ALTER TABLE public.academy_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_course_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_lesson_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_course_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_assignment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_feature_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_user_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_assessment_attempts ENABLE ROW LEVEL SECURITY;

-- Published global catalogue is readable to all signed-in users; tenant content is scoped to membership.
CREATE OR REPLACE FUNCTION public.academy_content_visible(p_organization_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT p_organization_id IS NULL OR public.user_is_member_of_org(p_organization_id) OR public.is_platform_admin() $$;
CREATE OR REPLACE FUNCTION public.academy_content_manageable(p_organization_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT public.is_platform_admin() OR (p_organization_id IS NOT NULL AND public.user_is_member_of_org(p_organization_id) AND public.academy_user_can_manage()) $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['academy_courses','academy_lessons','academy_media_assets','academy_assignment_rules','academy_feature_releases'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.academy_content_visible(organization_id))',t||'_read',t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.academy_content_manageable(organization_id)) WITH CHECK (public.academy_content_manageable(organization_id))',t||'_manage',t);
  END LOOP;
END $$;
CREATE POLICY academy_course_versions_read ON public.academy_course_versions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.academy_courses c WHERE c.id=course_id AND public.academy_content_visible(c.organization_id) AND (status='published' OR public.academy_content_manageable(c.organization_id))));
CREATE POLICY academy_course_versions_manage ON public.academy_course_versions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.academy_courses c WHERE c.id=course_id AND public.academy_content_manageable(c.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.academy_courses c WHERE c.id=course_id AND public.academy_content_manageable(c.organization_id)));
CREATE POLICY academy_lesson_versions_read ON public.academy_lesson_versions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.academy_lessons l WHERE l.id=lesson_id AND public.academy_content_visible(l.organization_id) AND (status='published' OR public.academy_content_manageable(l.organization_id))));
CREATE POLICY academy_lesson_versions_manage ON public.academy_lesson_versions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.academy_lessons l WHERE l.id=lesson_id AND public.academy_content_manageable(l.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.academy_lessons l WHERE l.id=lesson_id AND public.academy_content_manageable(l.organization_id)));
CREATE POLICY academy_course_lessons_read ON public.academy_course_lessons FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.academy_course_versions cv JOIN public.academy_courses c ON c.id=cv.course_id WHERE cv.id=course_version_id AND public.academy_content_visible(c.organization_id) AND (cv.status='published' OR public.academy_content_manageable(c.organization_id))));
CREATE POLICY academy_course_lessons_manage ON public.academy_course_lessons FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.academy_course_versions cv JOIN public.academy_courses c ON c.id=cv.course_id WHERE cv.id=course_version_id AND public.academy_content_manageable(c.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.academy_course_versions cv JOIN public.academy_courses c ON c.id=cv.course_id WHERE cv.id=course_version_id AND public.academy_content_manageable(c.organization_id)));
CREATE POLICY academy_assessments_read ON public.academy_assessments FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.academy_course_versions cv JOIN public.academy_courses c ON c.id=cv.course_id WHERE cv.id=course_version_id AND public.academy_content_visible(c.organization_id) AND (cv.status='published' OR public.academy_content_manageable(c.organization_id))));
CREATE POLICY academy_assessments_manage ON public.academy_assessments FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.academy_course_versions cv JOIN public.academy_courses c ON c.id=cv.course_id WHERE cv.id=course_version_id AND public.academy_content_manageable(c.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.academy_course_versions cv JOIN public.academy_courses c ON c.id=cv.course_id WHERE cv.id=course_version_id AND public.academy_content_manageable(c.organization_id)));
CREATE POLICY academy_assignments_access ON public.academy_user_assignments FOR SELECT TO authenticated USING (public.user_is_member_of_org(organization_id) AND (user_id=auth.uid() OR public.academy_user_can_manage()));
CREATE POLICY academy_assignments_manage ON public.academy_user_assignments FOR INSERT TO authenticated WITH CHECK (public.academy_content_manageable(organization_id));
CREATE POLICY academy_progress_access ON public.academy_lesson_progress FOR ALL TO authenticated USING (public.user_is_member_of_org(organization_id) AND (user_id=auth.uid() OR public.academy_user_can_manage())) WITH CHECK (public.user_is_member_of_org(organization_id) AND user_id=auth.uid());
CREATE POLICY academy_attempts_access ON public.academy_assessment_attempts FOR ALL TO authenticated USING (public.user_is_member_of_org(organization_id) AND (user_id=auth.uid() OR public.academy_user_can_manage())) WITH CHECK (public.user_is_member_of_org(organization_id) AND user_id=auth.uid());

GRANT SELECT ON public.academy_courses,public.academy_course_versions,public.academy_lessons,public.academy_lesson_versions,public.academy_course_lessons,public.academy_media_assets,public.academy_assignment_rules,public.academy_feature_releases,public.academy_assessments,public.academy_user_assignments TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.academy_lesson_progress,public.academy_assessment_attempts TO authenticated;
GRANT EXECUTE ON FUNCTION public.academy_user_can_manage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_academy_feature_release(uuid),public.academy_manager_progress(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_organization_academy_course(uuid,text,text,text,text,text,text,text,jsonb,text[],text,integer),public.complete_academy_lesson(uuid,uuid) TO authenticated;
