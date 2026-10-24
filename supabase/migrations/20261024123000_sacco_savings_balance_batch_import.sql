-- Batch opening-balance snapshots on the database, avoiding thousands of
-- browser round trips while retaining a per-row result for the import screen.
CREATE OR REPLACE FUNCTION public.import_sacco_savings_balance_batch(
  p_organization_id uuid,
  p_rows jsonb
) RETURNS TABLE(line integer, updated boolean, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff_org uuid;
  v_item jsonb;
  v_account uuid;
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
    line := nullif(v_item->>'line','')::integer;
    updated := false;
    error := null;
    BEGIN
      v_account := nullif(v_item->>'account_id','')::uuid;
      UPDATE public.sacco_member_savings_accounts
      SET balance = (v_item->>'new_balance')::numeric,
          balance_as_at = (v_item->>'balance_as_at')::date,
          savings_product_code = coalesce(nullif(v_item->>'new_product_code',''), savings_product_code),
          updated_at = now()
      WHERE id = v_account AND organization_id = p_organization_id;
      IF NOT FOUND THEN
        error := 'Savings account is no longer available in this organization';
      ELSE
        updated := true;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      error := SQLERRM;
    END;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.import_sacco_savings_balance_batch(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_sacco_savings_balance_batch(uuid,jsonb) TO authenticated, service_role;
