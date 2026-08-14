-- Logo on printed guest bills; optional RPC for tenant staff to update bill header fields on their organization.

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url text;

COMMENT ON COLUMN public.organizations.logo_url IS 'HTTPS URL to organization logo (guest bill / print).';

CREATE OR REPLACE FUNCTION public.save_organization_guest_bill_profile(p_address text, p_logo_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  oid uuid;
BEGIN
  SELECT s.organization_id INTO oid FROM public.staff s WHERE s.id = auth.uid();
  IF oid IS NULL THEN
    RAISE EXCEPTION 'No organization for current user';
  END IF;

  UPDATE public.organizations
  SET
    address = NULLIF(TRIM(p_address), ''),
    logo_url = NULLIF(TRIM(p_logo_url), '')
  WHERE id = oid;
END;
$$;

REVOKE ALL ON FUNCTION public.save_organization_guest_bill_profile(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_organization_guest_bill_profile(text, text) TO authenticated;

COMMENT ON FUNCTION public.save_organization_guest_bill_profile(text, text) IS
  'Tenant staff: set organizations.address and organizations.logo_url for own organization (guest bill print).';
