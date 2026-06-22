CREATE TABLE IF NOT EXISTS public.practice_stock_takes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Stock take',
  stock_date date NOT NULL,
  source_file text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  prepared_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  completed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.practice_stock_take_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  stock_take_id uuid NOT NULL REFERENCES public.practice_stock_takes(id) ON DELETE CASCADE,
  item_code text,
  item_name text NOT NULL,
  category text,
  unit text,
  system_qty numeric(18,4) NOT NULL DEFAULT 0,
  physical_qty numeric(18,4),
  unit_cost numeric(18,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_practice_stock_takes_client_date ON public.practice_stock_takes (client_id, stock_date DESC);
CREATE INDEX IF NOT EXISTS idx_practice_stock_take_items_take ON public.practice_stock_take_items (stock_take_id, item_name);

ALTER TABLE public.practice_stock_takes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_stock_take_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_stock_takes_same_org ON public.practice_stock_takes;
CREATE POLICY practice_stock_takes_same_org ON public.practice_stock_takes FOR ALL TO authenticated
USING (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
WITH CHECK (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

DROP POLICY IF EXISTS practice_stock_take_items_same_org ON public.practice_stock_take_items;
CREATE POLICY practice_stock_take_items_same_org ON public.practice_stock_take_items FOR ALL TO authenticated
USING (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
WITH CHECK (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.practice_stock_takes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.practice_stock_take_items TO authenticated;
