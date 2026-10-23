-- Controlled SACCO end-of-day engine. Runs are idempotent and auditable; they do
-- not close a period or post irreversible journals without a separate approval.
CREATE TABLE IF NOT EXISTS public.sacco_processing_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  processing_date date NOT NULL, run_type text NOT NULL DEFAULT 'end_of_day' CHECK(run_type IN('end_of_day','month_end')),
  status text NOT NULL DEFAULT 'running' CHECK(status IN('running','completed','failed')),
  results jsonb NOT NULL DEFAULT '{}'::jsonb, started_by uuid REFERENCES public.staff(id), started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, failure_reason text,
  UNIQUE(organization_id,processing_date,run_type)
);
ALTER TABLE public.sacco_processing_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY sacco_processing_runs_org ON public.sacco_processing_runs FOR SELECT TO authenticated USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT ON public.sacco_processing_runs TO authenticated;

ALTER TABLE public.sacco_loan_products
  ADD COLUMN IF NOT EXISTS arrears_penalty_rate numeric NOT NULL DEFAULT 0 CHECK(arrears_penalty_rate>=0),
  ADD COLUMN IF NOT EXISTS penalty_grace_days integer NOT NULL DEFAULT 0 CHECK(penalty_grace_days>=0),
  ADD COLUMN IF NOT EXISTS interest_day_count_basis integer NOT NULL DEFAULT 365 CHECK(interest_day_count_basis IN(360,365));
CREATE TABLE IF NOT EXISTS public.sacco_loan_daily_accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  loan_id uuid NOT NULL REFERENCES public.sacco_loans(id) ON DELETE CASCADE, accrual_date date NOT NULL,
  interest_amount numeric NOT NULL DEFAULT 0, penalty_amount numeric NOT NULL DEFAULT 0, days_in_arrears integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(loan_id,accrual_date)
);
ALTER TABLE public.sacco_loan_daily_accruals ENABLE ROW LEVEL SECURITY;
CREATE POLICY sacco_loan_daily_accruals_org ON public.sacco_loan_daily_accruals FOR SELECT TO authenticated USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT ON public.sacco_loan_daily_accruals TO authenticated;

CREATE OR REPLACE FUNCTION public.accrue_sacco_loan_interest_and_penalties(p_as_at date DEFAULT current_date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_staff public.staff%ROWTYPE; v_loan record; v_interest numeric; v_penalty numeric; v_late integer; v_count integer:=0; v_penalty_count integer:=0;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE id=auth.uid();
  IF NOT FOUND OR lower(coalesce(v_staff.role,'')) NOT IN('accountant','manager','admin','super_admin') THEN RAISE EXCEPTION 'Only authorized finance staff can run loan accruals'; END IF;
  FOR v_loan IN SELECT l.*,coalesce(p.arrears_penalty_rate,0) penalty_rate,coalesce(p.penalty_grace_days,0) grace_days,coalesce(p.interest_day_count_basis,365) basis FROM public.sacco_loans l LEFT JOIN public.sacco_loan_products p ON p.name=l.loan_type AND p.organization_id=l.organization_id WHERE l.organization_id=v_staff.organization_id AND l.status IN('disbursed','defaulted') FOR UPDATE OF l LOOP
    v_late:=greatest(0,p_as_at-coalesce(v_loan.last_payment_date,v_loan.disbursement_date,p_as_at));
    v_interest:=round(v_loan.balance*v_loan.interest_rate/100/v_loan.basis,2);
    v_penalty:=CASE WHEN v_late>v_loan.grace_days THEN round(v_loan.balance*v_loan.penalty_rate/100,2) ELSE 0 END;
    INSERT INTO public.sacco_loan_daily_accruals(organization_id,loan_id,accrual_date,interest_amount,penalty_amount,days_in_arrears,created_by) VALUES(v_loan.organization_id,v_loan.id,p_as_at,v_interest,v_penalty,v_late,auth.uid()) ON CONFLICT(loan_id,accrual_date) DO NOTHING;
    IF FOUND THEN v_count:=v_count+1; IF v_penalty>0 THEN v_penalty_count:=v_penalty_count+1; END IF; END IF;
  END LOOP;
  RETURN jsonb_build_object('loan_accruals_created',v_count,'penalty_accruals_created',v_penalty_count);
END $$;
REVOKE ALL ON FUNCTION public.accrue_sacco_loan_interest_and_penalties(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accrue_sacco_loan_interest_and_penalties(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.snapshot_sacco_monthly_provision(p_reporting_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_staff public.staff%ROWTYPE; v_settings public.sacco_provisioning_settings%ROWTYPE; v_month date:=date_trunc('month',p_reporting_date)::date;
v_principal numeric:=0; v_interest numeric:=0; v_arrears numeric:=0; v_par1 numeric:=0; v_par30 numeric:=0; v_specific numeric:=0; v_general_base numeric:=0; v_general numeric:=0; v_id uuid;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE id=auth.uid(); IF NOT FOUND THEN RAISE EXCEPTION 'Staff authorization required'; END IF;
  SELECT * INTO v_settings FROM public.sacco_provisioning_settings WHERE organization_id=v_staff.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configure loan provisioning before creating a snapshot'; END IF;
  SELECT coalesce(sum(l.balance),0),coalesce(sum(l.balance*l.interest_rate/100/12),0),
    coalesce(sum(l.balance) FILTER(WHERE p_reporting_date-coalesce(l.last_payment_date,l.disbursement_date)>0),0),
    coalesce(sum(l.balance) FILTER(WHERE p_reporting_date-coalesce(l.last_payment_date,l.disbursement_date)>0),0),
    coalesce(sum(l.balance) FILTER(WHERE p_reporting_date-coalesce(l.last_payment_date,l.disbursement_date)>=30),0),
    coalesce(sum(l.balance * coalesce((SELECT CASE WHEN v_settings.provision_choice='new' THEN (r->>'newRate')::numeric ELSE (r->>'oldRate')::numeric END FROM jsonb_array_elements(v_settings.rates) r WHERE p_reporting_date-coalesce(l.last_payment_date,l.disbursement_date) BETWEEN coalesce((r->>'daysFrom')::int,0) AND coalesce((r->>'daysTo')::int,999999) ORDER BY (r->>'daysFrom')::int DESC LIMIT 1),0)/100) FILTER(WHERE p_reporting_date-coalesce(l.last_payment_date,l.disbursement_date)>0),0),
    coalesce(sum(l.balance) FILTER(WHERE p_reporting_date-coalesce(l.last_payment_date,l.disbursement_date)<=0),0)
  INTO v_principal,v_interest,v_arrears,v_par1,v_par30,v_specific,v_general_base
  FROM public.sacco_loans l WHERE l.organization_id=v_staff.organization_id AND l.status IN('disbursed','defaulted');
  v_general:=round(v_general_base*(CASE WHEN v_settings.provision_choice='new' THEN v_settings.general_provision_new ELSE v_settings.general_provision_old END)/100,2);
  INSERT INTO public.sacco_monthly_provision_snapshots(organization_id,reporting_month,interest_receivable,interest_unreceived,principal_outstanding,total_outstanding,amount_in_arrears,par_1_percent,par_30_percent,specific_provision,general_provision,monthly_provision,total_provision,policy_snapshot,created_by)
  VALUES(v_staff.organization_id,v_month,v_interest,v_interest,v_principal,v_principal+v_interest,v_arrears,CASE WHEN v_principal=0 THEN 0 ELSE v_par1/v_principal*100 END,CASE WHEN v_principal=0 THEN 0 ELSE v_par30/v_principal*100 END,v_specific,v_general,v_specific+v_general,v_specific+v_general,jsonb_build_object('choice',v_settings.provision_choice,'rates',v_settings.rates,'as_at',p_reporting_date),auth.uid())
  ON CONFLICT(organization_id,reporting_month) DO UPDATE SET interest_receivable=EXCLUDED.interest_receivable,interest_unreceived=EXCLUDED.interest_unreceived,principal_outstanding=EXCLUDED.principal_outstanding,total_outstanding=EXCLUDED.total_outstanding,amount_in_arrears=EXCLUDED.amount_in_arrears,par_1_percent=EXCLUDED.par_1_percent,par_30_percent=EXCLUDED.par_30_percent,specific_provision=EXCLUDED.specific_provision,general_provision=EXCLUDED.general_provision,monthly_provision=EXCLUDED.monthly_provision,total_provision=EXCLUDED.total_provision,policy_snapshot=EXCLUDED.policy_snapshot,created_by=EXCLUDED.created_by,created_at=now() WHERE sacco_monthly_provision_snapshots.journal_entry_id IS NULL RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'The month provision is already posted and cannot be regenerated'; END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.run_sacco_end_of_day(p_processing_date date DEFAULT current_date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_staff public.staff%ROWTYPE; v_run public.sacco_processing_runs%ROWTYPE; v_accruals integer:=0; v_loan_accruals jsonb:='{}'::jsonb; v_portfolio uuid; v_provision uuid; v_cases integer:=0; v_maturing integer:=0;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE id=auth.uid();
  IF NOT FOUND OR lower(coalesce(v_staff.role,'')) NOT IN('accountant','manager','admin','super_admin') THEN RAISE EXCEPTION 'Only authorized finance staff can run end-of-day'; END IF;
  IF p_processing_date IS NULL OR p_processing_date>current_date THEN RAISE EXCEPTION 'Processing date cannot be in the future'; END IF;
  INSERT INTO public.sacco_processing_runs(organization_id,processing_date,run_type,status,started_by) VALUES(v_staff.organization_id,p_processing_date,'end_of_day','running',auth.uid()) ON CONFLICT(organization_id,processing_date,run_type) DO NOTHING RETURNING * INTO v_run;
  IF v_run.id IS NULL THEN SELECT * INTO v_run FROM public.sacco_processing_runs WHERE organization_id=v_staff.organization_id AND processing_date=p_processing_date AND run_type='end_of_day'; IF v_run.status='completed' THEN RETURN v_run.id; END IF; RAISE EXCEPTION 'This processing date is already running or failed; review the run before retrying'; END IF;
  BEGIN
    v_accruals:=public.accrue_sacco_fixed_deposit_interest(p_processing_date);
    v_loan_accruals:=public.accrue_sacco_loan_interest_and_penalties(p_processing_date);
    v_portfolio:=public.snapshot_sacco_loan_portfolio(p_processing_date);
    v_provision:=public.snapshot_sacco_monthly_provision(p_processing_date);
    INSERT INTO public.sacco_collection_cases(organization_id,loan_id,status,priority,next_action_date,notes)
    SELECT v_staff.organization_id,l.id,'open',CASE WHEN p_processing_date-coalesce(l.last_payment_date,l.disbursement_date)>=90 THEN 'critical' WHEN p_processing_date-coalesce(l.last_payment_date,l.disbursement_date)>=30 THEN 'high' ELSE 'normal' END,p_processing_date+1,'Opened automatically by end-of-day arrears aging'
    FROM public.sacco_loans l WHERE l.organization_id=v_staff.organization_id AND l.status IN('disbursed','defaulted') AND p_processing_date-coalesce(l.last_payment_date,l.disbursement_date)>=1 AND NOT EXISTS(SELECT 1 FROM public.sacco_collection_cases c WHERE c.organization_id=l.organization_id AND c.loan_id=l.id AND c.status IN('open','promise_to_pay','restructured'));
    GET DIAGNOSTICS v_cases=ROW_COUNT;
    SELECT count(*) INTO v_maturing FROM public.sacco_fixed_deposits WHERE organization_id=v_staff.organization_id AND status='active' AND maturity_date<=p_processing_date+30;
    UPDATE public.sacco_processing_runs SET status='completed',completed_at=now(),results=jsonb_build_object('fixed_deposit_accruals',v_accruals,'loan_accruals',v_loan_accruals,'portfolio_snapshot_id',v_portfolio,'provision_snapshot_id',v_provision,'collection_cases_opened',v_cases,'fixed_deposits_maturing_within_30_days',v_maturing) WHERE id=v_run.id;
    PERFORM public.record_financial_event('sacco_end_of_day_completed',p_processing_date,'sacco_processing_runs',v_run.id,NULL,(SELECT results FROM public.sacco_processing_runs WHERE id=v_run.id));
  EXCEPTION WHEN OTHERS THEN UPDATE public.sacco_processing_runs SET status='failed',completed_at=now(),failure_reason=SQLERRM WHERE id=v_run.id; RAISE; END;
  RETURN v_run.id;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_sacco_monthly_provision(date),public.run_sacco_end_of_day(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.snapshot_sacco_monthly_provision(date),public.run_sacco_end_of_day(date) TO authenticated;
