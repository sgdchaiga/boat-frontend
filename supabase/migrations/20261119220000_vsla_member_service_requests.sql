CREATE TABLE IF NOT EXISTS public.vsla_member_service_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 member_id uuid NOT NULL REFERENCES public.vsla_members(id) ON DELETE CASCADE, request_type text NOT NULL CHECK(request_type IN('statement','profile_update','meeting_reminder')), payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','processing','completed','rejected')), created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, completed_by uuid REFERENCES public.staff(id)
);
ALTER TABLE public.vsla_member_service_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY vsla_member_service_requests_self_insert ON public.vsla_member_service_requests FOR INSERT TO authenticated WITH CHECK(member_id=public.current_vsla_member_id() AND organization_id=public.current_vsla_member_org_id());
CREATE POLICY vsla_member_service_requests_read ON public.vsla_member_service_requests FOR SELECT TO authenticated USING(member_id=public.current_vsla_member_id() OR public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
GRANT SELECT,INSERT ON public.vsla_member_service_requests TO authenticated;
