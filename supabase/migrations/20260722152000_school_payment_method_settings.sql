-- Per-school payment methods configured by tenant administrators.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS school_payment_methods text[] NOT NULL
  DEFAULT ARRAY['cash','mobile_money','bank','transfer','school_pay','wallet','other']::text[];

CREATE OR REPLACE FUNCTION public.save_school_payment_methods(p_methods text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE oid uuid; cleaned text[];
BEGIN
  SELECT organization_id INTO oid FROM public.staff WHERE id = auth.uid();
  IF oid IS NULL THEN RAISE EXCEPTION 'No organization for current user'; END IF;
  SELECT array_agg(DISTINCT m) INTO cleaned
  FROM unnest(COALESCE(p_methods, ARRAY[]::text[])) m
  WHERE m IN ('cash','mobile_money','bank','transfer','school_pay','wallet','other');
  IF COALESCE(array_length(cleaned, 1), 0) = 0 THEN RAISE EXCEPTION 'Enable at least one payment method'; END IF;
  UPDATE public.organizations SET school_payment_methods=cleaned WHERE id=oid;
END; $$;
REVOKE ALL ON FUNCTION public.save_school_payment_methods(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_school_payment_methods(text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_school_payment_method_enabled()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE enabled text[];
BEGIN
  SELECT school_payment_methods INTO enabled FROM public.organizations WHERE id=NEW.organization_id;
  IF enabled IS NOT NULL AND NOT (NEW.method = ANY(enabled)) THEN
    RAISE EXCEPTION 'Payment method % is disabled for this organization', NEW.method;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_school_payment_method_enabled ON public.school_payments;
CREATE TRIGGER trg_school_payment_method_enabled BEFORE INSERT OR UPDATE OF method,organization_id ON public.school_payments
FOR EACH ROW EXECUTE FUNCTION public.enforce_school_payment_method_enabled();
