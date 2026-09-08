-- Allow platform super users to read all staff (organization dashboard counts)
CREATE POLICY "platform_admin_staff_select"
  ON public.staff FOR SELECT TO authenticated
  USING (public.is_platform_admin());
