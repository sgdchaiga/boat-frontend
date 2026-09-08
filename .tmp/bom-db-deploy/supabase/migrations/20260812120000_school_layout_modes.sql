-- School navigation is explicitly selected by the platform Super Admin.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS school_layout_mode text NOT NULL DEFAULT 'legacy'
  CHECK (school_layout_mode IN ('legacy','standard'));

COMMENT ON COLUMN public.organizations.school_layout_mode IS
  'School sidebar experience: legacy preserves the first BOAT layout; standard uses workflow-based navigation. Platform Super Admin controlled.';
