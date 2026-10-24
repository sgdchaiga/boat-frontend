-- Posts one auditable opening journal from imported member savings balances.
-- The source accounts retain their individual balance_as_at dates; the journal
-- is idempotent for an organization and reporting date.
CREATE TABLE IF NOT EXISTS public.sacco_savings_opening_balance_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  as_at_date date NOT NULL,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  total_amount numeric NOT NULL CHECK(total_amount > 0),
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  posted_by uuid REFERENCES public.staff(id),
  posted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, as_at_date)
);
ALTER TABLE public.sacco_savings_opening_balance_postings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sacco_savings_opening_postings_org ON public.sacco_savings_opening_balance_postings;
CREATE POLICY sacco_savings_opening_postings_org ON public.sacco_savings_opening_balance_postings FOR SELECT TO authenticated USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT ON public.sacco_savings_opening_balance_postings TO authenticated;

CREATE OR REPLACE FUNCTION public.post_sacco_savings_opening_balances(p_as_at_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_staff public.staff%ROWTYPE; v_posting uuid; v_journal uuid; v_debit uuid;
  v_code text; v_gl_code text; v_credit uuid; v_amount numeric; v_total numeric:=0;
  v_lines jsonb:='[]'::jsonb; v_breakdown jsonb:='{}'::jsonb;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE id=auth.uid();
  IF NOT FOUND OR lower(coalesce(v_staff.role,'')) NOT IN ('accountant','manager','admin','super_admin') THEN
    RAISE EXCEPTION 'Only authorized finance staff can post opening balances';
  END IF;
  IF p_as_at_date IS NULL THEN RAISE EXCEPTION 'An as-at date is required'; END IF;
  SELECT id INTO v_debit FROM public.gl_accounts WHERE organization_id=v_staff.organization_id AND account_code='8040' AND is_active LIMIT 1;
  IF v_debit IS NULL THEN RAISE EXCEPTION 'GL account 8040 Opening Balance Clearing Account is not configured'; END IF;
  FOR v_code,v_gl_code IN SELECT * FROM (VALUES ('11','21011'),('12','21012'),('13','21013'),('14','21014')) AS x(product_code,gl_code) LOOP
    SELECT id INTO v_credit FROM public.gl_accounts WHERE organization_id=v_staff.organization_id AND account_code=v_gl_code AND is_active LIMIT 1;
    IF v_credit IS NULL THEN RAISE EXCEPTION 'GL account % is not configured', v_gl_code; END IF;
    SELECT coalesce(sum(balance),0) INTO v_amount FROM public.sacco_member_savings_accounts
      WHERE organization_id=v_staff.organization_id AND is_active AND balance_as_at=p_as_at_date AND savings_product_code=v_code;
    IF v_amount < 0 THEN RAISE EXCEPTION 'Product % has a negative opening balance; correct it before posting', v_code; END IF;
    IF v_amount <> 0 THEN
      v_total:=v_total+v_amount;
      v_breakdown:=v_breakdown || jsonb_build_object(v_code,jsonb_build_object('gl_code',v_gl_code,'amount',v_amount));
      v_lines:=v_lines || jsonb_build_array(jsonb_build_object('gl_account_id',v_credit,'debit',0,'credit',v_amount,'line_description','Opening member savings · product '||v_code));
    END IF;
  END LOOP;
  IF v_total <= 0 THEN RAISE EXCEPTION 'No positive product 11–14 savings balances were imported as at %',p_as_at_date; END IF;
  INSERT INTO public.sacco_savings_opening_balance_postings(organization_id,as_at_date,total_amount,breakdown,posted_by)
    VALUES(v_staff.organization_id,p_as_at_date,v_total,v_breakdown,auth.uid()) RETURNING id INTO v_posting;
  v_lines:=jsonb_build_array(jsonb_build_object('gl_account_id',v_debit,'debit',v_total,'credit',0,'line_description','Opening member savings clearing')) || v_lines;
  v_journal:=public.create_journal_entry_atomic(p_as_at_date,'Opening member savings balances as at '||p_as_at_date,'sacco_savings_opening_balance',v_posting,auth.uid(),v_lines,v_staff.organization_id);
  UPDATE public.journal_entries SET is_posted=true,is_deleted=false WHERE id=v_journal;
  UPDATE public.sacco_savings_opening_balance_postings SET journal_entry_id=v_journal WHERE id=v_posting;
  PERFORM public.record_financial_event('sacco_savings_opening_balance_posted',p_as_at_date,'sacco_savings_opening_balance_postings',v_posting,v_journal,v_breakdown);
  RETURN v_journal;
EXCEPTION WHEN unique_violation THEN
  SELECT journal_entry_id INTO v_journal FROM public.sacco_savings_opening_balance_postings WHERE organization_id=v_staff.organization_id AND as_at_date=p_as_at_date;
  RETURN v_journal;
END;
$$;
REVOKE ALL ON FUNCTION public.post_sacco_savings_opening_balances(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_sacco_savings_opening_balances(date) TO authenticated;
