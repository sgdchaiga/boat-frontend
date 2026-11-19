CREATE OR REPLACE FUNCTION public.vsla_v12_my_shareout_estimate()
RETURNS numeric LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(sum((item->>'payout_amount')::numeric),0) FROM public.vsla_v12_shareouts s, jsonb_array_elements(s.payout_schedule) item
 WHERE s.organization_id=public.current_vsla_member_org_id() AND s.status IN('pending_approval','approved') AND item->>'member_id'=public.current_vsla_member_id()::text
$$;
REVOKE ALL ON FUNCTION public.vsla_v12_my_shareout_estimate() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.vsla_v12_my_shareout_estimate() TO authenticated;
