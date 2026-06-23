ALTER TABLE public.practice_stock_takes DROP CONSTRAINT IF EXISTS practice_stock_takes_status_check;
ALTER TABLE public.practice_stock_takes
  ADD CONSTRAINT practice_stock_takes_status_check
  CHECK (status IN ('draft', 'completed', 'submitted', 'adjusted'));

ALTER TABLE public.practice_stock_take_items
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS last_movement_date date,
  ADD COLUMN IF NOT EXISTS counted_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS counted_by_name text,
  ADD COLUMN IF NOT EXISTS counted_at timestamptz;

CREATE TABLE IF NOT EXISTS public.practice_stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  stock_take_id uuid NOT NULL UNIQUE REFERENCES public.practice_stock_takes(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  inventory_account text NOT NULL,
  gain_loss_account text NOT NULL,
  shortage_value numeric(18,2) NOT NULL DEFAULT 0,
  surplus_value numeric(18,2) NOT NULL DEFAULT 0,
  posted_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  posted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.practice_stock_adjustment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  adjustment_id uuid NOT NULL REFERENCES public.practice_stock_adjustments(id) ON DELETE CASCADE,
  account_name text NOT NULL,
  debit numeric(18,2) NOT NULL DEFAULT 0,
  credit numeric(18,2) NOT NULL DEFAULT 0,
  description text NOT NULL,
  CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
);

CREATE INDEX IF NOT EXISTS idx_practice_stock_adjustments_take ON public.practice_stock_adjustments (stock_take_id);
ALTER TABLE public.practice_stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_stock_adjustment_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_stock_adjustments_same_org ON public.practice_stock_adjustments;
CREATE POLICY practice_stock_adjustments_same_org ON public.practice_stock_adjustments FOR ALL TO authenticated
USING (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
WITH CHECK (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

DROP POLICY IF EXISTS practice_stock_adjustment_lines_same_org ON public.practice_stock_adjustment_lines;
CREATE POLICY practice_stock_adjustment_lines_same_org ON public.practice_stock_adjustment_lines FOR ALL TO authenticated
USING (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
WITH CHECK (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.practice_stock_adjustments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.practice_stock_adjustment_lines TO authenticated;
