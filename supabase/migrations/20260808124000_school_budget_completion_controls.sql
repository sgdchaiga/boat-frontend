-- Completion controls: atomic historical imports and auditable rollout sign-off.
CREATE TABLE IF NOT EXISTS public.budget_rollout_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  check_key text NOT NULL, completed boolean NOT NULL DEFAULT false, evidence text, completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,check_key)
);
ALTER TABLE public.budget_rollout_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY budget_rollout_checks_org ON public.budget_rollout_checks FOR ALL TO authenticated
USING (organization_id=(SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid()))
WITH CHECK (organization_id=(SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid()));
GRANT SELECT,INSERT,UPDATE ON public.budget_rollout_checks TO authenticated;

CREATE TABLE IF NOT EXISTS public.budget_review_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  day_of_month integer NOT NULL DEFAULT 5 CHECK(day_of_month BETWEEN 1 AND 28), assigned_role text NOT NULL DEFAULT 'bursar',
  next_review_date date NOT NULL DEFAULT (date_trunc('month',CURRENT_DATE)+interval '1 month 4 days')::date,
  backup_method text NOT NULL DEFAULT 'supabase_managed', backup_verified_at timestamptz, updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.budget_review_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY budget_review_settings_org ON public.budget_review_settings FOR ALL TO authenticated
USING (organization_id=(SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid()))
WITH CHECK (organization_id=(SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid()));
GRANT SELECT,INSERT,UPDATE ON public.budget_review_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.import_historical_school_budget(p_name text,p_financial_year integer,p_start_date date,p_end_date date,p_lines jsonb,p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE oid uuid; bid uuid; row jsonb;
BEGIN
  SELECT organization_id INTO oid FROM public.staff WHERE id=auth.uid();
  IF oid IS NULL OR NOT public.has_budget_permission('budget_prepare') THEN RAISE EXCEPTION 'You do not have permission to import budgets'; END IF;
  IF trim(COALESCE(p_name,''))='' OR p_financial_year NOT BETWEEN 2000 AND 2200 OR p_end_date<p_start_date THEN RAISE EXCEPTION 'Enter valid budget details'; END IF;
  IF jsonb_array_length(COALESCE(p_lines,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'The import contains no budget lines'; END IF;
  INSERT INTO public.budgets(organization_id,name,period_label,start_date,end_date,notes,financial_year,period_mode,status,version_no,is_active)
  VALUES(oid,trim(p_name),'FY '||p_financial_year,p_start_date,p_end_date,COALESCE(p_notes,'Historical import awaiting reconciliation and approval'),p_financial_year,'annual','draft',1,false) RETURNING id INTO bid;
  FOR row IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.budget_lines(budget_id,line_label,budget_type,term_1_amount,term_2_amount,term_3_amount,annual_other_amount,amount,sort_order,assumptions)
    VALUES(bid,trim(row->>'line_label'),COALESCE(NULLIF(row->>'budget_type',''),'operating_expense'),COALESCE((row->>'term_1')::numeric,0),COALESCE((row->>'term_2')::numeric,0),COALESCE((row->>'term_3')::numeric,0),COALESCE((row->>'annual_other')::numeric,0),COALESCE((row->>'term_1')::numeric,0)+COALESCE((row->>'term_2')::numeric,0)+COALESCE((row->>'term_3')::numeric,0)+COALESCE((row->>'annual_other')::numeric,0),COALESCE((row->>'sort_order')::integer,0),row->>'assumptions');
  END LOOP;
  INSERT INTO public.budget_workflow_history(organization_id,budget_id,to_status,note,acted_by) VALUES(oid,bid,'draft','Historical budget imported; reconciliation and approval required.',auth.uid());
  RETURN bid;
END $$;
REVOKE ALL ON FUNCTION public.import_historical_school_budget(text,integer,date,date,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_historical_school_budget(text,integer,date,date,jsonb,text) TO authenticated;
