-- VSLA core module (phase 1): members, shares/savings, and meetings.

CREATE TABLE IF NOT EXISTS public.vsla_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS public.vsla_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  share_value numeric(18,2) NOT NULL DEFAULT 2000 CHECK (share_value > 0),
  max_shares_per_meeting integer NOT NULL DEFAULT 5 CHECK (max_shares_per_meeting > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id)
);

CREATE TABLE IF NOT EXISTS public.vsla_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_id uuid REFERENCES public.vsla_groups(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  national_id text,
  photo_url text,
  phone text,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'chairperson', 'treasurer', 'secretary')),
  is_key_holder boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'exited', 'suspended')),
  household_id text,
  guarantor_member_id uuid REFERENCES public.vsla_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vsla_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_date date NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'open', 'closed')),
  minutes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, meeting_date)
);

CREATE TABLE IF NOT EXISTS public.vsla_meeting_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.vsla_meetings(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.vsla_members(id) ON DELETE CASCADE,
  present boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, member_id)
);

CREATE TABLE IF NOT EXISTS public.vsla_share_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.vsla_meetings(id) ON DELETE RESTRICT,
  member_id uuid NOT NULL REFERENCES public.vsla_members(id) ON DELETE RESTRICT,
  shares_bought integer NOT NULL CHECK (shares_bought > 0),
  share_value numeric(18,2) NOT NULL CHECK (share_value > 0),
  total_value numeric(18,2) NOT NULL CHECK (total_value >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vsla_meeting_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.vsla_meetings(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.vsla_members(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('loan_issue', 'loan_repayment', 'fine')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vsla_groups_org ON public.vsla_groups (organization_id);
CREATE INDEX IF NOT EXISTS idx_vsla_members_org ON public.vsla_members (organization_id, full_name);
CREATE INDEX IF NOT EXISTS idx_vsla_meetings_org ON public.vsla_meetings (organization_id, meeting_date DESC);
CREATE INDEX IF NOT EXISTS idx_vsla_share_transactions_org ON public.vsla_share_transactions (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vsla_meeting_transactions_org ON public.vsla_meeting_transactions (organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_vsla_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_vsla_groups_touch ON public.vsla_groups;
CREATE TRIGGER trg_vsla_groups_touch BEFORE UPDATE ON public.vsla_groups
FOR EACH ROW EXECUTE FUNCTION public.touch_vsla_updated_at();

DROP TRIGGER IF EXISTS trg_vsla_settings_touch ON public.vsla_settings;
CREATE TRIGGER trg_vsla_settings_touch BEFORE UPDATE ON public.vsla_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_vsla_updated_at();

DROP TRIGGER IF EXISTS trg_vsla_members_touch ON public.vsla_members;
CREATE TRIGGER trg_vsla_members_touch BEFORE UPDATE ON public.vsla_members
FOR EACH ROW EXECUTE FUNCTION public.touch_vsla_updated_at();

DROP TRIGGER IF EXISTS trg_vsla_meetings_touch ON public.vsla_meetings;
CREATE TRIGGER trg_vsla_meetings_touch BEFORE UPDATE ON public.vsla_meetings
FOR EACH ROW EXECUTE FUNCTION public.touch_vsla_updated_at();

DROP TRIGGER IF EXISTS trg_set_org_vsla_groups ON public.vsla_groups;
CREATE TRIGGER trg_set_org_vsla_groups BEFORE INSERT ON public.vsla_groups
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_vsla_settings ON public.vsla_settings;
CREATE TRIGGER trg_set_org_vsla_settings BEFORE INSERT ON public.vsla_settings
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_vsla_members ON public.vsla_members;
CREATE TRIGGER trg_set_org_vsla_members BEFORE INSERT ON public.vsla_members
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_vsla_meetings ON public.vsla_meetings;
CREATE TRIGGER trg_set_org_vsla_meetings BEFORE INSERT ON public.vsla_meetings
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_vsla_attendance ON public.vsla_meeting_attendance;
CREATE TRIGGER trg_set_org_vsla_attendance BEFORE INSERT ON public.vsla_meeting_attendance
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_vsla_share_transactions ON public.vsla_share_transactions;
CREATE TRIGGER trg_set_org_vsla_share_transactions BEFORE INSERT ON public.vsla_share_transactions
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_vsla_meeting_transactions ON public.vsla_meeting_transactions;
CREATE TRIGGER trg_set_org_vsla_meeting_transactions BEFORE INSERT ON public.vsla_meeting_transactions
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.vsla_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vsla_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vsla_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vsla_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vsla_meeting_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vsla_share_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vsla_meeting_transactions ENABLE ROW LEVEL SECURITY;

-- Compatibility helper: some databases may not yet have this function.
CREATE OR REPLACE FUNCTION public.auth_staff_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT s.organization_id
  FROM public.staff s
  WHERE s.id = auth.uid()
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.auth_staff_org_id() TO authenticated;

DO $pol$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'vsla_groups',
    'vsla_settings',
    'vsla_members',
    'vsla_meetings',
    'vsla_meeting_attendance',
    'vsla_share_transactions',
    'vsla_meeting_transactions'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_tenant_all', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
       USING (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()))
       WITH CHECK (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()))',
      tbl || '_tenant_all',
      tbl
    );
  END LOOP;
END $pol$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_meetings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_meeting_attendance TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_share_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_meeting_transactions TO authenticated;
