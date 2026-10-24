-- Server-side batching avoids thousands of client round trips while keeping the
-- legacy running balance deterministic (each row is still processed in order).
CREATE OR REPLACE FUNCTION public.import_sacco_historical_cashbook_batch(
  p_organization_id uuid,
  p_rows jsonb
) RETURNS TABLE(row_index integer, imported boolean, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff_org uuid;
  v_item jsonb;
  v_index integer := 0;
  v_entry uuid;
BEGIN
  SELECT organization_id INTO v_staff_org FROM public.staff WHERE id = auth.uid();
  IF auth.role() <> 'service_role' AND v_staff_org IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'At least one import row is required';
  END IF;
  IF jsonb_array_length(p_rows) > 250 THEN
    RAISE EXCEPTION 'A batch cannot exceed 250 rows';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    BEGIN
      v_entry := public.import_sacco_historical_cashbook_row(
        p_organization_id,
        v_item->>'fingerprint',
        v_item->'row'
      );
      row_index := v_index;
      imported := v_entry IS NOT NULL;
      error := NULL;
    EXCEPTION WHEN OTHERS THEN
      row_index := v_index;
      imported := false;
      error := SQLERRM;
    END;
    RETURN NEXT;
    v_index := v_index + 1;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.import_sacco_historical_cashbook_batch(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_sacco_historical_cashbook_batch(uuid,jsonb) TO authenticated, service_role;
