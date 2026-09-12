-- Super Admin may perform every budget approval step on their own submission.
-- Keep organization scope, valid transitions, reconciliations and audit history intact.
BEGIN;
CREATE OR REPLACE FUNCTION public.has_budget_permission(p_permission text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.staff%ROWTYPE; override_value boolean; role_value boolean;
BEGIN
  IF public.is_platform_admin() THEN RETURN true; END IF;
  SELECT * INTO s FROM public.staff WHERE id=auth.uid();
  IF s.id IS NULL THEN RETURN false; END IF;
  IF lower(COALESCE(s.role,''))='super_admin' THEN RETURN true; END IF;
  SELECT allowed INTO override_value FROM public.staff_permission_overrides
    WHERE organization_id=s.organization_id AND staff_id=s.id AND permission_key=p_permission;
  IF override_value IS NOT NULL THEN RETURN override_value; END IF;
  SELECT allowed INTO role_value FROM public.organization_permissions
    WHERE organization_id=s.organization_id AND role_key=lower(COALESCE(s.role,'')) AND permission_key=p_permission;
  IF role_value IS NOT NULL THEN RETURN role_value; END IF;
  RETURN CASE
    WHEN p_permission='budget_prepare' THEN lower(COALESCE(s.role,'')) IN ('admin','manager','accountant','bursar','department_head')
    WHEN p_permission='budget_review' THEN lower(COALESCE(s.role,'')) IN ('admin','manager','accountant','bursar','headteacher')
    WHEN p_permission='budget_approve' THEN lower(COALESCE(s.role,'')) IN ('admin','manager','headteacher','director')
    ELSE false END;
END $$;

CREATE OR REPLACE FUNCTION public.change_budget_status(p_budget_id uuid, p_to_status text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b public.budgets%ROWTYPE; oid uuid; required_permission text; actor_is_super_admin boolean;
BEGIN
  SELECT organization_id INTO oid FROM public.staff WHERE id=auth.uid();
  actor_is_super_admin := public.is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.staff WHERE id=auth.uid() AND lower(COALESCE(role,''))='super_admin'
  );
  SELECT * INTO b FROM public.budgets WHERE id=p_budget_id AND organization_id=oid FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Budget not found'; END IF;
  required_permission := CASE
    WHEN p_to_status IN ('submitted','draft') THEN 'budget_prepare'
    WHEN p_to_status='reviewed' THEN 'budget_review'
    WHEN p_to_status IN ('approved','active','revised','closed') THEN 'budget_approve'
  END;
  IF required_permission IS NULL OR NOT public.has_budget_permission(required_permission) THEN
    RAISE EXCEPTION 'You do not have permission to move this budget to %', p_to_status;
  END IF;
  IF NOT (
    (b.status='draft' AND p_to_status='submitted') OR
    (b.status='submitted' AND p_to_status IN ('draft','reviewed')) OR
    (b.status='reviewed' AND p_to_status IN ('draft','approved')) OR
    (b.status='approved' AND p_to_status='active') OR
    (b.status='active' AND p_to_status IN ('revised','closed')) OR
    (b.status='revised' AND p_to_status='closed')
  ) THEN RAISE EXCEPTION 'Transition from % to % is not allowed',b.status,p_to_status; END IF;
  IF p_to_status IN ('reviewed','approved') AND b.submitted_by=auth.uid() AND NOT actor_is_super_admin THEN
    RAISE EXCEPTION 'You cannot review or approve your own budget submission';
  END IF;
  IF p_to_status='submitted' AND NOT EXISTS(SELECT 1 FROM public.budget_lines WHERE budget_id=b.id) THEN
    RAISE EXCEPTION 'Add at least one budget line before submission'; END IF;
  IF p_to_status='submitted' AND EXISTS(SELECT 1 FROM public.budget_lines WHERE budget_id=b.id
    AND amount<>term_1_amount+term_2_amount+term_3_amount+annual_other_amount) THEN
    RAISE EXCEPTION 'Every annual total must reconcile to its term amounts'; END IF;
  UPDATE public.budgets SET status=p_to_status,is_active=(p_to_status='active'),workflow_note=p_note,
    submitted_by=CASE WHEN p_to_status='submitted' THEN auth.uid() ELSE submitted_by END,
    submitted_at=CASE WHEN p_to_status='submitted' THEN now() ELSE submitted_at END,
    reviewed_by=CASE WHEN p_to_status='reviewed' THEN auth.uid() ELSE reviewed_by END,
    reviewed_at=CASE WHEN p_to_status='reviewed' THEN now() ELSE reviewed_at END,
    approved_by=CASE WHEN p_to_status='approved' THEN auth.uid() ELSE approved_by END,
    approved_at=CASE WHEN p_to_status='approved' THEN now() ELSE approved_at END,
    activated_by=CASE WHEN p_to_status='active' THEN auth.uid() ELSE activated_by END,
    activated_at=CASE WHEN p_to_status='active' THEN now() ELSE activated_at END,
    closed_by=CASE WHEN p_to_status='closed' THEN auth.uid() ELSE closed_by END,
    closed_at=CASE WHEN p_to_status='closed' THEN now() ELSE closed_at END WHERE id=b.id;
  INSERT INTO public.budget_workflow_history(organization_id,budget_id,from_status,to_status,note,acted_by)
    VALUES(oid,b.id,b.status,p_to_status,p_note,auth.uid());
END $$;

COMMIT;
