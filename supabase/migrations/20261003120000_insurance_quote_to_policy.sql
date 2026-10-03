-- Agency Phase 1 continuation: selection, payment and policy issuance controls.
ALTER TABLE public.insurance_quote_options
  ADD COLUMN IF NOT EXISTS customer_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS terms_reference text,
  ADD COLUMN IF NOT EXISTS valid_until date;
ALTER TABLE public.insurance_quotes
  ADD COLUMN IF NOT EXISTS selected_option_id uuid REFERENCES public.insurance_quote_options(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS selected_at timestamptz,
  ADD COLUMN IF NOT EXISTS kyc_status text NOT NULL DEFAULT 'not_required' CHECK(kyc_status IN ('not_required','pending','submitted','verified','rejected')),
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'not_requested' CHECK(payment_status IN ('not_requested','pending','processing','paid','failed','cancelled'));
ALTER TABLE public.insurance_payments
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.insurance_quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS routing_instruction text,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE public.insurance_policies
  ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS certificate_path text;

CREATE OR REPLACE FUNCTION public.insurance_select_quote_option(p_quote_id uuid, p_option_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.insurance_quotes WHERE id=p_quote_id FOR UPDATE;
  IF v_org IS NULL OR NOT public.insurance_org_access(v_org) THEN RAISE EXCEPTION 'Insurance quote is not available'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.insurance_quote_options WHERE id=p_option_id AND quote_id=p_quote_id AND customer_visible) THEN RAISE EXCEPTION 'Quote option is not available'; END IF;
  UPDATE public.insurance_quote_options SET selected=(id=p_option_id) WHERE quote_id=p_quote_id;
  UPDATE public.insurance_quotes SET selected_option_id=p_option_id, selected_at=now(), status='accepted', kyc_status='pending', payment_status='pending' WHERE id=p_quote_id;
  UPDATE public.insurance_leads SET stage='customer_selected', last_activity_at=now() WHERE id=(SELECT lead_id FROM public.insurance_quotes WHERE id=p_quote_id);
END $$;
GRANT EXECUTE ON FUNCTION public.insurance_select_quote_option(uuid,uuid) TO authenticated;
