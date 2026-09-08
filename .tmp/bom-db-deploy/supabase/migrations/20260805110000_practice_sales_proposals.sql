-- Phase 2: sales pipeline, proposals, acceptance and engagement conversion.

CREATE TABLE IF NOT EXISTS public.practice_sales_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.practice_clients(id) ON DELETE SET NULL, title text NOT NULL, lead_source text,
  needs_summary text, service_type text, estimated_value numeric(18,2) NOT NULL DEFAULT 0,
  probability_percent integer NOT NULL DEFAULT 25 CHECK (probability_percent BETWEEN 0 AND 100),
  stage text NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead','qualified','proposal','negotiation','won','lost')),
  owner_id uuid REFERENCES public.staff(id) ON DELETE SET NULL, next_follow_up date, lost_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.practice_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.practice_sales_opportunities(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  proposal_number text NOT NULL, title text NOT NULL, service_type text NOT NULL, scope text NOT NULL,
  exclusions text, deliverables text, fee_type text NOT NULL DEFAULT 'fixed' CHECK (fee_type IN ('fixed','recurring','hourly','milestone','time_and_expenses')),
  subtotal numeric(18,2) NOT NULL DEFAULT 0, discount_amount numeric(18,2) NOT NULL DEFAULT 0,
  tax_rate numeric(8,2) NOT NULL DEFAULT 0, total_amount numeric(18,2) NOT NULL DEFAULT 0,
  valid_until date, proposed_start_date date, proposed_end_date date, payment_terms text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','internal_review','approved','sent','accepted','rejected','expired','withdrawn','converted')),
  prepared_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, internally_approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  internally_approved_at timestamptz, client_contact_id uuid REFERENCES public.practice_client_contacts(id) ON DELETE SET NULL,
  client_decision_at timestamptz, client_decision_notes text, converted_engagement_id uuid REFERENCES public.practice_engagements(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id, proposal_number)
);

CREATE TABLE IF NOT EXISTS public.practice_proposal_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL REFERENCES public.practice_proposals(id) ON DELETE CASCADE, line_no integer NOT NULL,
  description text NOT NULL, quantity numeric(15,2) NOT NULL DEFAULT 1, unit_price numeric(18,2) NOT NULL DEFAULT 0,
  line_total numeric(18,2) NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (proposal_id, line_no)
);

CREATE TABLE IF NOT EXISTS public.practice_client_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  proposal_id uuid REFERENCES public.practice_proposals(id) ON DELETE CASCADE,
  engagement_id uuid REFERENCES public.practice_engagements(id) ON DELETE CASCADE,
  approval_type text NOT NULL, decision text NOT NULL CHECK (decision IN ('pending','approved','rejected')),
  decided_by_contact_id uuid REFERENCES public.practice_client_contacts(id) ON DELETE SET NULL,
  decision_notes text, requested_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_practice_opportunities_pipeline ON public.practice_sales_opportunities (organization_id, stage, next_follow_up);
CREATE INDEX IF NOT EXISTS idx_practice_proposals_status ON public.practice_proposals (organization_id, status, valid_until);
CREATE INDEX IF NOT EXISTS idx_practice_proposal_items_proposal ON public.practice_proposal_items (proposal_id, line_no);
CREATE INDEX IF NOT EXISTS idx_practice_client_approvals_pending ON public.practice_client_approvals (organization_id, decision, requested_at);

ALTER TABLE public.practice_sales_opportunities ENABLE ROW LEVEL SECURITY; ALTER TABLE public.practice_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_proposal_items ENABLE ROW LEVEL SECURITY; ALTER TABLE public.practice_client_approvals ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['practice_sales_opportunities','practice_proposals','practice_proposal_items','practice_client_approvals'] LOOP
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',table_name||'_same_org',table_name);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_platform_admin() OR organization_id=(SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid())) WITH CHECK (public.is_platform_admin() OR organization_id=(SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid()))',table_name||'_same_org',table_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated',table_name); END LOOP; END $$;
