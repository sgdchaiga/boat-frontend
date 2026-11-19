-- Phase 3: start conservatively with one designated offline collection device per group.
CREATE TABLE IF NOT EXISTS public.vsla_v12_offline_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  device_name text NOT NULL CHECK (char_length(trim(device_name)) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  designated_by uuid NOT NULL REFERENCES public.staff(id),
  designated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(organization_id, device_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vsla_v12_one_active_offline_device
  ON public.vsla_v12_offline_devices(organization_id) WHERE status='active';
ALTER TABLE public.vsla_v12_offline_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vsla_v12_offline_devices FROM authenticated;

CREATE OR REPLACE FUNCTION public.vsla_v12_designate_offline_device(p_device_id uuid,p_device_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_name text;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
  IF v_org IS NULL OR NOT EXISTS(SELECT 1 FROM public.vsla_workflow_settings WHERE organization_id=v_org AND workflow_version='v1_2') THEN RAISE EXCEPTION 'VSLA v1.2 is not enabled for this organization'; END IF;
  IF NOT public.vsla_v12_actor_has_role(v_org,NULL,ARRAY['chairperson','treasurer','secretary']) THEN RAISE EXCEPTION 'Your VSLA role cannot designate an offline device'; END IF;
  v_name:=nullif(trim(coalesce(p_device_name,'')), '');
  IF p_device_id IS NULL OR v_name IS NULL THEN RAISE EXCEPTION 'A device name is required'; END IF;
  UPDATE public.vsla_v12_offline_devices SET status='revoked',revoked_at=now() WHERE organization_id=v_org AND status='active' AND device_id<>p_device_id;
  INSERT INTO public.vsla_v12_offline_devices(organization_id,device_id,device_name,status,designated_by,designated_at,revoked_at)
  VALUES(v_org,p_device_id,v_name,'active',auth.uid(),now(),NULL)
  ON CONFLICT(organization_id,device_id) DO UPDATE SET device_name=EXCLUDED.device_name,status='active',designated_by=EXCLUDED.designated_by,designated_at=now(),revoked_at=NULL;
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_is_offline_device_designated(p_device_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.vsla_v12_offline_devices d
    WHERE d.organization_id=public.auth_staff_org_id() AND d.device_id=p_device_id AND d.status='active'
  )
$$;

CREATE OR REPLACE FUNCTION public.vsla_v12_sync_offline_collection(
  p_device_id uuid,p_meeting_id uuid,p_member_id uuid,p_kind text,p_shares integer,p_amount numeric,p_idempotency_key uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.vsla_v12_is_offline_device_designated(p_device_id) THEN RAISE EXCEPTION 'This device is not designated for VSLA offline collection sync'; END IF;
  IF p_kind='savings' THEN RETURN public.vsla_v12_receive_savings(p_meeting_id,p_member_id,p_shares,p_idempotency_key); END IF;
  IF p_kind='fine' THEN RETURN public.vsla_v12_receive_member_collection(p_meeting_id,p_member_id,'fine_received',p_amount,p_idempotency_key); END IF;
  IF p_kind='social' THEN RETURN public.vsla_v12_receive_member_collection(p_meeting_id,p_member_id,'social_fund_received',p_amount,p_idempotency_key); END IF;
  RAISE EXCEPTION 'Unsupported offline collection type';
END $$;

REVOKE ALL ON FUNCTION public.vsla_v12_designate_offline_device(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vsla_v12_is_offline_device_designated(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vsla_v12_sync_offline_collection(uuid,uuid,uuid,text,integer,numeric,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_designate_offline_device(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vsla_v12_is_offline_device_designated(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vsla_v12_sync_offline_collection(uuid,uuid,uuid,text,integer,numeric,uuid) TO authenticated;
