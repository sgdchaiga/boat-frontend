-- BOAT school budgeting Phase 1: annual/term planning, departments,
-- controlled approvals, immutable approved versions, and audit history.

ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS financial_year int,
  ADD COLUMN IF NOT EXISTS period_mode text NOT NULL DEFAULT 'annual_terms',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS version_no int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_budget_id uuid REFERENCES public.budgets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS activated_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS workflow_note text;

UPDATE public.budgets
SET status = CASE WHEN is_active THEN 'active' ELSE 'draft' END,
    financial_year = COALESCE(financial_year, EXTRACT(YEAR FROM start_date)::int),
    period_mode = 'annual'
WHERE status = 'draft' AND (is_active OR financial_year IS NULL);

ALTER TABLE public.budgets DROP CONSTRAINT IF EXISTS budgets_status_check;
ALTER TABLE public.budgets ADD CONSTRAINT budgets_status_check
  CHECK (status IN ('draft','submitted','reviewed','approved','active','revised','closed'));
ALTER TABLE public.budgets DROP CONSTRAINT IF EXISTS budgets_period_mode_check;
ALTER TABLE public.budgets ADD CONSTRAINT budgets_period_mode_check
  CHECK (period_mode IN ('annual_terms','monthly','quarterly','annual'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_one_active_scope
  ON public.budgets (organization_id, COALESCE(financial_year, 0))
  WHERE status = 'active' AND period_mode = 'annual_terms';

ALTER TABLE public.budget_lines
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS budget_type text NOT NULL DEFAULT 'operating_expense',
  ADD COLUMN IF NOT EXISTS term_1_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS term_2_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS term_3_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS annual_other_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS responsible_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assumptions text;

UPDATE public.budget_lines
SET annual_other_amount = amount
WHERE term_1_amount = 0 AND term_2_amount = 0 AND term_3_amount = 0
  AND annual_other_amount = 0 AND amount <> 0;

ALTER TABLE public.budget_lines DROP CONSTRAINT IF EXISTS budget_lines_budget_type_check;
ALTER TABLE public.budget_lines ADD CONSTRAINT budget_lines_budget_type_check
  CHECK (budget_type IN ('income','operating_expense','staff_cost','capital_expenditure'));
ALTER TABLE public.budget_lines ADD CONSTRAINT budget_lines_term_1_nonnegative CHECK (term_1_amount >= 0);
ALTER TABLE public.budget_lines ADD CONSTRAINT budget_lines_term_2_nonnegative CHECK (term_2_amount >= 0);
ALTER TABLE public.budget_lines ADD CONSTRAINT budget_lines_term_3_nonnegative CHECK (term_3_amount >= 0);
ALTER TABLE public.budget_lines ADD CONSTRAINT budget_lines_annual_other_nonnegative CHECK (annual_other_amount >= 0);

CREATE INDEX IF NOT EXISTS idx_budget_lines_department ON public.budget_lines (department_id, budget_id);

CREATE OR REPLACE FUNCTION public.sync_school_budget_line_total()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Backward compatibility for model/import integrations that still provide
  -- only the legacy annual `amount` field.
  IF COALESCE(NEW.term_1_amount,0) + COALESCE(NEW.term_2_amount,0)
      + COALESCE(NEW.term_3_amount,0) + COALESCE(NEW.annual_other_amount,0) = 0
      AND COALESCE(NEW.amount,0) > 0 THEN
    NEW.annual_other_amount := NEW.amount;
  END IF;
  NEW.amount := COALESCE(NEW.term_1_amount,0) + COALESCE(NEW.term_2_amount,0)
    + COALESCE(NEW.term_3_amount,0) + COALESCE(NEW.annual_other_amount,0);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_school_budget_line_total ON public.budget_lines;
CREATE TRIGGER trg_sync_school_budget_line_total
BEFORE INSERT OR UPDATE OF term_1_amount,term_2_amount,term_3_amount,annual_other_amount
ON public.budget_lines FOR EACH ROW EXECUTE FUNCTION public.sync_school_budget_line_total();

CREATE TABLE IF NOT EXISTS public.budget_workflow_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  budget_id uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  note text,
  acted_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  acted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_budget_workflow_history_budget
  ON public.budget_workflow_history (budget_id, acted_at DESC);

ALTER TABLE public.budget_workflow_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_workflow_history_org ON public.budget_workflow_history;
CREATE POLICY budget_workflow_history_org ON public.budget_workflow_history FOR SELECT TO authenticated
USING (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()));
GRANT SELECT ON public.budget_workflow_history TO authenticated;

CREATE OR REPLACE FUNCTION public.change_budget_status(p_budget_id uuid, p_to_status text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  b public.budgets%ROWTYPE;
  oid uuid;
  next_active boolean;
BEGIN
  SELECT organization_id INTO oid FROM public.staff WHERE id=auth.uid();
  SELECT * INTO b FROM public.budgets WHERE id=p_budget_id AND organization_id=oid FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Budget not found'; END IF;
  IF p_to_status NOT IN ('draft','submitted','reviewed','approved','active','revised','closed') THEN
    RAISE EXCEPTION 'Invalid budget status';
  END IF;
  IF NOT (
    (b.status='draft' AND p_to_status='submitted') OR
    (b.status='submitted' AND p_to_status IN ('draft','reviewed')) OR
    (b.status='reviewed' AND p_to_status IN ('draft','approved')) OR
    (b.status='approved' AND p_to_status='active') OR
    (b.status='active' AND p_to_status IN ('revised','closed')) OR
    (b.status='revised' AND p_to_status='closed')
  ) THEN RAISE EXCEPTION 'Transition from % to % is not allowed', b.status, p_to_status; END IF;
  IF p_to_status IN ('reviewed','approved','active') AND b.submitted_by=auth.uid() THEN
    RAISE EXCEPTION 'You cannot review or approve your own budget submission';
  END IF;
  IF p_to_status='submitted' AND NOT EXISTS (SELECT 1 FROM public.budget_lines WHERE budget_id=b.id) THEN
    RAISE EXCEPTION 'Add at least one budget line before submission';
  END IF;
  IF p_to_status='submitted' AND EXISTS (
    SELECT 1 FROM public.budget_lines WHERE budget_id=b.id
      AND amount <> term_1_amount+term_2_amount+term_3_amount+annual_other_amount
  ) THEN RAISE EXCEPTION 'Every annual total must reconcile to its term amounts'; END IF;

  next_active := p_to_status='active';
  UPDATE public.budgets SET
    status=p_to_status, is_active=next_active, workflow_note=p_note,
    submitted_by=CASE WHEN p_to_status='submitted' THEN auth.uid() ELSE submitted_by END,
    submitted_at=CASE WHEN p_to_status='submitted' THEN now() ELSE submitted_at END,
    reviewed_by=CASE WHEN p_to_status='reviewed' THEN auth.uid() ELSE reviewed_by END,
    reviewed_at=CASE WHEN p_to_status='reviewed' THEN now() ELSE reviewed_at END,
    approved_by=CASE WHEN p_to_status='approved' THEN auth.uid() ELSE approved_by END,
    approved_at=CASE WHEN p_to_status='approved' THEN now() ELSE approved_at END,
    activated_by=CASE WHEN p_to_status='active' THEN auth.uid() ELSE activated_by END,
    activated_at=CASE WHEN p_to_status='active' THEN now() ELSE activated_at END,
    closed_by=CASE WHEN p_to_status='closed' THEN auth.uid() ELSE closed_by END,
    closed_at=CASE WHEN p_to_status='closed' THEN now() ELSE closed_at END
  WHERE id=b.id;

  INSERT INTO public.budget_workflow_history(organization_id,budget_id,from_status,to_status,note,acted_by)
  VALUES(oid,b.id,b.status,p_to_status,p_note,auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.change_budget_status(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_budget_status(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_approved_budget_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM public.budgets WHERE id=COALESCE(NEW.budget_id,OLD.budget_id);
  IF s IN ('approved','active','revised','closed') THEN
    RAISE EXCEPTION 'Approved budget lines are immutable; create a revision instead';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS trg_guard_approved_budget_lines ON public.budget_lines;
CREATE TRIGGER trg_guard_approved_budget_lines
BEFORE INSERT OR UPDATE OR DELETE ON public.budget_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_approved_budget_changes();

CREATE OR REPLACE FUNCTION public.create_budget_revision(p_budget_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old_b public.budgets%ROWTYPE; new_id uuid; oid uuid;
BEGIN
  SELECT organization_id INTO oid FROM public.staff WHERE id=auth.uid();
  SELECT * INTO old_b FROM public.budgets WHERE id=p_budget_id AND organization_id=oid AND status IN ('approved','active') FOR UPDATE;
  IF old_b.id IS NULL THEN RAISE EXCEPTION 'Only an approved or active budget can be revised'; END IF;
  INSERT INTO public.budgets(organization_id,name,period_label,start_date,end_date,notes,is_active,financial_year,period_mode,status,version_no,parent_budget_id,workflow_note)
  VALUES(old_b.organization_id,old_b.name,old_b.period_label,old_b.start_date,old_b.end_date,old_b.notes,false,old_b.financial_year,old_b.period_mode,'draft',old_b.version_no+1,old_b.id,p_reason)
  RETURNING id INTO new_id;
  INSERT INTO public.budget_lines(budget_id,gl_account_id,line_label,amount,sort_order,notes,unit,frequency,quantity,unit_price,department_id,budget_type,term_1_amount,term_2_amount,term_3_amount,annual_other_amount,responsible_staff_id,assumptions)
  SELECT new_id,gl_account_id,line_label,amount,sort_order,notes,unit,frequency,quantity,unit_price,department_id,budget_type,term_1_amount,term_2_amount,term_3_amount,annual_other_amount,responsible_staff_id,assumptions
  FROM public.budget_lines WHERE budget_id=old_b.id;
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.create_budget_revision(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_budget_revision(uuid,text) TO authenticated;
