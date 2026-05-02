-- Superadmin controls for automatic clearing enrollment.
-- These fields live in BOAT operational DB and map to identities in the separate clearing DB.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS clearing_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clearing_status text NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS clearing_org_sacco_id uuid,
  ADD COLUMN IF NOT EXISTS clearing_synced_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.organizations'::regclass
      AND conname = 'organizations_clearing_status_chk'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_clearing_status_chk
      CHECK (clearing_status IN ('inactive', 'active', 'suspended', 'pending'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.organizations.clearing_enabled IS
  'Superadmin switch: if false, BOAT does not route tenant transactions into clearing engine.';
COMMENT ON COLUMN public.organizations.clearing_status IS
  'Operational state in BOAT for clearing account usage.';
COMMENT ON COLUMN public.organizations.clearing_org_sacco_id IS
  'Primary SACCO identity for this BOAT org inside the separate clearing DB.';
COMMENT ON COLUMN public.organizations.clearing_synced_at IS
  'Last timestamp BOAT synced/created clearing account mapping.';
