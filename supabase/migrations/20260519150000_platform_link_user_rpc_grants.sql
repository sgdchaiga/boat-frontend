-- Platform super-user link + ensure organization_members is API-visible.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_active_organization TO authenticated;

-- Function body lives in 20260519160000_ensure_platform_link_organization_member.sql
-- (this file only grants table access so it can run before the RPC exists).
