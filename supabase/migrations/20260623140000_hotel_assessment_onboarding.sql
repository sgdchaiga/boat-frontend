-- Hotel Assessment & Onboarding Engine: prospect hotels, branch scoring, recommendations.
-- Logical names per product spec: hotels → onboarding_hotels (avoids collision with future domain "hotels").

ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS enable_hotel_assessment boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.onboarding_hotels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  location text NOT NULL DEFAULT '',
  contact_person text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  number_of_branches integer NOT NULL DEFAULT 1 CHECK (number_of_branches >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.onboarding_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.onboarding_hotels(id) ON DELETE CASCADE,
  name text NOT NULL,
  location text NOT NULL DEFAULT '',
  rooms integer NOT NULL DEFAULT 0 CHECK (rooms >= 0),
  occupancy_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (occupancy_rate >= 0 AND occupancy_rate <= 100)
);

CREATE TABLE IF NOT EXISTS public.onboarding_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES public.onboarding_hotels(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.onboarding_branches(id) ON DELETE SET NULL,
  assessor_name text NOT NULL DEFAULT '',
  assessment_date date NOT NULL DEFAULT (CURRENT_DATE),
  total_score numeric(6,3),
  readiness_level text CHECK (readiness_level IS NULL OR readiness_level IN ('HIGH', 'MEDIUM', 'LOW', 'CRITICAL')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  converted_to_client boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_hotels_org ON public.onboarding_hotels(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_branches_hotel ON public.onboarding_branches(hotel_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_assessments_org ON public.onboarding_assessments(organization_id, assessment_date DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_assessments_hotel ON public.onboarding_assessments(hotel_id);

CREATE TABLE IF NOT EXISTS public.onboarding_assessment_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.onboarding_assessments(id) ON DELETE CASCADE,
  category text NOT NULL,
  item text NOT NULL,
  score smallint NOT NULL CHECK (score >= 1 AND score <= 5),
  UNIQUE (assessment_id, category, item)
);

CREATE TABLE IF NOT EXISTS public.onboarding_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.onboarding_assessments(id) ON DELETE CASCADE,
  module text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  UNIQUE (assessment_id, module)
);

DROP TRIGGER IF EXISTS trg_set_org_onboarding_hotels ON public.onboarding_hotels;
CREATE TRIGGER trg_set_org_onboarding_hotels
BEFORE INSERT ON public.onboarding_hotels
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_onboarding_assessments ON public.onboarding_assessments;
CREATE TRIGGER trg_set_org_onboarding_assessments
BEFORE INSERT ON public.onboarding_assessments
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.onboarding_hotels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_assessment_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_recommendations ENABLE ROW LEVEL SECURITY;

-- onboarding_hotels
DROP POLICY IF EXISTS "onboarding_hotels_select_org" ON public.onboarding_hotels;
DROP POLICY IF EXISTS "onboarding_hotels_write_org" ON public.onboarding_hotels;
CREATE POLICY "onboarding_hotels_select_org"
  ON public.onboarding_hotels FOR SELECT TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));
CREATE POLICY "onboarding_hotels_write_org"
  ON public.onboarding_hotels FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

-- onboarding_branches (via parent hotel)
DROP POLICY IF EXISTS "onboarding_branches_select_org" ON public.onboarding_branches;
DROP POLICY IF EXISTS "onboarding_branches_write_org" ON public.onboarding_branches;
CREATE POLICY "onboarding_branches_select_org"
  ON public.onboarding_branches FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.onboarding_hotels h
      WHERE h.id = onboarding_branches.hotel_id
        AND h.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );
CREATE POLICY "onboarding_branches_write_org"
  ON public.onboarding_branches FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.onboarding_hotels h
      WHERE h.id = onboarding_branches.hotel_id
        AND h.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.onboarding_hotels h
      WHERE h.id = onboarding_branches.hotel_id
        AND h.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );

-- onboarding_assessments
DROP POLICY IF EXISTS "onboarding_assessments_select_org" ON public.onboarding_assessments;
DROP POLICY IF EXISTS "onboarding_assessments_write_org" ON public.onboarding_assessments;
CREATE POLICY "onboarding_assessments_select_org"
  ON public.onboarding_assessments FOR SELECT TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));
CREATE POLICY "onboarding_assessments_write_org"
  ON public.onboarding_assessments FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

-- scores (via assessment org)
DROP POLICY IF EXISTS "onboarding_scores_select_org" ON public.onboarding_assessment_scores;
DROP POLICY IF EXISTS "onboarding_scores_write_org" ON public.onboarding_assessment_scores;
CREATE POLICY "onboarding_scores_select_org"
  ON public.onboarding_assessment_scores FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.onboarding_assessments a
      WHERE a.id = onboarding_assessment_scores.assessment_id
        AND a.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );
CREATE POLICY "onboarding_scores_write_org"
  ON public.onboarding_assessment_scores FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.onboarding_assessments a
      WHERE a.id = onboarding_assessment_scores.assessment_id
        AND a.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.onboarding_assessments a
      WHERE a.id = onboarding_assessment_scores.assessment_id
        AND a.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );

-- recommendations
DROP POLICY IF EXISTS "onboarding_reco_select_org" ON public.onboarding_recommendations;
DROP POLICY IF EXISTS "onboarding_reco_write_org" ON public.onboarding_recommendations;
CREATE POLICY "onboarding_reco_select_org"
  ON public.onboarding_recommendations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.onboarding_assessments a
      WHERE a.id = onboarding_recommendations.assessment_id
        AND a.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );
CREATE POLICY "onboarding_reco_write_org"
  ON public.onboarding_recommendations FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.onboarding_assessments a
      WHERE a.id = onboarding_recommendations.assessment_id
        AND a.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.onboarding_assessments a
      WHERE a.id = onboarding_recommendations.assessment_id
        AND a.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );

COMMENT ON TABLE public.onboarding_hotels IS 'Prospect hotels for Assessment & Onboarding (hotel assessment engine).';
COMMENT ON TABLE public.onboarding_branches IS 'Branches under a prospect hotel; scores can be compared across branches.';
COMMENT ON TABLE public.onboarding_assessments IS 'Assessment run: scores, readiness, sales funnel conversion flag.';
