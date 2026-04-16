-- Hotel POS enterprise Phase 2: sessions, profiles, secure overrides, void logs.

-- Needed for secure PIN hashing.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Persistent table session lifecycle.
CREATE TABLE IF NOT EXISTS public.pos_table_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  table_number text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  opened_by uuid REFERENCES public.staff(id),
  closed_by uuid REFERENCES public.staff(id),
  note text
);

CREATE INDEX IF NOT EXISTS idx_pos_table_sessions_table_status ON public.pos_table_sessions(table_number, status);
CREATE INDEX IF NOT EXISTS idx_pos_table_sessions_org_opened_at ON public.pos_table_sessions(organization_id, opened_at DESC);

-- Customer preferences + VIP flags for hotel POS.
CREATE TABLE IF NOT EXISTS public.pos_customer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  property_customer_id uuid UNIQUE REFERENCES public.hotel_customers(id),
  vip boolean NOT NULL DEFAULT false,
  favorite_drink text,
  allergies text,
  preferences text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_customer_profiles_org ON public.pos_customer_profiles(organization_id);

-- Secure manager PIN hashes (per staff).
CREATE TABLE IF NOT EXISTS public.pos_manager_pin_hashes (
  staff_id uuid PRIMARY KEY REFERENCES public.staff(id),
  organization_id uuid,
  pin_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Verify manager PIN (RPC).
CREATE OR REPLACE FUNCTION public.verify_manager_pin(pin text, org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.pos_manager_pin_hashes p
    WHERE p.organization_id = org_id
      AND crypt(pin, p.pin_hash) = p.pin_hash
  ) INTO ok;
  RETURN COALESCE(ok, false);
END;
$$;

-- Set/rotate current staff PIN (RPC).
CREATE OR REPLACE FUNCTION public.set_my_manager_pin(pin text, org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.pos_manager_pin_hashes(staff_id, organization_id, pin_hash, updated_at)
  VALUES (auth.uid(), org_id, crypt(pin, gen_salt('bf')), now())
  ON CONFLICT (staff_id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      pin_hash = EXCLUDED.pin_hash,
      updated_at = now();
END;
$$;

-- Void/refund approval + reason logs.
CREATE TABLE IF NOT EXISTS public.pos_void_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  payment_id uuid REFERENCES public.payments(id),
  requested_by uuid REFERENCES public.staff(id),
  approved_by uuid REFERENCES public.staff(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pos_void_logs_org_created ON public.pos_void_logs(organization_id, created_at DESC);

