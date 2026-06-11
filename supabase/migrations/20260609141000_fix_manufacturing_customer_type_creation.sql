CREATE OR REPLACE FUNCTION public.create_manufacturing_customer_type(p_name text)
RETURNS public.manufacturing_customer_types
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_row public.manufacturing_customer_types;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM public.staff
  WHERE id = auth.uid();

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Your staff account is not linked to an organization.';
  END IF;

  IF trim(coalesce(p_name, '')) = '' THEN
    RAISE EXCEPTION 'Customer type name is required.';
  END IF;

  INSERT INTO public.manufacturing_customer_types (organization_id, name)
  VALUES (v_org_id, trim(p_name))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_manufacturing_customer_type(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_manufacturing_customer_type(text) TO authenticated;
