-- Merge any number of selected duplicate suppliers in one transaction. The
-- existing single-record function retains its audit trail and dynamically moves
-- every foreign key that points to vendors.
CREATE OR REPLACE FUNCTION public.merge_multiple_vendors(
  p_master_vendor_id uuid,
  p_duplicate_vendor_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duplicate_id uuid;
  v_duplicate_ids uuid[];
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF p_master_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Choose a master vendor to keep.' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT duplicate.id) INTO v_duplicate_ids
  FROM unnest(coalesce(p_duplicate_vendor_ids, ARRAY[]::uuid[])) AS duplicate(id)
  WHERE duplicate.id IS NOT NULL AND duplicate.id <> p_master_vendor_id;

  IF coalesce(array_length(v_duplicate_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Select at least one other vendor to merge.' USING ERRCODE = '22023';
  END IF;

  -- Each call is part of this outer transaction: if any selected record cannot
  -- be merged, Postgres rolls back every preceding merge in the batch.
  FOREACH v_duplicate_id IN ARRAY v_duplicate_ids LOOP
    v_result := v_result || jsonb_build_array(
      public.merge_vendors(p_master_vendor_id, v_duplicate_id)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'master_vendor_id', p_master_vendor_id,
    'merged_count', array_length(v_duplicate_ids, 1),
    'merges', v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_multiple_vendors(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_multiple_vendors(uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.merge_multiple_vendors(uuid, uuid[]) IS
  'Admin-only atomic bulk vendor merge. Keeps the selected master and merges every selected duplicate.';
