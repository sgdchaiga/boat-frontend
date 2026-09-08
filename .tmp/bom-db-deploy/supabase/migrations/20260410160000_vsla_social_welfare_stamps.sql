-- Social welfare (social fund) stamp purchases per member per meeting, and settings for stamp value / cap.

ALTER TABLE public.vsla_settings
  ADD COLUMN IF NOT EXISTS social_welfare_stamp_value numeric(18,2) NOT NULL DEFAULT 500 CHECK (social_welfare_stamp_value > 0);

ALTER TABLE public.vsla_settings
  ADD COLUMN IF NOT EXISTS max_social_welfare_stamps_per_meeting integer NOT NULL DEFAULT 5 CHECK (max_social_welfare_stamps_per_meeting > 0);

CREATE TABLE IF NOT EXISTS public.vsla_social_welfare_stamps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.vsla_meetings(id) ON DELETE RESTRICT,
  member_id uuid NOT NULL REFERENCES public.vsla_members(id) ON DELETE RESTRICT,
  stamps integer NOT NULL CHECK (stamps > 0),
  stamp_value numeric(18,2) NOT NULL CHECK (stamp_value > 0),
  total_value numeric(18,2) NOT NULL CHECK (total_value >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_vsla_social_welfare_stamps_org ON public.vsla_social_welfare_stamps (organization_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_set_org_vsla_social_welfare_stamps ON public.vsla_social_welfare_stamps;
CREATE TRIGGER trg_set_org_vsla_social_welfare_stamps BEFORE INSERT ON public.vsla_social_welfare_stamps
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.vsla_social_welfare_stamps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vsla_social_welfare_stamps_tenant_all ON public.vsla_social_welfare_stamps;
CREATE POLICY vsla_social_welfare_stamps_tenant_all ON public.vsla_social_welfare_stamps
FOR ALL TO authenticated
USING (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()))
WITH CHECK (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_social_welfare_stamps TO authenticated;
