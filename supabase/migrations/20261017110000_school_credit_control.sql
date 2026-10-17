-- A durable, organisation-scoped audit trail for fee-arrears follow-up.
-- The control centre reads invoices and payments from their existing tables;
-- this table records only the credit-control evidence and payment promises.

CREATE TABLE IF NOT EXISTS public.school_credit_control_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  student_invoice_id uuid REFERENCES public.student_invoices(id) ON DELETE SET NULL,
  action_type text NOT NULL CHECK (action_type IN ('call', 'sms', 'email', 'letter', 'promise_to_pay', 'note')),
  action_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text NOT NULL CHECK (length(btrim(notes)) > 0),
  promise_amount numeric(18,2) CHECK (promise_amount IS NULL OR promise_amount >= 0),
  promise_date date,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_credit_control_promise_details CHECK (
    action_type <> 'promise_to_pay' OR promise_date IS NOT NULL OR promise_amount IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_school_credit_actions_org_student_date
  ON public.school_credit_control_actions (organization_id, student_id, action_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_school_credit_actions_org_invoice_date
  ON public.school_credit_control_actions (organization_id, student_invoice_id, action_date DESC, created_at DESC)
  WHERE student_invoice_id IS NOT NULL;

ALTER TABLE public.school_credit_control_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS school_credit_control_actions_select_org ON public.school_credit_control_actions;
CREATE POLICY school_credit_control_actions_select_org
  ON public.school_credit_control_actions FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid() AND s.organization_id = school_credit_control_actions.organization_id
    )
  );

DROP POLICY IF EXISTS school_credit_control_actions_insert_org ON public.school_credit_control_actions;
CREATE POLICY school_credit_control_actions_insert_org
  ON public.school_credit_control_actions FOR INSERT TO authenticated
  WITH CHECK (
    (public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid() AND s.organization_id = school_credit_control_actions.organization_id
    ))
    AND (created_by IS NULL OR created_by = auth.uid())
  );

-- Follow-up entries are deliberately append-only: corrections should be new
-- notes so the school never loses its collection history.
REVOKE UPDATE, DELETE ON public.school_credit_control_actions FROM authenticated;
GRANT SELECT, INSERT ON public.school_credit_control_actions TO authenticated;

COMMENT ON TABLE public.school_credit_control_actions IS 'Append-only contact, reminder and promise-to-pay trail for student fee receivables.';
