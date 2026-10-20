-- Consolidate duplicate suppliers without losing their transaction history.
-- The master vendor is retained; every foreign-key reference to the duplicate is
-- moved in the same transaction before the duplicate row is removed.

CREATE TABLE IF NOT EXISTS public.vendor_merge_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  master_vendor_id uuid NOT NULL,
  merged_vendor_id uuid NOT NULL,
  merged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  moved_references jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_merge_audit_distinct_vendors CHECK (master_vendor_id <> merged_vendor_id)
);

ALTER TABLE public.vendor_merge_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_merge_audit_select_same_org ON public.vendor_merge_audit;
CREATE POLICY vendor_merge_audit_select_same_org ON public.vendor_merge_audit
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id = vendor_merge_audit.organization_id
        AND om.is_active
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.vendor_merge_audit FROM authenticated;
GRANT SELECT ON public.vendor_merge_audit TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_vendors(
  p_master_vendor_id uuid,
  p_duplicate_vendor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_master public.vendors%ROWTYPE;
  v_duplicate public.vendors%ROWTYPE;
  v_reference record;
  v_moved jsonb := '{}'::jsonb;
  v_count integer;
  v_allowed boolean;
BEGIN
  IF p_master_vendor_id IS NULL OR p_duplicate_vendor_id IS NULL
     OR p_master_vendor_id = p_duplicate_vendor_id THEN
    RAISE EXCEPTION 'Choose two different vendors to merge.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_master FROM public.vendors WHERE id = p_master_vendor_id FOR UPDATE;
  SELECT * INTO v_duplicate FROM public.vendors WHERE id = p_duplicate_vendor_id FOR UPDATE;
  IF NOT FOUND OR v_master.id IS NULL OR v_duplicate.id IS NULL THEN
    RAISE EXCEPTION 'One or both vendors could not be found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_master.organization_id IS DISTINCT FROM v_duplicate.organization_id THEN
    RAISE EXCEPTION 'Vendors can only be merged within the same organization.' USING ERRCODE = '22023';
  END IF;

  SELECT public.is_platform_admin() OR EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = v_master.organization_id
      AND om.is_active
      AND lower(coalesce(om.role::text, '')) IN ('admin', 'super_admin')
  ) INTO v_allowed;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Only an Administrator or Super Admin can merge vendors.' USING ERRCODE = '42501';
  END IF;

  -- Discover every FK referencing vendors so new vendor-linked tables are also
  -- protected by this merge without needing a separate application deployment.
  FOR v_reference IN
    SELECT ns.nspname AS schema_name, cls.relname AS table_name, att.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY AS key(attnum, ordinality) ON true
    JOIN pg_attribute att ON att.attrelid = cls.oid AND att.attnum = key.attnum
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.vendors'::regclass
      AND ns.nspname = 'public'
  LOOP
    EXECUTE format('UPDATE %I.%I SET %I = $1 WHERE %I = $2',
      v_reference.schema_name, v_reference.table_name,
      v_reference.column_name, v_reference.column_name)
      USING p_master_vendor_id, p_duplicate_vendor_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_moved := v_moved || jsonb_build_object(
      v_reference.table_name || '.' || v_reference.column_name, v_count
    );
  END LOOP;

  DELETE FROM public.vendors WHERE id = p_duplicate_vendor_id;

  INSERT INTO public.vendor_merge_audit (
    organization_id, master_vendor_id, merged_vendor_id, merged_by, moved_references
  ) VALUES (
    v_master.organization_id, p_master_vendor_id, p_duplicate_vendor_id, auth.uid(), v_moved
  );

  RETURN jsonb_build_object(
    'master_vendor_id', p_master_vendor_id,
    'merged_vendor_id', p_duplicate_vendor_id,
    'moved_references', v_moved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_vendors(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_vendors(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.merge_vendors(uuid, uuid) IS
  'Admin-only atomic vendor merge. Retains the master and redirects all vendor foreign keys from the duplicate.';
