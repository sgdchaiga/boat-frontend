-- Reduced pre-Phase-2 schema for PostgreSQL trigger regression tests.
-- This is not a replacement for applying the full application migration chain.
CREATE ROLE authenticated;
CREATE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.auth_staff_org_id() RETURNS uuid LANGUAGE sql AS $$
  SELECT nullif(current_setting('test.organization_id', true), '')::uuid
$$;
CREATE TABLE public.organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.staff (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations,
  name text, manufacturing_item_type text, cost_price numeric DEFAULT 0
);
CREATE TABLE public.manufacturing_boms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations,
  product_id uuid REFERENCES public.products, product_name text NOT NULL, version text DEFAULT 'v1',
  output_qty numeric NOT NULL DEFAULT 1 CHECK (output_qty > 0), output_unit text DEFAULT 'unit',
  materials jsonb NOT NULL DEFAULT '[]', expected_scrap_qty numeric DEFAULT 0,
  status text DEFAULT 'Active', updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.manufacturing_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations,
  bom_id uuid REFERENCES public.manufacturing_boms, product_name text NOT NULL, planned_qty numeric DEFAULT 1,
  completed_qty numeric DEFAULT 0, status text DEFAULT 'Planned', created_at timestamptz DEFAULT now()
);
CREATE TABLE public.manufacturing_production_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations,
  work_order_id uuid REFERENCES public.manufacturing_work_orders, product_id uuid REFERENCES public.products,
  product_name text, produced_qty numeric DEFAULT 0, production_date date DEFAULT current_date,
  posted_at timestamptz DEFAULT now(), manual_serial_number text, bom_id uuid REFERENCES public.manufacturing_boms,
  material_cost numeric DEFAULT 0
);
CREATE TABLE public.product_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations,
  product_id uuid NOT NULL REFERENCES public.products, movement_date timestamptz DEFAULT now(),
  source_type text, source_id uuid, quantity_in numeric NOT NULL DEFAULT 0,
  quantity_out numeric NOT NULL DEFAULT 0, unit_cost numeric, location text DEFAULT 'default', note text
);
CREATE TABLE public.manufacturing_costing_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations,
  production_entry_id uuid REFERENCES public.manufacturing_production_entries, bom_id uuid REFERENCES public.manufacturing_boms,
  product_id uuid REFERENCES public.products, period text, product_name text,
  material_cost numeric DEFAULT 0, labor_cost numeric DEFAULT 0, overhead_cost numeric DEFAULT 0,
  generated_from_production boolean, updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX idx_costing_production ON public.manufacturing_costing_entries(production_entry_id)
WHERE production_entry_id IS NOT NULL;
