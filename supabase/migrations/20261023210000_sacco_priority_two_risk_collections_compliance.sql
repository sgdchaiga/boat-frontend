-- Priority-two SACCO controls: credit risk, collections, product rules, AML and payment mandates.
CREATE TABLE IF NOT EXISTS public.sacco_credit_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  loan_id uuid NOT NULL REFERENCES public.sacco_loans(id) ON DELETE CASCADE, member_id uuid NOT NULL REFERENCES public.sacco_members(id),
  requested_amount numeric NOT NULL, verified_monthly_income numeric, verified_monthly_debt numeric, debt_service_ratio numeric,
  credit_score numeric, recommended_limit numeric, risk_grade text CHECK(risk_grade IN('low','medium','high','decline')),
  crb_status text NOT NULL DEFAULT 'not_requested' CHECK(crb_status IN('not_requested','pending','clear','adverse','unavailable')),
  decision text NOT NULL DEFAULT 'pending' CHECK(decision IN('pending','recommended','exception','declined','approved')),
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb, assessed_by uuid REFERENCES public.staff(id), assessed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(loan_id)
);
CREATE TABLE IF NOT EXISTS public.sacco_collateral_valuations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  loan_id uuid NOT NULL REFERENCES public.sacco_loans(id) ON DELETE CASCADE, collateral_type text NOT NULL, description text NOT NULL,
  forced_sale_value numeric NOT NULL, market_value numeric, valuation_date date NOT NULL, expires_on date, valuer_name text, evidence_reference text,
  status text NOT NULL DEFAULT 'active' CHECK(status IN('active','expired','released')), recorded_by uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sacco_guarantor_exposures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  loan_id uuid NOT NULL REFERENCES public.sacco_loans(id) ON DELETE CASCADE, guarantor_member_id uuid NOT NULL REFERENCES public.sacco_members(id), guaranteed_amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN('active','released','called')), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(loan_id,guarantor_member_id)
);
CREATE TABLE IF NOT EXISTS public.sacco_credit_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  loan_id uuid NOT NULL REFERENCES public.sacco_loans(id) ON DELETE CASCADE, exception_type text NOT NULL, rationale text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','cancelled')), requested_by uuid REFERENCES public.staff(id), requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.staff(id), decided_at timestamptz, decision_note text
);

CREATE TABLE IF NOT EXISTS public.sacco_collection_promises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  collection_case_id uuid NOT NULL REFERENCES public.sacco_collection_cases(id) ON DELETE CASCADE, amount numeric NOT NULL, promise_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK(status IN('open','kept','broken','cancelled')), channel text, note text, created_by uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sacco_collection_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  collection_case_id uuid NOT NULL REFERENCES public.sacco_collection_cases(id) ON DELETE CASCADE, activity_type text NOT NULL CHECK(activity_type IN('call','sms','visit','letter','legal','restructure','payment','note')),
  outcome text, next_action_date date, performed_by uuid REFERENCES public.staff(id), performed_at timestamptz NOT NULL DEFAULT now(), details jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.sacco_collection_cases ADD COLUMN IF NOT EXISTS strategy text NOT NULL DEFAULT 'standard';
ALTER TABLE public.sacco_collection_cases ADD COLUMN IF NOT EXISTS legal_stage text NOT NULL DEFAULT 'none';

CREATE TABLE IF NOT EXISTS public.sacco_product_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_family text NOT NULL CHECK(product_family IN('loan','savings','fixed_deposit')), product_id uuid, rule_type text NOT NULL,
  priority integer NOT NULL DEFAULT 100, is_active boolean NOT NULL DEFAULT true, conditions jsonb NOT NULL DEFAULT '{}'::jsonb, outcome jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,product_family,product_id,rule_type,priority)
);

CREATE TABLE IF NOT EXISTS public.sacco_watchlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  list_type text NOT NULL CHECK(list_type IN('sanctions','pep','internal','adverse_media')), full_name text NOT NULL, identifiers jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text, is_active boolean NOT NULL DEFAULT true, added_at timestamptz NOT NULL DEFAULT now(), added_by uuid REFERENCES public.staff(id)
);
CREATE TABLE IF NOT EXISTS public.sacco_screening_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE, watchlist_entry_id uuid REFERENCES public.sacco_watchlist_entries(id),
  screening_type text NOT NULL CHECK(screening_type IN('sanctions','pep','adverse_media','identity')), match_score numeric, status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','clear','possible_match','confirmed_match')),
  reviewed_by uuid REFERENCES public.staff(id), reviewed_at timestamptz, notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sacco_transaction_monitoring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL, event_type text NOT NULL, threshold_amount numeric, lookback_days integer NOT NULL DEFAULT 1, threshold_count integer, is_active boolean NOT NULL DEFAULT true,
  action text NOT NULL DEFAULT 'alert' CHECK(action IN('alert','hold','review')), created_by uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,name)
);
CREATE TABLE IF NOT EXISTS public.sacco_data_retention_policies (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE, customer_record_years integer NOT NULL DEFAULT 7, transaction_record_years integer NOT NULL DEFAULT 10,
  audit_record_years integer NOT NULL DEFAULT 10, updated_by uuid REFERENCES public.staff(id), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sacco_payment_mandates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE, mandate_type text NOT NULL CHECK(mandate_type IN('standing_order','direct_debit')),
  source_account_id uuid REFERENCES public.sacco_member_savings_accounts(id), destination_reference text NOT NULL, amount numeric, frequency text NOT NULL CHECK(frequency IN('weekly','monthly','quarterly','once')),
  next_run_date date, status text NOT NULL DEFAULT 'active' CHECK(status IN('active','paused','cancelled','expired')), provider_mandate_reference text, created_by uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sacco_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.sacco_members(id) ON DELETE SET NULL, channel text NOT NULL CHECK(channel IN('sms','email','whatsapp','push')),
  template_code text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sent','failed','cancelled')),
  scheduled_for timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, provider_message_id text, created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['sacco_credit_assessments','sacco_collateral_valuations','sacco_guarantor_exposures','sacco_credit_exceptions','sacco_collection_promises','sacco_collection_activities','sacco_product_rules','sacco_watchlist_entries','sacco_screening_results','sacco_transaction_monitoring_rules','sacco_data_retention_policies','sacco_payment_mandates','sacco_notification_outbox'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())) WITH CHECK (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()))',t||'_org',t); EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated',t); END LOOP; END $$;
