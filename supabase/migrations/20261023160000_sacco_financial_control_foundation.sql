-- Releases 1-3: immutable financial events, fixed-deposit accrual snapshots,
-- and collection / portfolio month-end snapshots.  All additions are additive.

CREATE TABLE IF NOT EXISTS public.financial_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  effective_date date NOT NULL DEFAULT current_date,
  source_table text NOT NULL,
  source_id uuid,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  occurred_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  UNIQUE (organization_id, event_type, source_table, source_id)
);
CREATE INDEX IF NOT EXISTS idx_financial_events_org_date ON public.financial_events (organization_id, effective_date DESC);
ALTER TABLE public.financial_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_events_read_same_org ON public.financial_events FOR SELECT TO authenticated
  USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.financial_events FROM authenticated;
GRANT SELECT ON public.financial_events TO authenticated;

CREATE OR REPLACE FUNCTION public.record_financial_event(
  p_event_type text, p_effective_date date, p_source_table text, p_source_id uuid,
  p_journal_entry_id uuid DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_staff public.staff%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff authorization required'; END IF;
  INSERT INTO public.financial_events(organization_id,event_type,effective_date,source_table,source_id,journal_entry_id,payload,occurred_by)
  VALUES(v_staff.organization_id,trim(p_event_type),coalesce(p_effective_date,current_date),trim(p_source_table),p_source_id,p_journal_entry_id,coalesce(p_payload,'{}'::jsonb),auth.uid())
  ON CONFLICT (organization_id,event_type,source_table,source_id) DO UPDATE
    SET journal_entry_id=coalesce(EXCLUDED.journal_entry_id,financial_events.journal_entry_id), payload=financial_events.payload || EXCLUDED.payload
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.record_financial_event(text,date,text,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_financial_event(text,date,text,uuid,uuid,jsonb) TO authenticated;

ALTER TABLE public.sacco_fixed_deposits
  ADD COLUMN IF NOT EXISTS accrued_interest numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_interest_accrual_date date;

CREATE TABLE IF NOT EXISTS public.sacco_fixed_deposit_accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fixed_deposit_id uuid NOT NULL REFERENCES public.sacco_fixed_deposits(id) ON DELETE CASCADE,
  accrual_date date NOT NULL, days_accrued integer NOT NULL CHECK(days_accrued >= 0), gross_interest numeric NOT NULL,
  withholding_tax numeric NOT NULL DEFAULT 0, net_interest numeric NOT NULL, created_by uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(fixed_deposit_id, accrual_date)
);
CREATE INDEX IF NOT EXISTS idx_fd_accruals_org_date ON public.sacco_fixed_deposit_accruals(organization_id,accrual_date DESC);
ALTER TABLE public.sacco_fixed_deposit_accruals ENABLE ROW LEVEL SECURITY;
CREATE POLICY sacco_fd_accruals_same_org ON public.sacco_fixed_deposit_accruals FOR SELECT TO authenticated
  USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT ON public.sacco_fixed_deposit_accruals TO authenticated;

CREATE OR REPLACE FUNCTION public.accrue_sacco_fixed_deposit_interest(p_as_at date DEFAULT current_date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_staff public.staff%ROWTYPE; v_fd record; v_start date; v_end date; v_days integer; v_gross numeric; v_tax numeric; v_count integer:=0;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE id=auth.uid();
  IF NOT FOUND OR lower(coalesce(v_staff.role,'')) NOT IN ('accountant','manager','admin','super_admin') THEN RAISE EXCEPTION 'Only authorized finance staff can accrue fixed-deposit interest'; END IF;
  IF p_as_at IS NULL OR p_as_at > current_date THEN RAISE EXCEPTION 'Choose a completed or current reporting date'; END IF;
  FOR v_fd IN SELECT fd.*, coalesce(product.withholding_tax_rate,0) AS tax_rate, coalesce(product.day_count_basis,365) AS day_basis
    FROM public.sacco_fixed_deposits fd LEFT JOIN public.sacco_fixed_deposit_products product ON product.id=fd.product_id
    WHERE fd.organization_id=v_staff.organization_id AND fd.status='active' FOR UPDATE OF fd LOOP
    v_start:=greatest(v_fd.start_date,coalesce(v_fd.last_interest_accrual_date+1,v_fd.start_date)); v_end:=least(p_as_at,v_fd.maturity_date);
    v_days:=greatest(0,v_end-v_start+1); IF v_days=0 THEN CONTINUE; END IF;
    v_gross:=round(v_fd.amount*v_fd.interest_rate/100*v_days/v_fd.day_basis,2); v_tax:=round(v_gross*v_fd.tax_rate/100,2);
    INSERT INTO public.sacco_fixed_deposit_accruals(organization_id,fixed_deposit_id,accrual_date,days_accrued,gross_interest,withholding_tax,net_interest,created_by)
    VALUES(v_fd.organization_id,v_fd.id,v_end,v_days,v_gross,v_tax,v_gross-v_tax,auth.uid()) ON CONFLICT(fixed_deposit_id,accrual_date) DO NOTHING;
    IF FOUND THEN UPDATE public.sacco_fixed_deposits SET accrued_interest=accrued_interest+v_gross,last_interest_accrual_date=v_end WHERE id=v_fd.id; v_count:=v_count+1; END IF;
  END LOOP;
  PERFORM public.record_financial_event('fixed_deposit_interest_accrual',p_as_at,'sacco_fixed_deposit_accrual_batch',gen_random_uuid(),NULL,jsonb_build_object('accruals_created',v_count));
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.accrue_sacco_fixed_deposit_interest(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accrue_sacco_fixed_deposit_interest(date) TO authenticated;

CREATE TABLE IF NOT EXISTS public.sacco_collection_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  loan_id uuid NOT NULL REFERENCES public.sacco_loans(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'open' CHECK(status IN('open','promise_to_pay','restructured','closed','written_off')),
  priority text NOT NULL DEFAULT 'normal' CHECK(priority IN('low','normal','high','critical')), assigned_to uuid REFERENCES public.staff(id), next_action_date date,
  promise_amount numeric, promise_date date, notes text, opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, closed_by uuid REFERENCES public.staff(id),
  UNIQUE(organization_id,loan_id,status) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE TABLE IF NOT EXISTS public.sacco_loan_portfolio_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reporting_date date NOT NULL, principal_outstanding numeric NOT NULL DEFAULT 0, amount_in_arrears numeric NOT NULL DEFAULT 0,
  par_1_percent numeric NOT NULL DEFAULT 0, par_30_percent numeric NOT NULL DEFAULT 0, active_loans integer NOT NULL DEFAULT 0,
  delinquent_loans integer NOT NULL DEFAULT 0, policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, created_by uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,reporting_date)
);
ALTER TABLE public.sacco_collection_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_loan_portfolio_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY sacco_collection_cases_same_org ON public.sacco_collection_cases FOR ALL TO authenticated USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())) WITH CHECK(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY sacco_portfolio_snapshots_same_org ON public.sacco_loan_portfolio_snapshots FOR ALL TO authenticated USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())) WITH CHECK(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sacco_collection_cases,public.sacco_loan_portfolio_snapshots TO authenticated;

CREATE OR REPLACE FUNCTION public.snapshot_sacco_loan_portfolio(p_reporting_date date DEFAULT current_date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_staff public.staff%ROWTYPE; v_id uuid; v_principal numeric; v_arrears numeric; v_par1 numeric; v_par30 numeric; v_active integer; v_delinquent integer;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE id=auth.uid(); IF NOT FOUND THEN RAISE EXCEPTION 'Staff authorization required'; END IF;
  SELECT coalesce(sum(balance),0),coalesce(sum(balance) FILTER(WHERE p_reporting_date-coalesce(last_payment_date,disbursement_date)>0),0),coalesce(sum(balance) FILTER(WHERE p_reporting_date-coalesce(last_payment_date,disbursement_date)>0),0),coalesce(sum(balance) FILTER(WHERE p_reporting_date-coalesce(last_payment_date,disbursement_date)>=30),0),count(*) FILTER(WHERE status IN('disbursed','defaulted')),count(*) FILTER(WHERE status IN('disbursed','defaulted') AND p_reporting_date-coalesce(last_payment_date,disbursement_date)>0) INTO v_principal,v_arrears,v_par1,v_par30,v_active,v_delinquent FROM public.sacco_loans WHERE organization_id=v_staff.organization_id AND status IN('disbursed','defaulted');
  INSERT INTO public.sacco_loan_portfolio_snapshots(organization_id,reporting_date,principal_outstanding,amount_in_arrears,par_1_percent,par_30_percent,active_loans,delinquent_loans,created_by)
  VALUES(v_staff.organization_id,p_reporting_date,v_principal,v_arrears,CASE WHEN v_principal=0 THEN 0 ELSE v_par1/v_principal*100 END,CASE WHEN v_principal=0 THEN 0 ELSE v_par30/v_principal*100 END,v_active,v_delinquent,auth.uid())
  ON CONFLICT(organization_id,reporting_date) DO UPDATE SET principal_outstanding=EXCLUDED.principal_outstanding,amount_in_arrears=EXCLUDED.amount_in_arrears,par_1_percent=EXCLUDED.par_1_percent,par_30_percent=EXCLUDED.par_30_percent,active_loans=EXCLUDED.active_loans,delinquent_loans=EXCLUDED.delinquent_loans,created_by=EXCLUDED.created_by,created_at=now() RETURNING id INTO v_id;
  PERFORM public.record_financial_event('loan_portfolio_snapshot',p_reporting_date,'sacco_loan_portfolio_snapshots',v_id,NULL,jsonb_build_object('principal_outstanding',v_principal,'amount_in_arrears',v_arrears)); RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_sacco_loan_portfolio(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.snapshot_sacco_loan_portfolio(date) TO authenticated;

-- Every new journal becomes an immutable financial event automatically. This also
-- covers journals posted by existing workflows while they are progressively moved
-- to dedicated financial-event RPCs.
CREATE OR REPLACE FUNCTION public.capture_journal_financial_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.financial_events(organization_id,event_type,effective_date,source_table,source_id,journal_entry_id,payload,occurred_by)
  VALUES(NEW.organization_id,'journal_posted',NEW.entry_date,'journal_entries',NEW.id,NEW.id,jsonb_build_object('reference_type',NEW.reference_type,'reference_id',NEW.reference_id,'description',NEW.description),NEW.created_by)
  ON CONFLICT (organization_id,event_type,source_table,source_id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_capture_journal_financial_event ON public.journal_entries;
CREATE TRIGGER trg_capture_journal_financial_event AFTER INSERT ON public.journal_entries
FOR EACH ROW WHEN (coalesce(NEW.is_deleted,false)=false) EXECUTE FUNCTION public.capture_journal_financial_event();
