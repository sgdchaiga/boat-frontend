-- School revenue additions:
-- 1) add school_other_revenue table (non-fee revenue)
-- 2) enforce/default fee line priority in fee_structures.line_items

CREATE TABLE IF NOT EXISTS public.school_other_revenue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  revenue_type text NOT NULL,
  payer_name text,
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash', 'mobile_money', 'bank', 'transfer', 'other')),
  reference text,
  notes text,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_school_other_revenue_org_received
  ON public.school_other_revenue (organization_id, received_at DESC);

DROP TRIGGER IF EXISTS trg_set_org_school_other_revenue ON public.school_other_revenue;
CREATE TRIGGER trg_set_org_school_other_revenue
BEFORE INSERT ON public.school_other_revenue
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.school_other_revenue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS school_other_revenue_select_same_org ON public.school_other_revenue;
CREATE POLICY school_other_revenue_select_same_org
ON public.school_other_revenue
FOR SELECT TO authenticated
USING (
  organization_id IS NOT NULL
  AND organization_id = (
    SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
  )
);

DROP POLICY IF EXISTS school_other_revenue_write_same_org ON public.school_other_revenue;
CREATE POLICY school_other_revenue_write_same_org
ON public.school_other_revenue
FOR ALL TO authenticated
USING (
  organization_id IS NOT NULL
  AND organization_id = (
    SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
  )
)
WITH CHECK (
  organization_id IS NOT NULL
  AND organization_id = (
    SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_other_revenue TO authenticated;

COMMENT ON TABLE public.school_other_revenue IS
  'School non-fee revenue entries (hall hire, voluntary contributions, donations, etc).';

-- Keep fee line priorities always present and valid.
CREATE OR REPLACE FUNCTION public.normalize_school_fee_line_items(p_lines jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_set(
        elem.item,
        '{priority}',
        to_jsonb(
          GREATEST(
            1,
            CASE
              WHEN COALESCE(elem.item->>'priority', '') ~ '^[0-9]+$'
                THEN (elem.item->>'priority')::integer
              ELSE elem.ord::integer
            END
          )
        ),
        true
      )
      ORDER BY elem.ord
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(COALESCE(p_lines, '[]'::jsonb)) = 'array' THEN COALESCE(p_lines, '[]'::jsonb)
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS elem(item, ord);
$$;

CREATE OR REPLACE FUNCTION public.fee_structures_normalize_line_items_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.line_items := public.normalize_school_fee_line_items(NEW.line_items);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fee_structures_normalize_line_items ON public.fee_structures;
CREATE TRIGGER trg_fee_structures_normalize_line_items
BEFORE INSERT OR UPDATE OF line_items ON public.fee_structures
FOR EACH ROW EXECUTE FUNCTION public.fee_structures_normalize_line_items_trigger();

-- Backfill existing rows so old data gains explicit priorities.
UPDATE public.fee_structures
SET line_items = public.normalize_school_fee_line_items(line_items)
WHERE line_items IS NOT NULL;
