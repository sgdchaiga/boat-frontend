-- Remove ALL savings accounts for one SACCO organization (members are NOT deleted).
-- Use when resetting account numbers before a fresh backfill.
--
-- SET organization_id below, then run in Supabase SQL Editor.

DO $$
DECLARE
  v_organization_id uuid := '00000000-0000-0000-0000-000000000000'; -- <<< REPLACE
  v_deleted int;
BEGIN
  IF v_organization_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Set v_organization_id to your organization UUID before running.';
  END IF;

  DELETE FROM public.sacco_member_savings_accounts
  WHERE organization_id = v_organization_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'Deleted % savings account row(s). Members unchanged. Re-run backfill in Savings settings.', v_deleted;
END $$;
