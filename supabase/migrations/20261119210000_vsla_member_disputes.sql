CREATE TABLE IF NOT EXISTS public.vsla_member_disputes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 member_id uuid NOT NULL REFERENCES public.vsla_members(id) ON DELETE CASCADE, subject text NOT NULL, details text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','reviewing','resolved','rejected')), created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, resolved_by uuid REFERENCES public.staff(id)
);
ALTER TABLE public.vsla_member_disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY vsla_member_disputes_self_insert ON public.vsla_member_disputes FOR INSERT TO authenticated WITH CHECK(member_id=public.current_vsla_member_id() AND organization_id=public.current_vsla_member_org_id());
CREATE POLICY vsla_member_disputes_self_read ON public.vsla_member_disputes FOR SELECT TO authenticated USING(member_id=public.current_vsla_member_id() OR public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
GRANT SELECT,INSERT ON public.vsla_member_disputes TO authenticated;
