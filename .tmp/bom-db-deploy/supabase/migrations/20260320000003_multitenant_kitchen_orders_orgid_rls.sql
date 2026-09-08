-- Multi-tenant isolation for POS / kitchen_orders:
-- These tables were not covered by hotel RLS; without org columns + policies, all tenants see all orders.

-- 1) Columns on kitchen_orders
ALTER TABLE public.kitchen_orders
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

-- 2) Backfill organization_id
UPDATE public.kitchen_orders ko
SET organization_id = s.organization_id
FROM public.staff s
WHERE ko.created_by = s.id
  AND ko.organization_id IS NULL
  AND s.organization_id IS NOT NULL;

UPDATE public.kitchen_orders ko
SET organization_id = rm.organization_id
FROM public.rooms rm
WHERE ko.room_id = rm.id
  AND ko.organization_id IS NULL
  AND rm.organization_id IS NOT NULL;

-- 3) Trigger: default org from logged-in staff (same pattern as hotel tables)
DROP TRIGGER IF EXISTS trg_set_org_kitchen_orders ON public.kitchen_orders;
CREATE TRIGGER trg_set_org_kitchen_orders
BEFORE INSERT ON public.kitchen_orders
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

-- 4) Remove any existing policies so we don't stack permissive + restrictive rules
DO $$
DECLARE
  r record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'kitchen_orders'
  ) THEN
    FOR r IN (
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'kitchen_orders'
    ) LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.kitchen_orders', r.policyname);
    END LOOP;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'kitchen_order_items'
  ) THEN
    FOR r IN (
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'kitchen_order_items'
    ) LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.kitchen_order_items', r.policyname);
    END LOOP;
  END IF;
END $$;

-- 5) RLS: kitchen_orders
ALTER TABLE public.kitchen_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kitchen_orders_select_same_org"
  ON public.kitchen_orders FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "kitchen_orders_insert_same_org"
  ON public.kitchen_orders FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "kitchen_orders_update_same_org"
  ON public.kitchen_orders FOR UPDATE
  TO authenticated
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

CREATE POLICY "kitchen_orders_delete_same_org"
  ON public.kitchen_orders FOR DELETE
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "platform_admin_kitchen_orders_all"
  ON public.kitchen_orders FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- 6) RLS: kitchen_order_items (tenant via parent order); skip if table missing
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'kitchen_order_items'
  ) THEN
    ALTER TABLE public.kitchen_order_items ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "kitchen_order_items_select_same_org"
      ON public.kitchen_order_items FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.kitchen_orders ko
          WHERE ko.id = kitchen_order_items.order_id
            AND ko.organization_id IS NOT NULL
            AND ko.organization_id = (
              SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
            )
        )
      );

    CREATE POLICY "kitchen_order_items_insert_same_org"
      ON public.kitchen_order_items FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.kitchen_orders ko
          WHERE ko.id = kitchen_order_items.order_id
            AND ko.organization_id IS NOT NULL
            AND ko.organization_id = (
              SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
            )
        )
      );

    CREATE POLICY "kitchen_order_items_update_same_org"
      ON public.kitchen_order_items FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.kitchen_orders ko
          WHERE ko.id = kitchen_order_items.order_id
            AND ko.organization_id IS NOT NULL
            AND ko.organization_id = (
              SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
            )
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.kitchen_orders ko
          WHERE ko.id = kitchen_order_items.order_id
            AND ko.organization_id IS NOT NULL
            AND ko.organization_id = (
              SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
            )
        )
      );

    CREATE POLICY "kitchen_order_items_delete_same_org"
      ON public.kitchen_order_items FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.kitchen_orders ko
          WHERE ko.id = kitchen_order_items.order_id
            AND ko.organization_id IS NOT NULL
            AND ko.organization_id = (
              SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
            )
        )
      );

    CREATE POLICY "platform_admin_kitchen_order_items_all"
      ON public.kitchen_order_items FOR ALL
      TO authenticated
      USING (public.is_platform_admin())
      WITH CHECK (public.is_platform_admin());
  END IF;
END $$;
