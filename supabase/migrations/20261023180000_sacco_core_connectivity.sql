-- Practical core-banking extensions: product GL mappings, idempotent payment intake,
-- and a durable webhook outbox. Secrets remain outside the database.
CREATE TABLE IF NOT EXISTS public.sacco_product_gl_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_family text NOT NULL CHECK(product_family IN('loan','savings','fixed_deposit','provision')),
  product_id uuid, transaction_type text NOT NULL,
  debit_gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id), credit_gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id),
  is_active boolean NOT NULL DEFAULT true, created_by uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,product_family,product_id,transaction_type)
);
CREATE TABLE IF NOT EXISTS public.sacco_payment_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL, channel text NOT NULL, direction text NOT NULL CHECK(direction IN('inbound','outbound')),
  amount numeric NOT NULL CHECK(amount>0), currency_code text NOT NULL DEFAULT 'UGX', member_id uuid REFERENCES public.sacco_members(id),
  reference text, status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','submitted','settled','failed','reversed','cancelled')),
  provider_reference text, request_payload jsonb NOT NULL DEFAULT '{}'::jsonb, response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz,
  UNIQUE(organization_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS public.sacco_webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL, endpoint_url text NOT NULL, event_types text[] NOT NULL DEFAULT ARRAY[]::text[], is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,name)
);
CREATE TABLE IF NOT EXISTS public.sacco_webhook_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL REFERENCES public.sacco_webhook_endpoints(id) ON DELETE CASCADE, event_id uuid NOT NULL REFERENCES public.financial_events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','delivered','failed','dead_letter')), attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz, response_code integer, response_body text, created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz,
  UNIQUE(endpoint_id,event_id)
);
ALTER TABLE public.sacco_product_gl_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_payment_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_webhook_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY sacco_gl_mapping_org ON public.sacco_product_gl_mappings FOR ALL TO authenticated USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())) WITH CHECK(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY sacco_payment_instruction_org ON public.sacco_payment_instructions FOR ALL TO authenticated USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())) WITH CHECK(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY sacco_webhook_endpoint_org ON public.sacco_webhook_endpoints FOR ALL TO authenticated USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())) WITH CHECK(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY sacco_webhook_outbox_org ON public.sacco_webhook_outbox FOR SELECT TO authenticated USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sacco_product_gl_mappings,sacco_payment_instructions,sacco_webhook_endpoints TO authenticated;
GRANT SELECT ON public.sacco_webhook_outbox TO authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_sacco_webhooks()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.sacco_webhook_outbox(organization_id,endpoint_id,event_id)
  SELECT NEW.organization_id,e.id,NEW.id FROM public.sacco_webhook_endpoints e
  WHERE e.organization_id=NEW.organization_id AND e.is_active AND (cardinality(e.event_types)=0 OR NEW.event_type=ANY(e.event_types))
  ON CONFLICT(endpoint_id,event_id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_enqueue_sacco_webhooks ON public.financial_events;
CREATE TRIGGER trg_enqueue_sacco_webhooks AFTER INSERT ON public.financial_events FOR EACH ROW EXECUTE FUNCTION public.enqueue_sacco_webhooks();
