CREATE TABLE IF NOT EXISTS public.general_business_cashbook_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  posted_at timestamptz NOT NULL DEFAULT now(),
  transaction_date date NOT NULL,
  headquarters text,
  payment_method text NOT NULL CHECK (payment_method IN ('cash','mobile_money','bank_transfer','card','wallet')),
  description text NOT NULL,
  supplier_name text,
  customer_name text,
  counterpart_gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  cash_gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  cash_in numeric(15,2) NOT NULL DEFAULT 0 CHECK (cash_in >= 0),
  cash_out numeric(15,2) NOT NULL DEFAULT 0 CHECK (cash_out >= 0),
  reference text,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((cash_in > 0 AND cash_out = 0) OR (cash_out > 0 AND cash_in = 0))
);

CREATE INDEX IF NOT EXISTS idx_gb_cashbook_org_date
  ON public.general_business_cashbook_entries (organization_id, transaction_date DESC);

ALTER TABLE public.general_business_cashbook_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gb_cashbook_same_org" ON public.general_business_cashbook_entries
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.organization_id = organization_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.organization_id = organization_id));

CREATE OR REPLACE FUNCTION public.post_general_business_cashbook_entry(
  p_organization_id uuid, p_transaction_date date, p_headquarters text,
  p_payment_method text, p_description text, p_supplier_name text,
  p_customer_name text, p_counterpart_gl_account_id uuid,
  p_cash_gl_account_id uuid, p_cash_in numeric, p_cash_out numeric, p_reference text
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_entry_id uuid := gen_random_uuid(); v_journal_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND organization_id = p_organization_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;
  IF coalesce(trim(p_description),'') = '' THEN RAISE EXCEPTION 'Description is required'; END IF;
  IF NOT ((p_cash_in > 0 AND p_cash_out = 0) OR (p_cash_out > 0 AND p_cash_in = 0)) THEN
    RAISE EXCEPTION 'Enter either cash in or cash out';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM gl_accounts WHERE id IN (p_counterpart_gl_account_id,p_cash_gl_account_id) AND organization_id=p_organization_id GROUP BY organization_id HAVING count(*)=2) THEN
    RAISE EXCEPTION 'Both GL accounts must belong to this organization';
  END IF;

  INSERT INTO journal_entries(entry_date,description,reference_type,reference_id,created_by,organization_id,is_posted,is_deleted)
  VALUES(p_transaction_date,p_description,'general_business_cashbook',v_entry_id,auth.uid(),p_organization_id,true,false)
  RETURNING id INTO v_journal_id;

  IF p_cash_in > 0 THEN
    INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order) VALUES
      (v_journal_id,p_cash_gl_account_id,p_cash_in,0,p_description,1),
      (v_journal_id,p_counterpart_gl_account_id,0,p_cash_in,p_description,2);
  ELSE
    INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order) VALUES
      (v_journal_id,p_counterpart_gl_account_id,p_cash_out,0,p_description,1),
      (v_journal_id,p_cash_gl_account_id,0,p_cash_out,p_description,2);
  END IF;

  INSERT INTO general_business_cashbook_entries(id,organization_id,transaction_date,headquarters,payment_method,description,supplier_name,customer_name,counterpart_gl_account_id,cash_gl_account_id,cash_in,cash_out,reference,journal_entry_id,created_by)
  VALUES(v_entry_id,p_organization_id,p_transaction_date,nullif(trim(p_headquarters),''),p_payment_method,p_description,nullif(trim(p_supplier_name),''),nullif(trim(p_customer_name),''),p_counterpart_gl_account_id,p_cash_gl_account_id,p_cash_in,p_cash_out,nullif(trim(p_reference),''),v_journal_id,auth.uid());
  RETURN v_entry_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.post_general_business_cashbook_entry(uuid,date,text,text,text,text,text,uuid,uuid,numeric,numeric,text) TO authenticated;
