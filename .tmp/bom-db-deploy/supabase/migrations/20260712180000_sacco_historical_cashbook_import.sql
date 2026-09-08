-- Auditable, idempotent import of legacy SACCO cashbook rows.
CREATE TABLE IF NOT EXISTS public.sacco_historical_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  source_id text,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  cashbook_entry_id uuid REFERENCES public.sacco_cashbook_entries(id) ON DELETE SET NULL,
  imported_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, fingerprint)
);
ALTER TABLE public.sacco_historical_import_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sacco_historical_import_org ON public.sacco_historical_import_items;
CREATE POLICY sacco_historical_import_org ON public.sacco_historical_import_items FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()))
  WITH CHECK (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()));
GRANT SELECT, INSERT ON public.sacco_historical_import_items TO authenticated;
GRANT ALL ON public.sacco_historical_import_items TO service_role;

CREATE OR REPLACE FUNCTION public.import_sacco_historical_cashbook_row(
  p_organization_id uuid, p_fingerprint text, p_row jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff_org uuid; v_entry uuid; v_amount numeric; v_previous numeric; v_kind text;
  v_account uuid; v_loan uuid; v_member uuid; v_direction text;
BEGIN
  SELECT organization_id INTO v_staff_org FROM public.staff WHERE id = auth.uid();
  IF auth.role() <> 'service_role' AND v_staff_org IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sacco_historical_import_items WHERE organization_id=p_organization_id AND fingerprint=p_fingerprint) THEN
    RETURN NULL;
  END IF;
  v_amount := abs(COALESCE((p_row->>'amount')::numeric, 0));
  v_kind := p_row->>'kind'; v_direction := p_row->>'cash_direction';
  v_account := NULLIF(p_row->>'savings_account_id','')::uuid;
  v_loan := NULLIF(p_row->>'loan_id','')::uuid;
  v_member := NULLIF(p_row->>'member_id','')::uuid;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than zero'; END IF;
  IF v_account IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sacco_member_savings_accounts WHERE id=v_account AND organization_id=p_organization_id) THEN RAISE EXCEPTION 'Savings account is outside organization'; END IF;
  IF v_loan IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sacco_loans WHERE id=v_loan AND organization_id=p_organization_id) THEN RAISE EXCEPTION 'Loan is outside organization'; END IF;

  SELECT COALESCE(balance,0) INTO v_previous FROM public.sacco_cashbook_entries
    WHERE organization_id=p_organization_id ORDER BY entry_date DESC, created_at DESC LIMIT 1;
  v_previous := COALESCE(v_previous,0);
  INSERT INTO public.sacco_cashbook_entries(organization_id,entry_date,description,reference,category,sacco_member_id,member_name,debit,credit,balance)
  VALUES (p_organization_id,(p_row->>'entry_date')::date,COALESCE(NULLIF(p_row->>'narration',''),'Historical SACCO import'),
    NULLIF(p_row->>'reference',''),v_kind,v_member,NULLIF(p_row->>'member_name',''),
    CASE WHEN v_direction='in' THEN v_amount ELSE 0 END, CASE WHEN v_direction='out' THEN v_amount ELSE 0 END,
    v_previous + CASE WHEN v_direction='in' THEN v_amount ELSE -v_amount END)
  RETURNING id INTO v_entry;

  IF v_account IS NOT NULL AND v_kind IN ('savings_deposit','share_purchase') THEN
    UPDATE public.sacco_member_savings_accounts SET balance=balance+v_amount WHERE id=v_account;
  ELSIF v_account IS NOT NULL AND v_kind IN ('savings_withdrawal','account_charge') THEN
    UPDATE public.sacco_member_savings_accounts SET balance=balance-v_amount WHERE id=v_account;
  END IF;
  IF v_loan IS NOT NULL AND v_kind='loan_repayment' THEN
    UPDATE public.sacco_loans SET balance=greatest(0,balance-v_amount), paid_amount=paid_amount+least(balance,v_amount), last_payment_date=(p_row->>'entry_date')::date,
      status=CASE WHEN balance-v_amount <= 0 THEN 'closed' ELSE status END WHERE id=v_loan;
  END IF;
  INSERT INTO public.sacco_historical_import_items(organization_id,fingerprint,source_id,source_row,cashbook_entry_id,imported_by)
  VALUES(p_organization_id,p_fingerprint,p_row->>'source_id',p_row,v_entry,auth.uid());
  RETURN v_entry;
END $$;
REVOKE ALL ON FUNCTION public.import_sacco_historical_cashbook_row(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_sacco_historical_cashbook_row(uuid,text,jsonb) TO authenticated, service_role;
