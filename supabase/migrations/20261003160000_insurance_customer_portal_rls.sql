-- Customer portal access parallels SACCO member access: portal identities are never staff members.
ALTER TABLE public.insurance_customer_portal_access
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'invited' CHECK(status IN ('invited','active','suspended','revoked')),
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

CREATE POLICY insurance_portal_quotes_read ON public.insurance_quotes FOR SELECT TO authenticated
USING (public.is_insurance_customer(customer_id));
CREATE POLICY insurance_portal_policies_read ON public.insurance_policies FOR SELECT TO authenticated
USING (public.is_insurance_customer(customer_id));
CREATE POLICY insurance_portal_options_read ON public.insurance_quote_options FOR SELECT TO authenticated
USING (customer_visible AND EXISTS (SELECT 1 FROM public.insurance_quotes q WHERE q.id=quote_id AND public.is_insurance_customer(q.customer_id)));
CREATE POLICY insurance_portal_documents_read ON public.insurance_documents FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.insurance_policies p WHERE p.id=policy_id AND public.is_insurance_customer(p.customer_id)));

CREATE OR REPLACE FUNCTION public.insurance_portal_mark_login()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE public.insurance_customer_portal_access SET status='active',last_login_at=now() WHERE auth_user_id=auth.uid() AND status='invited';
$$;
GRANT EXECUTE ON FUNCTION public.insurance_portal_mark_login() TO authenticated;
