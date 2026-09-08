CREATE TABLE IF NOT EXISTS public.mobile_performance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('startup', 'slow_resource', 'request_failed', 'app_error', 'offline', 'sync_failed')),
  duration_ms integer NULL CHECK (duration_ms IS NULL OR duration_ms >= 0),
  page text NULL,
  network_type text NULL,
  device_class text NOT NULL DEFAULT 'phone',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mobile_performance_events_org_created_idx
  ON public.mobile_performance_events (organization_id, created_at DESC);

ALTER TABLE public.mobile_performance_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mobile_performance_insert ON public.mobile_performance_events;
CREATE POLICY mobile_performance_insert ON public.mobile_performance_events
  FOR INSERT WITH CHECK (public.user_is_member_of_org(organization_id));

DROP POLICY IF EXISTS mobile_performance_admin_read ON public.mobile_performance_events;
CREATE POLICY mobile_performance_admin_read ON public.mobile_performance_events
  FOR SELECT USING (
    public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.organization_id = mobile_performance_events.organization_id
        AND lower(coalesce(s.role::text, '')) IN ('admin', 'manager', 'super_admin')
    )
  );

GRANT INSERT ON public.mobile_performance_events TO authenticated;
GRANT SELECT ON public.mobile_performance_events TO authenticated;
