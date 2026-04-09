-- subscription_plans existed without column code (CREATE TABLE IF NOT EXISTS skipped). Safe to re-run.

ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS price_monthly numeric(12,2);
UPDATE public.subscription_plans SET price_monthly = 0 WHERE price_monthly IS NULL;
ALTER TABLE public.subscription_plans ALTER COLUMN price_monthly SET DEFAULT 0;
ALTER TABLE public.subscription_plans ALTER COLUMN price_monthly SET NOT NULL;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS price_yearly numeric(12,2);
UPDATE public.subscription_plans
SET price_yearly = ROUND((COALESCE(price_monthly, 0) * 12)::numeric, 2)
WHERE price_yearly IS NULL;
UPDATE public.subscription_plans SET price_yearly = 0 WHERE price_yearly IS NULL;
ALTER TABLE public.subscription_plans ALTER COLUMN price_yearly SET DEFAULT 0;
ALTER TABLE public.subscription_plans ALTER COLUMN price_yearly SET NOT NULL;

UPDATE public.subscription_plans
SET code = 'plan_' || replace(id::text, '-', '')
WHERE code IS NULL OR trim(code) = '';

UPDATE public.subscription_plans p
SET code = p.code || '_' || left(replace(p.id::text, '-', ''), 8)
WHERE EXISTS (
  SELECT 1 FROM public.subscription_plans p2
  WHERE p2.code = p.code AND p2.id <> p.id
);

ALTER TABLE public.subscription_plans ALTER COLUMN code SET NOT NULL;

DO $cq$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.subscription_plans'::regclass
      AND conname = 'subscription_plans_code_uq'
  ) THEN
    ALTER TABLE public.subscription_plans ADD CONSTRAINT subscription_plans_code_uq UNIQUE (code);
  END IF;
END
$cq$;

INSERT INTO public.subscription_plans (code, name, description, price_monthly, price_yearly, sort_order)
VALUES
  ('starter', 'Starter', 'Core front desk & billing', 49.00, 588.00, 1),
  ('professional', 'Professional', 'POS, inventory, purchases', 129.00, 1548.00, 2),
  ('enterprise', 'Enterprise', 'Full accounting & reports', 249.00, 2988.00, 3)
ON CONFLICT (code) DO NOTHING;
