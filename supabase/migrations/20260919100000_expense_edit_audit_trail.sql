-- Preserve an append-only, organization-scoped history for Spend Money edits.
-- Existing records cannot be reconstructed because earlier edits deleted and
-- recreated their lines without recording the prior values. This protects all
-- changes made after the migration is applied.
CREATE TABLE IF NOT EXISTS public.expense_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  actor_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('expense_updated', 'line_added', 'line_changed', 'line_removed')),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_audit_log_expense_created
  ON public.expense_audit_log (expense_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_audit_log_org_created
  ON public.expense_audit_log (organization_id, created_at DESC);

ALTER TABLE public.expense_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense_audit_log_select_same_org" ON public.expense_audit_log;
CREATE POLICY "expense_audit_log_select_same_org"
  ON public.expense_audit_log FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.organization_id = expense_audit_log.organization_id
    )
  );

-- No INSERT/UPDATE/DELETE policy is deliberately granted to application users.
-- The security-definer trigger is the only writer, making the trail append-only.
REVOKE INSERT, UPDATE, DELETE ON public.expense_audit_log FROM anon, authenticated;
GRANT SELECT ON public.expense_audit_log TO authenticated;

CREATE OR REPLACE FUNCTION public.write_expense_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense_id uuid;
  v_organization_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_action text;
BEGIN
  IF TG_TABLE_NAME = 'expenses' THEN
    v_expense_id := NEW.id;
    v_organization_id := NEW.organization_id;
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    v_action := 'expense_updated';
  ELSIF TG_OP = 'INSERT' THEN
    v_expense_id := NEW.expense_id;
    v_after := to_jsonb(NEW);
    v_action := 'line_added';
  ELSIF TG_OP = 'UPDATE' THEN
    v_expense_id := NEW.expense_id;
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    v_action := 'line_changed';
  ELSE
    v_expense_id := OLD.expense_id;
    v_before := to_jsonb(OLD);
    v_action := 'line_removed';
  END IF;

  IF v_organization_id IS NULL THEN
    SELECT organization_id INTO v_organization_id FROM public.expenses WHERE id = v_expense_id;
  END IF;
  IF v_organization_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO public.expense_audit_log (
    organization_id, expense_id, actor_staff_id, action, before_data, after_data
  ) VALUES (
    v_organization_id, v_expense_id, auth.uid(), v_action, v_before, v_after
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_expenses_audit_updates ON public.expenses;
CREATE TRIGGER trg_expenses_audit_updates
  AFTER UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.write_expense_audit_log();

DROP TRIGGER IF EXISTS trg_expense_lines_audit_changes ON public.expense_lines;
CREATE TRIGGER trg_expense_lines_audit_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.expense_lines
  FOR EACH ROW EXECUTE FUNCTION public.write_expense_audit_log();
