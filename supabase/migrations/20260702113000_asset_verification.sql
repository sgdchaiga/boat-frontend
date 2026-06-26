-- Physical asset verification for accounting-practice clients and opted-in BOAT organizations.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enable_asset_verification boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.enable_asset_verification IS
  'Platform-controlled for non-accounting-practice organizations. Accounting practices always have access.';

CREATE TABLE IF NOT EXISTS public.asset_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Asset verification',
  verification_date date NOT NULL DEFAULT current_date,
  source_mode text NOT NULL DEFAULT 'upload' CHECK (source_mode IN ('upload', 'system_register')),
  source_file text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved')),
  prepared_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.asset_verification_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id uuid NOT NULL REFERENCES public.asset_verifications(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_asset_id uuid REFERENCES public.fixed_assets(id) ON DELETE SET NULL,
  asset_code text NOT NULL,
  barcode text,
  asset_name text NOT NULL,
  category text,
  expected_location text,
  expected_custodian text,
  system_quantity numeric(18,4) NOT NULL DEFAULT 1,
  observed_quantity numeric(18,4),
  book_value numeric(18,2) NOT NULL DEFAULT 0,
  observed_present boolean,
  observed_condition text CHECK (observed_condition IS NULL OR observed_condition IN ('good', 'fair', 'poor', 'damaged')),
  observed_location text,
  observed_custodian text,
  notes text,
  verified_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  verified_by_name text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (verification_id, asset_code)
);

ALTER TABLE public.asset_verification_items
  ADD COLUMN IF NOT EXISTS system_quantity numeric(18,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS observed_quantity numeric(18,4);

CREATE INDEX IF NOT EXISTS idx_asset_verifications_org_date
  ON public.asset_verifications (organization_id, verification_date DESC);
CREATE INDEX IF NOT EXISTS idx_asset_verifications_client_date
  ON public.asset_verifications (client_id, verification_date DESC);
CREATE INDEX IF NOT EXISTS idx_asset_verification_items_session
  ON public.asset_verification_items (verification_id, asset_name);
CREATE INDEX IF NOT EXISTS idx_asset_verification_items_barcode
  ON public.asset_verification_items (verification_id, barcode);

ALTER TABLE public.asset_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_verification_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_verifications_org_access ON public.asset_verifications;
CREATE POLICY asset_verifications_org_access ON public.asset_verifications FOR ALL TO authenticated
USING (
  public.is_platform_admin()
  OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = organization_id
      AND (o.business_type = 'accounting_practice' OR o.enable_asset_verification = true)
  )
)
WITH CHECK (
  public.is_platform_admin()
  OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = organization_id
      AND (o.business_type = 'accounting_practice' OR o.enable_asset_verification = true)
  )
);

DROP POLICY IF EXISTS asset_verification_items_org_access ON public.asset_verification_items;
CREATE POLICY asset_verification_items_org_access ON public.asset_verification_items FOR ALL TO authenticated
USING (
  public.is_platform_admin()
  OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = organization_id
      AND (o.business_type = 'accounting_practice' OR o.enable_asset_verification = true)
  )
)
WITH CHECK (
  public.is_platform_admin()
  OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = organization_id
      AND (o.business_type = 'accounting_practice' OR o.enable_asset_verification = true)
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_verifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_verification_items TO authenticated;
