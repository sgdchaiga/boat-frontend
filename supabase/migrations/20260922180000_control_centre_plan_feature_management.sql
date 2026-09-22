-- Allow platform administrators to manage feature availability on subscription plans.
-- The read policy was created with the Control Centre foundation migration; this
-- additional policy deliberately limits writes to platform administrators.
CREATE POLICY control_plan_features_manage
  ON public.subscription_plan_features
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());
