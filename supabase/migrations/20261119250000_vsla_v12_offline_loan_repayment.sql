-- Phase 3: permit only routine repayments from the designated offline meeting device.
CREATE OR REPLACE FUNCTION public.vsla_v12_sync_offline_loan_repayment(
  p_device_id uuid,p_meeting_id uuid,p_loan_id uuid,p_amount numeric,p_idempotency_key uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.vsla_v12_is_offline_device_designated(p_device_id) THEN RAISE EXCEPTION 'This device is not designated for VSLA offline repayment sync'; END IF;
  RETURN public.vsla_v12_receive_loan_repayment(p_meeting_id,p_loan_id,p_amount,p_idempotency_key);
END $$;

REVOKE ALL ON FUNCTION public.vsla_v12_sync_offline_loan_repayment(uuid,uuid,uuid,numeric,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_sync_offline_loan_repayment(uuid,uuid,uuid,numeric,uuid) TO authenticated;
