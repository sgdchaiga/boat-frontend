-- One-level budget sub-lines with automatic roll-up to their main budget line.

ALTER TABLE public.budget_lines
  ADD COLUMN IF NOT EXISTS parent_line_id uuid REFERENCES public.budget_lines(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_budget_lines_parent
  ON public.budget_lines(parent_line_id) WHERE parent_line_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_budget_sub_line()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_budget uuid; grandparent uuid;
BEGIN
  IF NEW.parent_line_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_line_id = NEW.id THEN RAISE EXCEPTION 'A budget line cannot be its own parent'; END IF;
  SELECT budget_id,parent_line_id INTO parent_budget,grandparent
  FROM public.budget_lines WHERE id=NEW.parent_line_id;
  IF parent_budget IS NULL OR parent_budget <> NEW.budget_id THEN
    RAISE EXCEPTION 'A sub-line must belong to a main line in the same budget';
  END IF;
  IF grandparent IS NOT NULL THEN RAISE EXCEPTION 'Budget sub-lines can only be one level deep'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_budget_sub_line ON public.budget_lines;
CREATE TRIGGER trg_validate_budget_sub_line
BEFORE INSERT OR UPDATE OF parent_line_id,budget_id ON public.budget_lines
FOR EACH ROW EXECUTE FUNCTION public.validate_budget_sub_line();

CREATE OR REPLACE FUNCTION public.roll_up_budget_parent(p_parent_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_parent_id IS NULL THEN RETURN; END IF;
  UPDATE public.budget_lines parent SET
    term_1_amount=totals.term_1,
    term_2_amount=totals.term_2,
    term_3_amount=totals.term_3,
    annual_other_amount=totals.other_amount,
    amount=totals.term_1+totals.term_2+totals.term_3+totals.other_amount
  FROM (
    SELECT COALESCE(sum(term_1_amount),0) term_1,
      COALESCE(sum(term_2_amount),0) term_2,
      COALESCE(sum(term_3_amount),0) term_3,
      COALESCE(sum(annual_other_amount),0) other_amount
    FROM public.budget_lines WHERE parent_line_id=p_parent_id
  ) totals
  WHERE parent.id=p_parent_id;
END $$;

CREATE OR REPLACE FUNCTION public.roll_up_budget_sub_lines()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM public.roll_up_budget_parent(OLD.parent_line_id);
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.parent_line_id IS DISTINCT FROM NEW.parent_line_id THEN
    PERFORM public.roll_up_budget_parent(OLD.parent_line_id);
  END IF;
  PERFORM public.roll_up_budget_parent(NEW.parent_line_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_roll_up_budget_sub_lines ON public.budget_lines;
CREATE TRIGGER trg_roll_up_budget_sub_lines
AFTER INSERT OR UPDATE OF parent_line_id,term_1_amount,term_2_amount,term_3_amount,annual_other_amount OR DELETE
ON public.budget_lines FOR EACH ROW EXECUTE FUNCTION public.roll_up_budget_sub_lines();

CREATE OR REPLACE FUNCTION public.create_budget_revision(p_budget_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old_b public.budgets%ROWTYPE; new_id uuid; oid uuid; source_parent record; new_parent_id uuid;
BEGIN
  IF NOT public.has_budget_permission('budget_approve') THEN RAISE EXCEPTION 'You do not have permission to revise budgets'; END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A revision reason is required'; END IF;
  SELECT organization_id INTO oid FROM public.staff WHERE id=auth.uid();
  SELECT * INTO old_b FROM public.budgets WHERE id=p_budget_id AND organization_id=oid AND status IN('approved','active') FOR UPDATE;
  IF old_b.id IS NULL THEN RAISE EXCEPTION 'Only an approved or active budget can be revised'; END IF;
  INSERT INTO public.budgets(organization_id,name,period_label,start_date,end_date,notes,is_active,financial_year,period_mode,status,version_no,parent_budget_id,workflow_note)
  VALUES(old_b.organization_id,old_b.name,old_b.period_label,old_b.start_date,old_b.end_date,old_b.notes,false,old_b.financial_year,old_b.period_mode,'draft',old_b.version_no+1,old_b.id,trim(p_reason)) RETURNING id INTO new_id;

  FOR source_parent IN SELECT * FROM public.budget_lines WHERE budget_id=old_b.id AND parent_line_id IS NULL ORDER BY sort_order,id LOOP
    INSERT INTO public.budget_lines(budget_id,gl_account_id,line_label,amount,sort_order,notes,unit,frequency,quantity,unit_price,department_id,budget_type,term_1_amount,term_2_amount,term_3_amount,annual_other_amount,responsible_staff_id,assumptions)
    VALUES(new_id,source_parent.gl_account_id,source_parent.line_label,source_parent.amount,source_parent.sort_order,source_parent.notes,source_parent.unit,source_parent.frequency,source_parent.quantity,source_parent.unit_price,source_parent.department_id,source_parent.budget_type,source_parent.term_1_amount,source_parent.term_2_amount,source_parent.term_3_amount,source_parent.annual_other_amount,source_parent.responsible_staff_id,source_parent.assumptions)
    RETURNING id INTO new_parent_id;
    INSERT INTO public.budget_lines(budget_id,parent_line_id,gl_account_id,line_label,amount,sort_order,notes,unit,frequency,quantity,unit_price,department_id,budget_type,term_1_amount,term_2_amount,term_3_amount,annual_other_amount,responsible_staff_id,assumptions)
    SELECT new_id,new_parent_id,gl_account_id,line_label,amount,sort_order,notes,unit,frequency,quantity,unit_price,department_id,budget_type,term_1_amount,term_2_amount,term_3_amount,annual_other_amount,responsible_staff_id,assumptions
    FROM public.budget_lines WHERE parent_line_id=source_parent.id ORDER BY sort_order,id;
  END LOOP;

  INSERT INTO public.budget_workflow_history(organization_id,budget_id,from_status,to_status,note,acted_by)
    VALUES(oid,new_id,NULL,'draft','Revision created: '||trim(p_reason),auth.uid());
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.create_budget_revision(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_budget_revision(uuid,text) TO authenticated;

COMMENT ON COLUMN public.budget_lines.parent_line_id IS 'Optional main budget line; direct sub-lines roll up their term amounts into it.';
