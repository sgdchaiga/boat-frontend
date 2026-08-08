-- Phase 1 hardening: explicit budget workflow permissions and school defaults.

WITH school_departments(name) AS (
  VALUES ('Administration'),('Academics'),('Boarding'),('Kitchen and feeding'),
    ('Transport'),('Maintenance'),('ICT'),('Library'),('Laboratory'),
    ('Sports and co-curricular activities'),('Health and welfare'),('Security'),
    ('Finance'),('Admissions and marketing')
)
INSERT INTO public.departments(organization_id,name)
SELECT o.id,d.name FROM public.organizations o CROSS JOIN school_departments d
WHERE lower(COALESCE(o.business_type,''))='school'
  AND NOT EXISTS (SELECT 1 FROM public.departments existing
    WHERE existing.organization_id=o.id AND lower(existing.name)=lower(d.name));

WITH roles(role_key) AS (VALUES ('admin'),('manager'),('accountant'),('headteacher'),('bursar'),('director'),('department_head')),
permissions(permission_key) AS (VALUES ('budget_prepare'),('budget_review'),('budget_approve'))
INSERT INTO public.organization_permissions(organization_id,role_key,permission_key,allowed)
SELECT o.id,r.role_key,p.permission_key,
  CASE
    WHEN p.permission_key='budget_prepare' THEN r.role_key IN ('admin','manager','accountant','bursar','department_head')
    WHEN p.permission_key='budget_review' THEN r.role_key IN ('admin','manager','accountant','bursar','headteacher')
    WHEN p.permission_key='budget_approve' THEN r.role_key IN ('admin','manager','headteacher','director')
    ELSE false
  END
FROM public.organizations o CROSS JOIN roles r CROSS JOIN permissions p
ON CONFLICT(organization_id,role_key,permission_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.has_budget_permission(p_permission text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.staff%ROWTYPE; override_value boolean; role_value boolean;
BEGIN
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

CREATE OR REPLACE FUNCTION public.create_budget_revision(p_budget_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old_b public.budgets%ROWTYPE; new_id uuid; oid uuid;
BEGIN
  IF NOT public.has_budget_permission('budget_approve') THEN RAISE EXCEPTION 'You do not have permission to revise budgets'; END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A revision reason is required'; END IF;
  SELECT organization_id INTO oid FROM public.staff WHERE id=auth.uid();
  SELECT * INTO old_b FROM public.budgets WHERE id=p_budget_id AND organization_id=oid AND status IN('approved','active') FOR UPDATE;
  IF old_b.id IS NULL THEN RAISE EXCEPTION 'Only an approved or active budget can be revised'; END IF;
  INSERT INTO public.budgets(organization_id,name,period_label,start_date,end_date,notes,is_active,financial_year,period_mode,status,version_no,parent_budget_id,workflow_note)
  VALUES(old_b.organization_id,old_b.name,old_b.period_label,old_b.start_date,old_b.end_date,old_b.notes,false,old_b.financial_year,old_b.period_mode,'draft',old_b.version_no+1,old_b.id,trim(p_reason)) RETURNING id INTO new_id;
  INSERT INTO public.budget_lines(budget_id,gl_account_id,line_label,amount,sort_order,notes,unit,frequency,quantity,unit_price,department_id,budget_type,term_1_amount,term_2_amount,term_3_amount,annual_other_amount,responsible_staff_id,assumptions)
  SELECT new_id,gl_account_id,line_label,amount,sort_order,notes,unit,frequency,quantity,unit_price,department_id,budget_type,term_1_amount,term_2_amount,term_3_amount,annual_other_amount,responsible_staff_id,assumptions FROM public.budget_lines WHERE budget_id=old_b.id;
  INSERT INTO public.budget_workflow_history(organization_id,budget_id,from_status,to_status,note,acted_by)
    VALUES(oid,new_id,NULL,'draft','Revision created: '||trim(p_reason),auth.uid());
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.create_budget_revision(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_budget_revision(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.has_budget_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_budget_permission(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.change_budget_status(p_budget_id uuid, p_to_status text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b public.budgets%ROWTYPE; oid uuid; required_permission text;
BEGIN
  SELECT organization_id INTO oid FROM public.staff WHERE id=auth.uid();
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
  IF p_to_status IN ('reviewed','approved') AND b.submitted_by=auth.uid() THEN
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
