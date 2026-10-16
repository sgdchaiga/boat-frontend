-- Adds the streamlined, workflow-based School Finance Workspace navigation.
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_school_layout_mode_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_school_layout_mode_check
  CHECK (school_layout_mode IN ('legacy', 'standard', 'finance_workspace'));

COMMENT ON COLUMN public.organizations.school_layout_mode IS
  'School sidebar experience: legacy, standard workflow navigation, or the streamlined School Finance Workspace.';
