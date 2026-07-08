-- Self-service onboarding: create an organization for the current authenticated user,
-- apply the standard business template, and open the workspace immediately.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'business_types'
  ) THEN
    INSERT INTO public.business_types (code, name, is_active, sort_order)
    VALUES ('agriculture', 'Agriculture / Farm', true, 90)
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      is_active = true,
      sort_order = EXCLUDED.sort_order;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.organization_onboarding_state (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  business_type text NOT NULL DEFAULT 'hotel',
  country text,
  currency text,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  template_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_steps text[] NOT NULL DEFAULT ARRAY[]::text[],
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_onboarding_state
  ADD COLUMN IF NOT EXISTS template_defaults jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.organization_onboarding_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organization_onboarding_state_select" ON public.organization_onboarding_state;
CREATE POLICY "organization_onboarding_state_select"
  ON public.organization_onboarding_state FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR public.user_is_member_of_org(organization_id)
  );

DROP POLICY IF EXISTS "organization_onboarding_state_update" ON public.organization_onboarding_state;
CREATE POLICY "organization_onboarding_state_update"
  ON public.organization_onboarding_state FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR public.user_is_member_of_org(organization_id)
  )
  WITH CHECK (
    public.is_platform_admin()
    OR public.user_is_member_of_org(organization_id)
  );

CREATE OR REPLACE FUNCTION public.update_organization_onboarding_state(
  p_organization_id uuid,
  p_completed_steps text[] DEFAULT NULL,
  p_dismissed boolean DEFAULT NULL
)
RETURNS public.organization_onboarding_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.organization_onboarding_state%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization id is required';
  END IF;

  IF NOT public.is_platform_admin() AND NOT public.user_is_member_of_org(p_organization_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization.';
  END IF;

  INSERT INTO public.organization_onboarding_state (organization_id, business_type)
  SELECT o.id, o.business_type
  FROM public.organizations o
  WHERE o.id = p_organization_id
  ON CONFLICT (organization_id) DO NOTHING;

  UPDATE public.organization_onboarding_state
  SET
    completed_steps = COALESCE(p_completed_steps, completed_steps),
    dismissed_at = CASE
      WHEN p_dismissed IS TRUE THEN now()
      WHEN p_dismissed IS FALSE THEN NULL
      ELSE dismissed_at
    END,
    updated_at = now()
  WHERE organization_id = p_organization_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_organization_template_operating_defaults(
  p_organization_id uuid,
  p_business_type text DEFAULT NULL,
  p_answers jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_type text;
  v_tax_rate numeric := CASE
    WHEN lower(COALESCE(p_answers ->> 'vat_registered', '')) IN ('true', 'yes', 'registered') THEN 18
    ELSE 0
  END;
  v_template_defaults jsonb;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization id is required';
  END IF;

  SELECT COALESCE(NULLIF(trim(lower(p_business_type)), ''), o.business_type, 'hotel')
    INTO v_business_type
  FROM public.organizations o
  WHERE o.id = p_organization_id;

  IF v_business_type IS NULL THEN
    v_business_type := COALESCE(NULLIF(trim(lower(p_business_type)), ''), 'hotel');
  END IF;

  v_template_defaults := jsonb_build_object(
    'business_type', v_business_type,
    'tax', jsonb_build_object(
      'vat_registered', v_tax_rate > 0,
      'default_vat_rate', v_tax_rate,
      'sales_prices_include_tax', v_business_type IN ('retail', 'restaurant', 'hotel', 'clinic')
    ),
    'payment_methods', CASE
      WHEN v_business_type IN ('sacco', 'vsla') THEN '["cash", "mobile_money", "bank_transfer", "wallet"]'::jsonb
      WHEN v_business_type = 'school' THEN '["cash", "mobile_money", "bank_transfer"]'::jsonb
      ELSE '["cash", "mobile_money", "card", "bank_transfer"]'::jsonb
    END,
    'starter_defaults', jsonb_build_object(
      'departments', CASE
        WHEN v_business_type IN ('hotel', 'mixed') THEN '["Rooms", "Restaurant", "Bar", "Housekeeping", "Administration"]'::jsonb
        WHEN v_business_type = 'restaurant' THEN '["Kitchen", "Bar", "Restaurant Floor", "Stores", "Administration"]'::jsonb
        WHEN v_business_type = 'retail' THEN '["Sales Floor", "Stores", "Purchasing", "Administration"]'::jsonb
        WHEN v_business_type = 'manufacturing' THEN '["Production", "Stores", "Quality Control", "Maintenance", "Administration"]'::jsonb
        WHEN v_business_type IN ('sacco', 'vsla') THEN '["Member Services", "Credit", "Cash Office", "Administration"]'::jsonb
        WHEN v_business_type = 'school' THEN '["Academics", "Boarding", "Bursar", "Stores", "Administration"]'::jsonb
        WHEN v_business_type = 'clinic' THEN '["Consultation", "Pharmacy", "Laboratory", "Reception", "Administration"]'::jsonb
        WHEN v_business_type = 'agriculture' THEN '["Field Operations", "Produce Store", "Inputs Store", "Sales", "Administration"]'::jsonb
        ELSE '["Operations", "Sales", "Stores", "Administration"]'::jsonb
      END,
      'catalogue', CASE
        WHEN v_business_type = 'manufacturing' THEN '["Raw Material", "Packaging Material", "Finished Product", "Scrap Metal"]'::jsonb
        WHEN v_business_type IN ('sacco', 'vsla') THEN '["Ordinary Savings", "Shares", "Development Loan", "Emergency Loan"]'::jsonb
        WHEN v_business_type = 'school' THEN '["Primary Classes", "Core Subjects", "Tuition Fees"]'::jsonb
        ELSE '["Starter products and services"]'::jsonb
      END
    )
  );

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'departments'
  ) THEN
    INSERT INTO public.departments (organization_id, name, pos_catalog_mode)
    SELECT p_organization_id, d.name, d.pos_catalog_mode
    FROM (
      VALUES
        ('hotel', 'Rooms', 'product_catalog'),
        ('hotel', 'Restaurant', 'dish_menu'),
        ('hotel', 'Bar', 'product_catalog'),
        ('hotel', 'Housekeeping', 'product_catalog'),
        ('hotel', 'Administration', 'product_catalog'),
        ('mixed', 'Rooms', 'product_catalog'),
        ('mixed', 'Restaurant', 'dish_menu'),
        ('mixed', 'Bar', 'product_catalog'),
        ('mixed', 'Retail', 'product_catalog'),
        ('mixed', 'Administration', 'product_catalog'),
        ('restaurant', 'Kitchen', 'dish_menu'),
        ('restaurant', 'Bar', 'product_catalog'),
        ('restaurant', 'Restaurant Floor', 'dish_menu'),
        ('restaurant', 'Stores', 'product_catalog'),
        ('restaurant', 'Administration', 'product_catalog'),
        ('retail', 'Sales Floor', 'product_catalog'),
        ('retail', 'Stores', 'product_catalog'),
        ('retail', 'Purchasing', 'product_catalog'),
        ('retail', 'Administration', 'product_catalog'),
        ('manufacturing', 'Production', 'product_catalog'),
        ('manufacturing', 'Stores', 'product_catalog'),
        ('manufacturing', 'Quality Control', 'product_catalog'),
        ('manufacturing', 'Maintenance', 'product_catalog'),
        ('manufacturing', 'Administration', 'product_catalog'),
        ('sacco', 'Member Services', 'product_catalog'),
        ('sacco', 'Credit', 'product_catalog'),
        ('sacco', 'Cash Office', 'product_catalog'),
        ('sacco', 'Administration', 'product_catalog'),
        ('vsla', 'Member Services', 'product_catalog'),
        ('vsla', 'Credit', 'product_catalog'),
        ('vsla', 'Cash Office', 'product_catalog'),
        ('vsla', 'Administration', 'product_catalog'),
        ('school', 'Academics', 'product_catalog'),
        ('school', 'Boarding', 'product_catalog'),
        ('school', 'Bursar', 'product_catalog'),
        ('school', 'Stores', 'product_catalog'),
        ('school', 'Administration', 'product_catalog'),
        ('clinic', 'Consultation', 'product_catalog'),
        ('clinic', 'Pharmacy', 'product_catalog'),
        ('clinic', 'Laboratory', 'product_catalog'),
        ('clinic', 'Reception', 'product_catalog'),
        ('clinic', 'Administration', 'product_catalog'),
        ('agriculture', 'Field Operations', 'product_catalog'),
        ('agriculture', 'Produce Store', 'product_catalog'),
        ('agriculture', 'Inputs Store', 'product_catalog'),
        ('agriculture', 'Sales', 'product_catalog'),
        ('agriculture', 'Administration', 'product_catalog')
    ) AS d(business_type, name, pos_catalog_mode)
    WHERE d.business_type = v_business_type
      AND NOT EXISTS (
        SELECT 1
        FROM public.departments existing
        WHERE existing.organization_id = p_organization_id
          AND lower(trim(existing.name)) = lower(trim(d.name))
      );
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'products'
  ) THEN
    INSERT INTO public.products (
      organization_id,
      name,
      unit_of_measure,
      cost_price,
      sales_price,
      purchasable,
      saleable,
      track_inventory,
      active,
      manufacturing_item_type
    )
    SELECT
      p_organization_id,
      p.name,
      p.unit_of_measure,
      p.cost_price,
      p.sales_price,
      p.purchasable,
      p.saleable,
      p.track_inventory,
      true,
      p.manufacturing_item_type
    FROM (
      VALUES
        ('retail', 'General Merchandise', 'unit', 0::numeric, 0::numeric, true, true, true, NULL),
        ('retail', 'Delivery Fee', 'service', 0::numeric, 0::numeric, false, true, false, NULL),
        ('restaurant', 'House Meal', 'plate', 0::numeric, 0::numeric, true, true, false, NULL),
        ('restaurant', 'Soft Drink', 'bottle', 0::numeric, 0::numeric, true, true, true, NULL),
        ('hotel', 'Breakfast', 'plate', 0::numeric, 0::numeric, true, true, false, NULL),
        ('hotel', 'Laundry Service', 'service', 0::numeric, 0::numeric, false, true, false, NULL),
        ('mixed', 'Breakfast', 'plate', 0::numeric, 0::numeric, true, true, false, NULL),
        ('mixed', 'Retail Item', 'unit', 0::numeric, 0::numeric, true, true, true, NULL),
        ('clinic', 'Consultation Fee', 'service', 0::numeric, 0::numeric, false, true, false, NULL),
        ('clinic', 'Paracetamol', 'pack', 0::numeric, 0::numeric, true, true, true, NULL),
        ('agriculture', 'Farm Inputs', 'unit', 0::numeric, 0::numeric, true, false, true, NULL),
        ('agriculture', 'Harvested Produce', 'kg', 0::numeric, 0::numeric, false, true, true, NULL),
        ('manufacturing', 'Raw Material', 'kg', 0::numeric, 0::numeric, true, false, true, 'raw_material'),
        ('manufacturing', 'Packaging Material', 'unit', 0::numeric, 0::numeric, true, false, true, 'consumable'),
        ('manufacturing', 'Finished Product', 'unit', 0::numeric, 0::numeric, false, true, true, 'finished_product'),
        ('manufacturing', 'Scrap Metal', 'kg', 0::numeric, 0::numeric, false, true, true, 'other')
    ) AS p(business_type, name, unit_of_measure, cost_price, sales_price, purchasable, saleable, track_inventory, manufacturing_item_type)
    WHERE p.business_type = v_business_type
      AND NOT EXISTS (
        SELECT 1
        FROM public.products existing
        WHERE existing.organization_id = p_organization_id
          AND lower(trim(existing.name)) = lower(trim(p.name))
      );
  END IF;

  IF v_business_type IN ('sacco', 'vsla')
    AND EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'sacco_savings_product_types'
    )
  THEN
    INSERT INTO public.sacco_savings_product_types (organization_id, code, name, description, sort_order, is_active)
    VALUES
      (p_organization_id, 'SAV', 'Ordinary Savings', 'Default member savings account type.', 10, true),
      (p_organization_id, 'SHA', 'Shares', 'Member share capital account type.', 20, true)
    ON CONFLICT (organization_id, code) DO NOTHING;
  END IF;

  IF v_business_type IN ('sacco', 'vsla')
    AND EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'sacco_loan_products'
    )
  THEN
    INSERT INTO public.sacco_loan_products (
      organization_id,
      name,
      interest_rate,
      max_term_months,
      min_amount,
      max_amount,
      interest_basis,
      fees,
      compulsory_savings_rate,
      minimum_shares,
      sort_order,
      is_active
    )
    VALUES
      (p_organization_id, 'Development Loan', 2.5, 24, 0, 0, 'declining', '{}'::jsonb, 0, 0, 10, true),
      (p_organization_id, 'Emergency Loan', 3.0, 6, 0, 0, 'flat', '{}'::jsonb, 0, 0, 20, true)
    ON CONFLICT (organization_id, name) DO NOTHING;
  END IF;

  IF v_business_type = 'school'
    AND EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'classes'
    )
  THEN
    INSERT INTO public.classes (organization_id, name, code, sort_order, is_active)
    VALUES
      (p_organization_id, 'Primary One', 'P1', 10, true),
      (p_organization_id, 'Primary Two', 'P2', 20, true),
      (p_organization_id, 'Primary Three', 'P3', 30, true)
    ON CONFLICT (organization_id, name) DO NOTHING;
  END IF;

  IF v_business_type = 'school'
    AND EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'streams'
    )
  THEN
    INSERT INTO public.streams (organization_id, name, code, sort_order, is_active)
    VALUES
      (p_organization_id, 'Blue', 'BLUE', 10, true),
      (p_organization_id, 'Green', 'GREEN', 20, true)
    ON CONFLICT (organization_id, name) DO NOTHING;
  END IF;

  IF v_business_type = 'school'
    AND EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'subjects'
    )
  THEN
    INSERT INTO public.subjects (organization_id, name, code, sort_order, is_active)
    VALUES
      (p_organization_id, 'English', 'ENG', 10, true),
      (p_organization_id, 'Mathematics', 'MATH', 20, true),
      (p_organization_id, 'Science', 'SCI', 30, true),
      (p_organization_id, 'Social Studies', 'SST', 40, true)
    ON CONFLICT (organization_id, name) DO NOTHING;
  END IF;

  INSERT INTO public.organization_onboarding_state (
    organization_id,
    business_type,
    answers,
    template_defaults,
    completed_steps
  )
  VALUES (
    p_organization_id,
    v_business_type,
    COALESCE(p_answers, '{}'::jsonb),
    v_template_defaults,
    ARRAY['choose_template', 'smart_defaults']::text[]
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    business_type = EXCLUDED.business_type,
    answers = COALESCE(NULLIF(public.organization_onboarding_state.answers, '{}'::jsonb), EXCLUDED.answers),
    template_defaults = public.organization_onboarding_state.template_defaults || EXCLUDED.template_defaults,
    completed_steps = (
      SELECT ARRAY(
        SELECT DISTINCT step
        FROM unnest(public.organization_onboarding_state.completed_steps || EXCLUDED.completed_steps) AS step
      )
    ),
    updated_at = now();

  RETURN v_template_defaults;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_organization_standard_roles(
  p_organization_id uuid,
  p_business_type text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_type text;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization id is required';
  END IF;

  SELECT COALESCE(NULLIF(trim(p_business_type), ''), o.business_type, 'hotel')
    INTO v_business_type
  FROM public.organizations o
  WHERE o.id = p_organization_id;

  IF v_business_type IS NULL THEN
    v_business_type := COALESCE(NULLIF(trim(p_business_type), ''), 'hotel');
  END IF;

  INSERT INTO public.organization_role_types (
    organization_id,
    role_key,
    display_name,
    sort_order,
    can_edit_pos_orders,
    can_edit_cash_receipts
  )
  SELECT p_organization_id, role_key, display_name, sort_order, can_edit_pos_orders, can_edit_cash_receipts
  FROM (
    VALUES
      ('admin', 'Administrator', 0, false, false),
      ('manager', 'Manager', 10, false, false),
      ('accountant', 'Accountant', 20, false, false),
      ('cashier', 'Cashier', 30, false, false),
      ('storekeeper', 'Storekeeper', 40, false, false),
      ('supervisor', 'Supervisor', 50, false, false)
  ) AS base_roles(role_key, display_name, sort_order, can_edit_pos_orders, can_edit_cash_receipts)
  ON CONFLICT (organization_id, role_key) DO NOTHING;

  IF v_business_type IN ('hotel', 'mixed') THEN
    INSERT INTO public.organization_role_types (organization_id, role_key, display_name, sort_order, can_edit_pos_orders, can_edit_cash_receipts)
    VALUES
      (p_organization_id, 'receptionist', 'Receptionist', 60, false, false),
      (p_organization_id, 'housekeeping', 'Housekeeping', 70, false, false),
      (p_organization_id, 'barman', 'Barman', 80, false, false),
      (p_organization_id, 'chef', 'Chef', 90, false, false)
    ON CONFLICT (organization_id, role_key) DO NOTHING;
  ELSIF v_business_type = 'manufacturing' THEN
    INSERT INTO public.organization_role_types (organization_id, role_key, display_name, sort_order, can_edit_pos_orders, can_edit_cash_receipts)
    VALUES
      (p_organization_id, 'production_manager', 'Production Manager', 60, false, false),
      (p_organization_id, 'machine_operator', 'Machine Operator', 70, false, false),
      (p_organization_id, 'quality_controller', 'Quality Controller', 80, false, false)
    ON CONFLICT (organization_id, role_key) DO NOTHING;
  ELSIF v_business_type IN ('sacco', 'vsla') THEN
    INSERT INTO public.organization_role_types (organization_id, role_key, display_name, sort_order, can_edit_pos_orders, can_edit_cash_receipts)
    VALUES
      (p_organization_id, 'loan_officer', 'Loan Officer', 60, false, false),
      (p_organization_id, 'teller', 'Teller', 70, false, false),
      (p_organization_id, 'credit_committee', 'Credit Committee', 80, false, false)
    ON CONFLICT (organization_id, role_key) DO NOTHING;
  ELSIF v_business_type = 'school' THEN
    INSERT INTO public.organization_role_types (organization_id, role_key, display_name, sort_order, can_edit_pos_orders, can_edit_cash_receipts)
    VALUES
      (p_organization_id, 'bursar', 'Bursar', 60, false, false),
      (p_organization_id, 'teacher', 'Teacher', 70, false, false),
      (p_organization_id, 'registrar', 'Registrar', 80, false, false)
    ON CONFLICT (organization_id, role_key) DO NOTHING;
  ELSIF v_business_type = 'clinic' THEN
    INSERT INTO public.organization_role_types (organization_id, role_key, display_name, sort_order, can_edit_pos_orders, can_edit_cash_receipts)
    VALUES
      (p_organization_id, 'clinician', 'Clinician', 60, false, false),
      (p_organization_id, 'lab_technician', 'Lab Technician', 70, false, false),
      (p_organization_id, 'pharmacist', 'Pharmacist', 80, false, false)
    ON CONFLICT (organization_id, role_key) DO NOTHING;
  ELSIF v_business_type = 'agriculture' THEN
    INSERT INTO public.organization_role_types (organization_id, role_key, display_name, sort_order, can_edit_pos_orders, can_edit_cash_receipts)
    VALUES
      (p_organization_id, 'farm_manager', 'Farm Manager', 60, false, false),
      (p_organization_id, 'field_supervisor', 'Field Supervisor', 70, false, false),
      (p_organization_id, 'produce_storekeeper', 'Produce Storekeeper', 80, false, false)
    ON CONFLICT (organization_id, role_key) DO NOTHING;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_self_service_organization(
  p_business_name text,
  p_business_type text,
  p_country text DEFAULT NULL,
  p_currency text DEFAULT NULL,
  p_admin_full_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_answers jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_slug_base text;
  v_slug text;
  v_suffix int := 0;
  v_email text := COALESCE(auth.jwt() ->> 'email', '');
  v_full_name text;
  v_trial_plan_id uuid;
  v_business_type text := COALESCE(NULLIF(trim(lower(p_business_type)), ''), 'hotel');
  v_template_defaults jsonb := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before creating an organization.';
  END IF;
  IF NULLIF(trim(p_business_name), '') IS NULL THEN
    RAISE EXCEPTION 'Business name is required.';
  END IF;

  v_full_name := COALESCE(NULLIF(trim(p_admin_full_name), ''), NULLIF(auth.jwt() -> 'user_metadata' ->> 'full_name', ''), v_email, 'Administrator');
  v_slug_base := lower(regexp_replace(trim(p_business_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug_base := trim(both '-' from COALESCE(NULLIF(v_slug_base, ''), 'organization'));
  v_slug := left(v_slug_base, 72);

  WHILE EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_slug) LOOP
    v_suffix := v_suffix + 1;
    v_slug := left(v_slug_base, 68) || '-' || v_suffix::text;
  END LOOP;

  INSERT INTO public.organizations (
    name,
    slug,
    business_type,
    address,
    enable_fixed_assets,
    enable_asset_verification,
    enable_communications,
    enable_wallet,
    enable_payroll,
    enable_budget,
    enable_treasury,
    enable_reconciliation,
    enable_agent,
    enable_boat_connect,
    enable_hotel_assessment,
    enable_manufacturing,
    enable_reports,
    enable_accounting,
    enable_inventory,
    enable_purchases,
    school_enable_reports,
    school_enable_accounting,
    school_enable_inventory,
    school_enable_purchases
  )
  VALUES (
    trim(p_business_name),
    v_slug,
    v_business_type,
    NULLIF(trim(COALESCE(p_country, '')), ''),
    v_business_type IN ('manufacturing', 'clinic', 'hotel', 'mixed'),
    v_business_type = 'accounting_practice',
    true,
    true,
    true,
    true,
    true,
    true,
    v_business_type NOT IN ('retail', 'clinic'),
    true,
    v_business_type IN ('hotel', 'mixed'),
    v_business_type = 'manufacturing',
    true,
    true,
    true,
    true,
    v_business_type = 'school',
    v_business_type = 'school',
    v_business_type = 'school',
    v_business_type = 'school'
  )
  RETURNING id INTO v_org_id;

  PERFORM public.ensure_organization_standard_setup(v_org_id, v_business_type);
  PERFORM public.ensure_organization_standard_roles(v_org_id, v_business_type);
  SELECT public.ensure_organization_template_operating_defaults(v_org_id, v_business_type, COALESCE(p_answers, '{}'::jsonb))
    INTO v_template_defaults;

  INSERT INTO public.organization_members (user_id, organization_id, role, full_name, phone, is_active)
  VALUES (v_user_id, v_org_id, 'admin', v_full_name, NULLIF(trim(COALESCE(p_phone, '')), ''), true)
  ON CONFLICT (user_id, organization_id) DO UPDATE SET
    role = EXCLUDED.role,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    is_active = true,
    updated_at = now();

  INSERT INTO public.staff (id, email, full_name, phone, role, organization_id, is_active)
  VALUES (v_user_id, COALESCE(NULLIF(v_email, ''), v_user_id::text || '@boat.local'), v_full_name, NULLIF(trim(COALESCE(p_phone, '')), ''), 'admin', v_org_id, true)
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(NULLIF(EXCLUDED.email, ''), public.staff.email),
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    organization_id = EXCLUDED.organization_id,
    is_active = true;

  INSERT INTO public.user_active_organization (user_id, organization_id, updated_at)
  VALUES (v_user_id, v_org_id, now())
  ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id, updated_at = now();

  INSERT INTO public.organization_onboarding_state (
    organization_id,
    business_type,
    country,
    currency,
    answers,
    template_defaults,
    completed_steps
  )
  VALUES (
    v_org_id,
    v_business_type,
    p_country,
    p_currency,
    COALESCE(p_answers, '{}'::jsonb),
    v_template_defaults,
    ARRAY['choose_template', 'smart_defaults']::text[]
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    business_type = EXCLUDED.business_type,
    country = EXCLUDED.country,
    currency = EXCLUDED.currency,
    answers = EXCLUDED.answers,
    template_defaults = public.organization_onboarding_state.template_defaults || EXCLUDED.template_defaults,
    completed_steps = (
      SELECT ARRAY(
        SELECT DISTINCT step
        FROM unnest(public.organization_onboarding_state.completed_steps || EXCLUDED.completed_steps) AS step
      )
    ),
    dismissed_at = NULL,
    updated_at = now();

  SELECT sp.id
    INTO v_trial_plan_id
  FROM public.subscription_plans sp
  WHERE COALESCE(sp.business_type_code, v_business_type) = v_business_type
  ORDER BY sp.sort_order NULLS LAST, sp.price_monthly NULLS FIRST, sp.created_at
  LIMIT 1;

  IF v_trial_plan_id IS NULL THEN
    SELECT id INTO v_trial_plan_id
    FROM public.subscription_plans
    ORDER BY sort_order NULLS LAST, price_monthly NULLS FIRST, created_at
    LIMIT 1;
  END IF;

  IF v_trial_plan_id IS NOT NULL THEN
    INSERT INTO public.organization_subscriptions (organization_id, plan_id, status, period_start, period_end, notes)
    VALUES (v_org_id, v_trial_plan_id, 'trial', CURRENT_DATE, CURRENT_DATE + interval '30 days', 'Created by self-service onboarding')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'organization_id', v_org_id,
    'slug', v_slug,
    'business_type', v_business_type,
    'country', p_country,
    'currency', p_currency,
    'answers', COALESCE(p_answers, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_organization_standard_setup_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_organization_standard_setup(NEW.id, NEW.business_type);
  PERFORM public.ensure_organization_standard_roles(NEW.id, NEW.business_type);
  PERFORM public.ensure_organization_template_operating_defaults(NEW.id, NEW.business_type, '{}'::jsonb);
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  org record;
BEGIN
  FOR org IN SELECT id, business_type FROM public.organizations LOOP
    PERFORM public.ensure_organization_standard_roles(org.id, org.business_type);
    PERFORM public.ensure_organization_template_operating_defaults(org.id, org.business_type, '{}'::jsonb);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.ensure_organization_standard_roles(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_organization_template_operating_defaults(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_self_service_organization(text, text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_organization_onboarding_state(uuid, text[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_organization_standard_roles(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_organization_template_operating_defaults(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_self_service_organization(text, text, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_organization_onboarding_state(uuid, text[], boolean) TO authenticated;

COMMENT ON FUNCTION public.create_self_service_organization(text, text, text, text, text, text, jsonb) IS
  'Creates a customer organization from the onboarding wizard, applies standard templates, links auth.uid() as admin, and starts a trial subscription.';
