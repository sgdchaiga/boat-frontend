-- Payroll: approval before posting, lock lines after post, audit trail

-- 1) Status includes 'approved'; approval columns
ALTER TABLE public.payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_status_check;
ALTER TABLE public.payroll_runs
  ADD CONSTRAINT payroll_runs_status_check
  CHECK (status IN ('draft', 'calculated', 'approved', 'posted'));

ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL;

UPDATE public.payroll_runs
SET approved_at = COALESCE(approved_at, posted_at),
    approved_by = COALESCE(approved_by, posted_by)
WHERE status = 'posted' AND approved_at IS NULL;

COMMENT ON COLUMN public.payroll_runs.approved_at IS 'Payroll approved for payment/posting (required before status=posted).';
COMMENT ON COLUMN public.payroll_runs.approved_by IS 'Staff who approved the run for posting.';

-- 2) Cannot post without approval
CREATE OR REPLACE FUNCTION public.payroll_runs_require_approval_before_post()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'posted' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.approved_at IS NULL THEN
        RAISE EXCEPTION 'Payroll must be approved before posting to the ledger.';
      END IF;
    ELSIF OLD.status IS DISTINCT FROM 'posted' THEN
      IF NEW.approved_at IS NULL THEN
        RAISE EXCEPTION 'Payroll must be approved before posting to the ledger.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_runs_approval_before_post ON public.payroll_runs;
CREATE TRIGGER trg_payroll_runs_approval_before_post
  BEFORE INSERT OR UPDATE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.payroll_runs_require_approval_before_post();

-- 3) Lock run lines when run is posted (no insert/update/delete)
CREATE OR REPLACE FUNCTION public.payroll_run_lines_block_when_posted()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT r.status INTO st FROM public.payroll_runs r WHERE r.id = COALESCE(NEW.payroll_run_id, OLD.payroll_run_id);
  IF st = 'posted' THEN
    RAISE EXCEPTION 'Payroll run is locked after posting.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_run_lines_lock_posted ON public.payroll_run_lines;
CREATE TRIGGER trg_payroll_run_lines_lock_posted
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_run_lines
  FOR EACH ROW EXECUTE FUNCTION public.payroll_run_lines_block_when_posted();

-- 4) Audit log (append-only for authenticated users)
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

COMMENT ON TABLE public.payroll_audit_log IS 'Payroll actions: prepare, calculate, approve, post, etc.';
