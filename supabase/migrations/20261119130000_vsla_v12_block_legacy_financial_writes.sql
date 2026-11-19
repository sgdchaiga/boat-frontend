-- A v1.2 organization must not be able to bypass its controlled ledger by
-- posting into legacy VSLA financial tables through an old screen or API call.

CREATE OR REPLACE FUNCTION public.vsla_v12_block_legacy_financial_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_org uuid;
BEGIN
  v_org:=coalesce(NEW.organization_id,OLD.organization_id);
  IF EXISTS (SELECT 1 FROM public.vsla_workflow_settings WHERE organization_id=v_org AND workflow_version='v1_2') THEN
    RAISE EXCEPTION 'Legacy VSLA financial posting is disabled for v1.2 organizations; use the controlled v1.2 workflow';
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;

DO $triggers$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'vsla_share_transactions','vsla_loans','vsla_loan_repayments','vsla_fines',
    'vsla_fund_transactions','vsla_cashbox_snapshots','vsla_cycle_shareout',
    'vsla_meeting_transactions','vsla_social_welfare_stamps'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_v12_block_legacy_write ON public.%I',tbl,tbl);
    EXECUTE format('CREATE TRIGGER trg_%s_v12_block_legacy_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.vsla_v12_block_legacy_financial_write()',tbl,tbl);
  END LOOP;
END $triggers$;
