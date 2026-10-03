-- Phase 3 preparation only: no payment, insurer API or messaging connection is activated by this migration.
CREATE TABLE IF NOT EXISTS public.insurance_integration_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_type text NOT NULL CHECK(integration_type IN ('boat_pay','mobile_money','card','bank','insurer_api','sms','whatsapp','email')),
  provider_name text, enabled boolean NOT NULL DEFAULT false, configuration jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,integration_type,provider_name)
);
CREATE TABLE IF NOT EXISTS public.insurance_notification_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, event_type text NOT NULL, channel text NOT NULL CHECK(channel IN ('sms','whatsapp','email','boat')), days_before integer, active boolean NOT NULL DEFAULT false, template_text text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.insurance_integration_settings ENABLE ROW LEVEL SECURITY; ALTER TABLE public.insurance_notification_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY insurance_org_integrations ON public.insurance_integration_settings FOR ALL TO authenticated USING(public.insurance_org_access(organization_id)) WITH CHECK(public.insurance_org_access(organization_id));
CREATE POLICY insurance_org_notifications ON public.insurance_notification_rules FOR ALL TO authenticated USING(public.insurance_org_access(organization_id)) WITH CHECK(public.insurance_org_access(organization_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.insurance_integration_settings,public.insurance_notification_rules TO authenticated;
