-- Idempotent: creates payroll_audit_log if an earlier migration was not applied remotely.
-- Safe to run after 20260427180000_payroll_controls.sql (IF NOT EXISTS + DROP POLICY IF EXISTS).

CREATE TABLE IF NOT EXISTS public.payroll_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payroll_run_id uuid REFERENCES public.payroll_runs(id) ON DELETE SET NULL,
  actor_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_audit_log_org ON public.payroll_audit_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_audit_log_run ON public.payroll_audit_log (payroll_run_id);

ALTER TABLE public.payroll_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_audit_log_select_same_org ON public.payroll_audit_log;
CREATE POLICY payroll_audit_log_select_same_org ON public.payroll_audit_log
  FOR SELECT TO authenticated USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS payroll_audit_log_insert_same_org ON public.payroll_audit_log;
CREATE POLICY payroll_audit_log_insert_same_org ON public.payroll_audit_log
  FOR INSERT TO authenticated WITH CHECK (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

GRANT SELECT, INSERT ON public.payroll_audit_log TO authenticated;
