-- Subscription catalog: same plan code can exist once per business type (e.g. starter pricing differs for hotel vs retail).

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS business_type_code text NOT NULL DEFAULT 'hotel';

COMMENT ON COLUMN public.subscription_plans.business_type_code IS
  'Matches organizations.business_type and business_types.code; pricing is per type.';

-- Replace global unique on code with (business_type_code, code)
ALTER TABLE public.subscription_plans DROP CONSTRAINT IF EXISTS subscription_plans_code_uq;
ALTER TABLE public.subscription_plans DROP CONSTRAINT IF EXISTS subscription_plans_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS subscription_plans_business_type_code_uq
  ON public.subscription_plans (business_type_code, code);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_business_type
  ON public.subscription_plans (business_type_code, sort_order);
