-- Priority-three SACCO controls: digital member servicing, resilience evidence,
-- treasury/liquidity controls and GL-mapped closed-period ratio reporting.
CREATE TABLE IF NOT EXISTS public.sacco_member_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE, document_type text NOT NULL,
  storage_path text NOT NULL, file_name text NOT NULL, status text NOT NULL DEFAULT 'submitted' CHECK(status IN('submitted','verified','rejected','expired')),
  expires_on date, uploaded_by uuid, verified_by uuid REFERENCES public.staff(id), verified_at timestamptz, rejection_reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sacco_member_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE, transaction_reference text, category text NOT NULL,
  description text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN('open','investigating','resolved','rejected')),
  assigned_to uuid REFERENCES public.staff(id), resolution_note text, opened_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.sacco_member_notification_preferences (
  member_id uuid PRIMARY KEY REFERENCES public.sacco_members(id) ON DELETE CASCADE, organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sms_enabled boolean NOT NULL DEFAULT true, email_enabled boolean NOT NULL DEFAULT true, whatsapp_enabled boolean NOT NULL DEFAULT false, push_enabled boolean NOT NULL DEFAULT false,
  marketing_opt_in boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sacco_resilience_drills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  drill_type text NOT NULL CHECK(drill_type IN('backup_restore','failover','incident_response','access_review','load_test')),
  planned_date date NOT NULL, completed_at timestamptz, outcome text CHECK(outcome IN('passed','failed','partial')), evidence_reference text, findings text, owner_id uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sacco_operational_health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  check_type text NOT NULL CHECK(check_type IN('backup','database','webhook_outbox','reconciliation','period_close','access_review')),
  status text NOT NULL CHECK(status IN('healthy','warning','critical')), details jsonb NOT NULL DEFAULT '{}'::jsonb, checked_at timestamptz NOT NULL DEFAULT now(), checked_by uuid REFERENCES public.staff(id)
);
CREATE TABLE IF NOT EXISTS public.sacco_environment_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_environment text NOT NULL, target_environment text NOT NULL, release_reference text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','promoted','failed','rolled_back')),
  requested_by uuid REFERENCES public.staff(id), approved_by uuid REFERENCES public.staff(id), promoted_at timestamptz, evidence jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sacco_treasury_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  forecast_date date NOT NULL, horizon_days integer NOT NULL CHECK(horizon_days>0), opening_cash numeric NOT NULL DEFAULT 0, expected_inflows numeric NOT NULL DEFAULT 0,
  expected_outflows numeric NOT NULL DEFAULT 0, projected_closing_cash numeric NOT NULL DEFAULT 0, assumptions jsonb NOT NULL DEFAULT '{}'::jsonb, created_by uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,forecast_date,horizon_days)
);
CREATE TABLE IF NOT EXISTS public.sacco_interbranch_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_branch_code text NOT NULL, to_branch_code text NOT NULL, settlement_date date NOT NULL, amount numeric NOT NULL CHECK(amount>0),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','settled','reversed')), reference text, requested_by uuid REFERENCES public.staff(id), approved_by uuid REFERENCES public.staff(id), settled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sacco_investment_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  investment_type text NOT NULL, counterparty text NOT NULL, principal numeric NOT NULL, annual_rate numeric, start_date date NOT NULL, maturity_date date,
  status text NOT NULL DEFAULT 'active' CHECK(status IN('active','matured','sold','impaired')), concentration_group text, source_document_reference text, created_by uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sacco_liquidity_stress_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  test_date date NOT NULL, scenario_name text NOT NULL, assumed_outflow_percent numeric NOT NULL, assumed_inflow_haircut_percent numeric NOT NULL DEFAULT 0,
  liquid_assets numeric NOT NULL, stressed_outflows numeric NOT NULL, coverage_percent numeric NOT NULL, result text NOT NULL CHECK(result IN('pass','warning','fail')), assumptions jsonb NOT NULL DEFAULT '{}'::jsonb, run_by uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sacco_ratio_gl_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ratio_code text NOT NULL CHECK(ratio_code IN('roaa','roae','oss','cost_to_income','liquidity','capital_adequacy','debt_to_equity','interest_coverage','risk_coverage')),
  component_code text NOT NULL, gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id), sign_multiplier numeric NOT NULL DEFAULT 1, UNIQUE(organization_id,ratio_code,component_code,gl_account_id)
);
CREATE TABLE IF NOT EXISTS public.sacco_closed_period_ratios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_end date NOT NULL, ratio_code text NOT NULL, ratio_value numeric, numerator numeric, denominator numeric, benchmark text,
  calculation_snapshot jsonb NOT NULL, calculated_by uuid REFERENCES public.staff(id), calculated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,period_end,ratio_code)
);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['sacco_member_documents','sacco_member_disputes','sacco_member_notification_preferences','sacco_resilience_drills','sacco_operational_health_checks','sacco_environment_promotions','sacco_treasury_forecasts','sacco_interbranch_settlements','sacco_investment_register','sacco_liquidity_stress_tests','sacco_ratio_gl_mappings','sacco_closed_period_ratios'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',t||'_org',t); EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())) WITH CHECK (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()))',t||'_org',t); EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated',t); END LOOP; END $$;

CREATE OR REPLACE FUNCTION public.assert_sacco_closed_period(p_period_end date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; BEGIN SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid(); IF v_org IS NULL OR NOT EXISTS(SELECT 1 FROM public.accounting_period_closes WHERE organization_id=v_org AND period_end=p_period_end AND status='closed') THEN RAISE EXCEPTION 'Board and regulator ratios require a closed accounting period'; END IF; END $$;
REVOKE ALL ON FUNCTION public.assert_sacco_closed_period(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_sacco_closed_period(date) TO authenticated;
