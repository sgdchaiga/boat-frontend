-- Sales agents / bodabodas attached to Manufacturing POS sales.
CREATE TABLE IF NOT EXISTS public.pos_sales_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  commission_per_unit numeric(15,2) NOT NULL DEFAULT 2500 CHECK (commission_per_unit >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_sales_agents_org_name_uq
  ON public.pos_sales_agents (organization_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_pos_sales_agents_org_active
  ON public.pos_sales_agents (organization_id, is_active, name);

ALTER TABLE public.retail_sales
  ADD COLUMN IF NOT EXISTS sales_agent_id uuid REFERENCES public.pos_sales_agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sales_agent_name text,
  ADD COLUMN IF NOT EXISTS agent_commission_per_unit numeric(15,2) NOT NULL DEFAULT 0 CHECK (agent_commission_per_unit >= 0),
  ADD COLUMN IF NOT EXISTS agent_commission_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (agent_commission_amount >= 0),
  ADD COLUMN IF NOT EXISTS net_amount_due numeric(15,2);

UPDATE public.retail_sales
SET net_amount_due = total_amount
WHERE net_amount_due IS NULL;

ALTER TABLE public.pos_sales_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pos_sales_agents_select_same_org" ON public.pos_sales_agents;
DROP POLICY IF EXISTS "pos_sales_agents_write_same_org" ON public.pos_sales_agents;

CREATE POLICY "pos_sales_agents_select_same_org"
  ON public.pos_sales_agents FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.organization_members member
      WHERE member.user_id = auth.uid()
        AND member.organization_id = pos_sales_agents.organization_id
        AND member.is_active = true
    )
  );

CREATE POLICY "pos_sales_agents_write_same_org"
  ON public.pos_sales_agents FOR ALL TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.organization_members member
      WHERE member.user_id = auth.uid()
        AND member.organization_id = pos_sales_agents.organization_id
        AND member.is_active = true
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.organization_members member
      WHERE member.user_id = auth.uid()
        AND member.organization_id = pos_sales_agents.organization_id
        AND member.is_active = true
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.pos_sales_agents TO authenticated;

COMMENT ON TABLE public.pos_sales_agents IS 'Manufacturing POS sales agents and bodabodas with per-unit commission rates.';
COMMENT ON COLUMN public.retail_sales.net_amount_due IS 'Gross sale less POS sales-agent commission.';
