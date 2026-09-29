CREATE OR REPLACE FUNCTION public.reverse_school_fee_payment(p_payment_id uuid, p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payment_row public.school_payments%ROWTYPE;
  allocation jsonb;
  restored numeric(18,2);
BEGIN
  SELECT * INTO payment_row FROM public.school_payments WHERE id = p_payment_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fee payment was not found.'; END IF;
  FOR allocation IN SELECT value FROM jsonb_array_elements(COALESCE(payment_row.invoice_allocations, '[]'::jsonb)) LOOP
    UPDATE public.student_invoices
      SET amount_paid = GREATEST(0, amount_paid - COALESCE((allocation->>'amount')::numeric, 0)),
          status = CASE WHEN GREATEST(0, amount_paid - COALESCE((allocation->>'amount')::numeric, 0)) >= total_due THEN 'paid'
                        WHEN GREATEST(0, amount_paid - COALESCE((allocation->>'amount')::numeric, 0)) > 0 THEN 'partial'
                        ELSE 'sent' END
      WHERE id = (allocation->>'invoice_id')::uuid AND organization_id = p_organization_id;
  END LOOP;
  DELETE FROM public.journal_entries WHERE organization_id = p_organization_id AND reference_type = 'school_payment' AND reference_id = p_payment_id;
  DELETE FROM public.school_payments WHERE id = p_payment_id AND organization_id = p_organization_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reverse_school_fee_payment(uuid, uuid) TO authenticated;
