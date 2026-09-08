-- Links each BOAT tenant (organization) to SACCO identities in the *separate* clearing Supabase project.
-- Cannot use FK to clearing DB — store UUID references only.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS clearing_default_payer_sacco_id uuid,
  ADD COLUMN IF NOT EXISTS clearing_merchant_sacco_id uuid;

COMMENT ON COLUMN public.organizations.clearing_default_payer_sacco_id IS
  'Debited SACCO in inter-SACCO retail settlement (e.g. member/parent SACCO). Points to clearing DB saccos.id.';
COMMENT ON COLUMN public.organizations.clearing_merchant_sacco_id IS
  'Credited SACCO for this organization’s retail receipts. Points to clearing DB saccos.id.';
