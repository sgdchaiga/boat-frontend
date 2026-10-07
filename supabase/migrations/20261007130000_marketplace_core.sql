-- Shared BOAT Market foundation. Vertical modules link through source_module/source_record_id.
CREATE TABLE IF NOT EXISTS public.marketplace_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name text NOT NULL DEFAULT '', phone text, email text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.marketplace_merchant_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  display_name text NOT NULL, public_slug text NOT NULL UNIQUE,
  description text, phone text, email text, location text,
  is_published boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.marketplace_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.marketplace_merchant_profiles(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.marketplace_categories(id) ON DELETE SET NULL,
  title text NOT NULL, description text, listing_type text NOT NULL DEFAULT 'product' CHECK (listing_type IN ('product','service','room','insurance','school_item')),
  source_module text, source_record_id text, currency text NOT NULL DEFAULT 'UGX', price numeric(15,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  available_quantity numeric(15,3), is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_public ON public.marketplace_listings (is_published, category_id, organization_id);

CREATE TABLE IF NOT EXISTS public.marketplace_carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES public.marketplace_customers(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.marketplace_merchant_profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','converted','abandoned')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.marketplace_cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cart_id uuid NOT NULL REFERENCES public.marketplace_carts(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE RESTRICT,
  quantity numeric(15,3) NOT NULL CHECK (quantity > 0), unit_price numeric(15,2) NOT NULL CHECK (unit_price >= 0), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cart_id, listing_id)
);

CREATE TABLE IF NOT EXISTS public.marketplace_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_number text NOT NULL UNIQUE, organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.marketplace_merchant_profiles(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.marketplace_customers(id) ON DELETE SET NULL,
  origin_module text, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','paid','fulfilled','cancelled','refunded')),
  currency text NOT NULL DEFAULT 'UGX', gross_amount numeric(15,2) NOT NULL DEFAULT 0, payment_charge numeric(15,2) NOT NULL DEFAULT 0,
  platform_fee numeric(15,2) NOT NULL DEFAULT 0, merchant_amount numeric(15,2) NOT NULL DEFAULT 0,
  payment_reference text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.marketplace_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES public.marketplace_listings(id) ON DELETE SET NULL, title text NOT NULL, quantity numeric(15,3) NOT NULL,
  unit_price numeric(15,2) NOT NULL, total_amount numeric(15,2) NOT NULL, source_module text, source_record_id text
);

CREATE TABLE IF NOT EXISTS public.marketplace_commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  merchant_id uuid REFERENCES public.marketplace_merchant_profiles(id) ON DELETE CASCADE, category_id uuid REFERENCES public.marketplace_categories(id) ON DELETE SET NULL,
  rule_type text NOT NULL CHECK (rule_type IN ('percentage','fixed')), rate numeric(15,4) NOT NULL CHECK (rate >= 0),
  effective_from date NOT NULL DEFAULT current_date, effective_to date, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.marketplace_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.marketplace_merchant_profiles(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cleared','payable','paid')),
  gross_sales numeric(15,2) NOT NULL DEFAULT 0, refunds numeric(15,2) NOT NULL DEFAULT 0, payment_charges numeric(15,2) NOT NULL DEFAULT 0,
  platform_commissions numeric(15,2) NOT NULL DEFAULT 0, net_amount numeric(15,2) NOT NULL DEFAULT 0,
  paid_at timestamptz, reference text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketplace_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_merchant_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_settlements ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.marketplace_org_access(p_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin() OR p_org = (SELECT organization_id FROM public.staff WHERE id = auth.uid())
$$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['marketplace_merchant_profiles','marketplace_listings','marketplace_orders','marketplace_commission_rules','marketplace_settlements'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.marketplace_org_access(organization_id)) WITH CHECK (public.marketplace_org_access(organization_id))', 'marketplace_org_' || t, t);
  END LOOP;
END $$;
CREATE POLICY marketplace_categories_read ON public.marketplace_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY marketplace_customers_self ON public.marketplace_customers FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY marketplace_carts_self ON public.marketplace_carts FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.marketplace_customers c WHERE c.id = customer_id AND c.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.marketplace_customers c WHERE c.id = customer_id AND c.user_id = auth.uid()));
CREATE POLICY marketplace_cart_items_self ON public.marketplace_cart_items FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.marketplace_carts c JOIN public.marketplace_customers u ON u.id = c.customer_id WHERE c.id = cart_id AND u.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.marketplace_carts c JOIN public.marketplace_customers u ON u.id = c.customer_id WHERE c.id = cart_id AND u.user_id = auth.uid()));
CREATE POLICY marketplace_order_items_org ON public.marketplace_order_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.marketplace_orders o WHERE o.id = order_id AND public.marketplace_org_access(o.organization_id)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_customers, public.marketplace_merchant_profiles, public.marketplace_categories, public.marketplace_listings, public.marketplace_carts, public.marketplace_cart_items, public.marketplace_orders, public.marketplace_order_items, public.marketplace_commission_rules, public.marketplace_settlements TO authenticated;

INSERT INTO public.marketplace_categories(name, slug, sort_order) VALUES
  ('Retail products','retail-products',10),('School supplies','school-supplies',20),('Hotel accommodation','hotel-accommodation',30),('Restaurant services','restaurant-services',40),('Agricultural products','agricultural-products',50),('Professional services','professional-services',60),('Manufactured products','manufactured-products',70),('Clinic services','clinic-services',80),('Insurance products','insurance-products',90)
ON CONFLICT (slug) DO NOTHING;
