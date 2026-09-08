-- Extend the canonical SACCO cashbook used by Modern mode with the Tereka fields.
-- Both modes therefore read and write the same rows.
ALTER TABLE public.sacco_cashbook_entries
  ADD COLUMN IF NOT EXISTS transaction_type text,
  ADD COLUMN IF NOT EXISTS narration text,
  ADD COLUMN IF NOT EXISTS gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS voucher_no text,
  ADD COLUMN IF NOT EXISTS deposit_amount numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS withdraw_amount numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loan_id uuid REFERENCES public.sacco_loans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS loan_no text,
  ADD COLUMN IF NOT EXISTS account_no text,
  ADD COLUMN IF NOT EXISTS client_no text,
  ADD COLUMN IF NOT EXISTS payment_channel text,
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.staff(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.sacco_cashbook_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  primary_color text NOT NULL DEFAULT '#6d28d9' CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text NOT NULL DEFAULT '#8b5cf6' CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  button_radius integer NOT NULL DEFAULT 10 CHECK (button_radius BETWEEN 0 AND 24),
  show_page_description boolean NOT NULL DEFAULT true,
  page_description text NOT NULL DEFAULT 'Transaction entry, cashbook register and daily cash summary.',
  updated_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sacco_cashbook_settings ENABLE ROW LEVEL SECURITY;
UPDATE public.sacco_cashbook_settings
SET page_description = 'Transaction entry, cashbook register and daily cash summary.'
WHERE page_description = 'Tereka-compatible transaction capture and register.';
DROP POLICY IF EXISTS "sacco_cashbook_settings_read_org" ON public.sacco_cashbook_settings;
CREATE POLICY "sacco_cashbook_settings_read_org" ON public.sacco_cashbook_settings FOR SELECT TO authenticated
USING (public.is_platform_admin() OR EXISTS (SELECT 1 FROM public.staff me WHERE me.id=(SELECT auth.uid()) AND me.organization_id=sacco_cashbook_settings.organization_id));
DROP POLICY IF EXISTS "sacco_cashbook_settings_manage_admin" ON public.sacco_cashbook_settings;
CREATE POLICY "sacco_cashbook_settings_manage_admin" ON public.sacco_cashbook_settings FOR ALL TO authenticated
USING (public.is_platform_admin() OR EXISTS (SELECT 1 FROM public.staff me WHERE me.id=(SELECT auth.uid()) AND me.organization_id=sacco_cashbook_settings.organization_id AND lower(me.role) IN ('admin','super_admin')))
WITH CHECK (public.is_platform_admin() OR EXISTS (SELECT 1 FROM public.staff me WHERE me.id=(SELECT auth.uid()) AND me.organization_id=sacco_cashbook_settings.organization_id AND lower(me.role) IN ('admin','super_admin')));

CREATE INDEX IF NOT EXISTS idx_sacco_cashbook_org_entry_date
  ON public.sacco_cashbook_entries(organization_id, entry_date DESC);

CREATE OR REPLACE FUNCTION public.post_sacco_cashbook_entry(
 p_organization_id uuid,p_transaction_type text,p_transaction_date date,p_narration text,p_member_id uuid,p_client_name text,
 p_gl_account_id uuid,p_voucher_no text,p_deposit_amount numeric,p_withdraw_amount numeric,p_loan_id uuid,p_loan_no text,
 p_account_no text,p_client_no text,p_payment_channel text) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_id uuid:=gen_random_uuid(); v_journal uuid; v_cash uuid; v_balance numeric:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff WHERE id=auth.uid() AND organization_id=p_organization_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF coalesce(trim(p_narration),'')='' THEN RAISE EXCEPTION 'Narration is required'; END IF;
 IF NOT((p_deposit_amount>0 AND p_withdraw_amount=0) OR (p_withdraw_amount>0 AND p_deposit_amount=0)) THEN RAISE EXCEPTION 'Enter either Deposit Amount or Withdraw Amount'; END IF;
 IF p_payment_channel NOT IN ('cash','mtn_momo','airtel_money','bank') THEN RAISE EXCEPTION 'Invalid payment channel'; END IF;
 IF NOT EXISTS(SELECT 1 FROM gl_accounts WHERE id=p_gl_account_id AND organization_id=p_organization_id) THEN RAISE EXCEPTION 'GL account does not belong to this organization'; END IF;
 SELECT id INTO v_cash FROM gl_accounts WHERE organization_id=p_organization_id AND is_active=true AND
   (CASE p_payment_channel WHEN 'bank' THEN lower(account_name) LIKE '%bank%' WHEN 'mtn_momo' THEN lower(account_name) LIKE '%mtn%' OR lower(account_name) LIKE '%mobile money%' WHEN 'airtel_money' THEN lower(account_name) LIKE '%airtel%' OR lower(account_name) LIKE '%mobile money%' ELSE lower(account_name) LIKE '%cash%' END)
   ORDER BY account_code LIMIT 1;
 IF v_cash IS NULL THEN SELECT id INTO v_cash FROM gl_accounts WHERE organization_id=p_organization_id AND is_active=true AND (lower(account_name) LIKE '%cash%' OR lower(account_name) LIKE '%bank%') ORDER BY account_code LIMIT 1; END IF;
 IF v_cash IS NULL THEN RAISE EXCEPTION 'Configure a cash, bank, or mobile-money GL account first'; END IF;

 SELECT coalesce(balance,0) INTO v_balance FROM sacco_cashbook_entries WHERE organization_id=p_organization_id ORDER BY entry_date DESC,created_at DESC LIMIT 1;
 v_balance:=coalesce(v_balance,0)+p_deposit_amount-p_withdraw_amount;
 INSERT INTO journal_entries(entry_date,description,reference_type,reference_id,created_by,organization_id,is_posted,is_deleted)
 VALUES(p_transaction_date,p_narration,'sacco_cashbook',v_id,auth.uid(),p_organization_id,true,false) RETURNING id INTO v_journal;
 IF p_deposit_amount>0 THEN INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order) VALUES(v_journal,v_cash,p_deposit_amount,0,p_narration,1),(v_journal,p_gl_account_id,0,p_deposit_amount,p_narration,2);
 ELSE INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order) VALUES(v_journal,p_gl_account_id,p_withdraw_amount,0,p_narration,1),(v_journal,v_cash,0,p_withdraw_amount,p_narration,2); END IF;

 INSERT INTO sacco_cashbook_entries(
   id,organization_id,entry_date,description,reference,category,sacco_member_id,member_name,debit,credit,balance,
   transaction_type,narration,gl_account_id,voucher_no,deposit_amount,withdraw_amount,loan_id,loan_no,account_no,client_no,
   payment_channel,journal_entry_id,created_by)
 VALUES(
   v_id,p_organization_id,p_transaction_date,p_narration,p_voucher_no,p_transaction_type,p_member_id,p_client_name,
   p_deposit_amount,p_withdraw_amount,v_balance,p_transaction_type,p_narration,p_gl_account_id,p_voucher_no,
   p_deposit_amount,p_withdraw_amount,p_loan_id,p_loan_no,p_account_no,p_client_no,p_payment_channel,v_journal,auth.uid());
 RETURN v_id;
 END;
$$;
GRANT EXECUTE ON FUNCTION public.post_sacco_cashbook_entry(uuid,text,date,text,uuid,text,uuid,text,numeric,numeric,uuid,text,text,text,text) TO authenticated;
