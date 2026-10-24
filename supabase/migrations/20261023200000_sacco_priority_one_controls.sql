-- Priority-one completion: sealed financial snapshots, fixed-deposit documents
-- and a guarded product-mapping journal poster.
CREATE TABLE IF NOT EXISTS public.sacco_financial_period_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reporting_month date NOT NULL, snapshot_type text NOT NULL CHECK(snapshot_type IN('savings','fixed_deposits','general_ledger','liquidity','ratios')),
  payload jsonb NOT NULL, sealed_at timestamptz NOT NULL DEFAULT now(), sealed_by uuid REFERENCES public.staff(id),
  UNIQUE(organization_id,reporting_month,snapshot_type)
);
ALTER TABLE public.sacco_financial_period_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sacco_financial_period_snapshots_org ON public.sacco_financial_period_snapshots;
CREATE POLICY sacco_financial_period_snapshots_org ON public.sacco_financial_period_snapshots FOR SELECT TO authenticated USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT ON public.sacco_financial_period_snapshots TO authenticated;

CREATE OR REPLACE FUNCTION public.seal_sacco_financial_period_snapshots(p_period_end date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_staff public.staff%ROWTYPE; v_month date:=date_trunc('month',p_period_end)::date; v_savings numeric; v_fd_principal numeric; v_fd_interest numeric; v_cash numeric; v_debits numeric; v_credits numeric; v_count integer:=0;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE id=auth.uid(); IF NOT FOUND OR lower(coalesce(v_staff.role,'')) NOT IN('accountant','manager','admin','super_admin') THEN RAISE EXCEPTION 'Only authorized finance staff can seal financial snapshots'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.accounting_period_closes WHERE organization_id=v_staff.organization_id AND period_end=p_period_end AND status='closed') THEN RAISE EXCEPTION 'Close the accounting period before sealing period snapshots'; END IF;
  SELECT coalesce(sum(balance),0) INTO v_savings FROM public.sacco_member_savings_accounts WHERE organization_id=v_staff.organization_id AND is_active;
  SELECT coalesce(sum(amount),0),coalesce(sum(net_interest),0) INTO v_fd_principal,v_fd_interest FROM public.sacco_fixed_deposits WHERE organization_id=v_staff.organization_id AND status='active';
  SELECT coalesce(sum(debit-credit),0) INTO v_cash FROM public.sacco_cashbook_entries WHERE organization_id=v_staff.organization_id AND entry_date<=p_period_end;
  SELECT coalesce(sum(jel.debit),0),coalesce(sum(jel.credit),0) INTO v_debits,v_credits FROM public.journal_entries je JOIN public.journal_entry_lines jel ON jel.journal_entry_id=je.id WHERE je.organization_id=v_staff.organization_id AND je.entry_date<=p_period_end AND coalesce(je.is_posted,true) AND NOT coalesce(je.is_deleted,false);
  INSERT INTO public.sacco_financial_period_snapshots(organization_id,reporting_month,snapshot_type,payload,sealed_by) VALUES
  (v_staff.organization_id,v_month,'savings',jsonb_build_object('total_savings',v_savings),auth.uid()),
  (v_staff.organization_id,v_month,'fixed_deposits',jsonb_build_object('active_principal',v_fd_principal,'projected_net_interest',v_fd_interest),auth.uid()),
  (v_staff.organization_id,v_month,'liquidity',jsonb_build_object('cashbook_net_balance',v_cash),auth.uid()),
  (v_staff.organization_id,v_month,'general_ledger',jsonb_build_object('debits',v_debits,'credits',v_credits,'difference',v_debits-v_credits),auth.uid())
  ON CONFLICT(organization_id,reporting_month,snapshot_type) DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count;
END $$;

CREATE TABLE IF NOT EXISTS public.sacco_fixed_deposit_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fixed_deposit_id uuid NOT NULL REFERENCES public.sacco_fixed_deposits(id) ON DELETE CASCADE, document_type text NOT NULL CHECK(document_type IN('certificate','tax_certificate','maturity_instruction')),
  document_number text NOT NULL, payload jsonb NOT NULL, issued_at timestamptz NOT NULL DEFAULT now(), issued_by uuid REFERENCES public.staff(id),
  UNIQUE(fixed_deposit_id,document_type,document_number)
);
ALTER TABLE public.sacco_fixed_deposit_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sacco_fd_documents_org ON public.sacco_fixed_deposit_documents;
CREATE POLICY sacco_fd_documents_org ON public.sacco_fixed_deposit_documents FOR SELECT TO authenticated USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT ON public.sacco_fixed_deposit_documents TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_sacco_fixed_deposit_document(p_deposit_id uuid,p_document_type text,p_instruction jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_staff public.staff%ROWTYPE; v_fd public.sacco_fixed_deposits%ROWTYPE; v_id uuid; v_number text;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE id=auth.uid(); IF NOT FOUND OR lower(coalesce(v_staff.role,'')) NOT IN('accountant','manager','admin','super_admin') THEN RAISE EXCEPTION 'Only authorized finance staff can issue fixed-deposit documents'; END IF;
  SELECT * INTO v_fd FROM public.sacco_fixed_deposits WHERE id=p_deposit_id AND organization_id=v_staff.organization_id; IF NOT FOUND THEN RAISE EXCEPTION 'Fixed deposit not found'; END IF;
  IF p_document_type NOT IN('certificate','tax_certificate','maturity_instruction') THEN RAISE EXCEPTION 'Unsupported document type'; END IF;
  v_number:=upper(left(p_document_type,3))||'-'||to_char(current_date,'YYYY')||'-'||left(v_fd.id::text,8);
  INSERT INTO public.sacco_fixed_deposit_documents(organization_id,fixed_deposit_id,document_type,document_number,payload,issued_by)
  VALUES(v_staff.organization_id,v_fd.id,p_document_type,v_number,jsonb_build_object('member_name',v_fd.member_name,'principal',v_fd.amount,'rate',v_fd.interest_rate,'start_date',v_fd.start_date,'maturity_date',v_fd.maturity_date,'interest',v_fd.interest_earned,'instruction',coalesce(p_instruction,'{}'::jsonb)),auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.post_sacco_mapped_journal(p_product_family text,p_product_id uuid,p_transaction_type text,p_source_id uuid,p_amount numeric,p_entry_date date DEFAULT current_date,p_description text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_staff public.staff%ROWTYPE; v_map public.sacco_product_gl_mappings%ROWTYPE; v_journal uuid;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE id=auth.uid(); IF NOT FOUND OR lower(coalesce(v_staff.role,'')) NOT IN('accountant','manager','admin','super_admin') THEN RAISE EXCEPTION 'Only authorized finance staff can post mapped journals'; END IF;
  IF p_amount<=0 THEN RAISE EXCEPTION 'Journal amount must be positive'; END IF;
  SELECT * INTO v_map FROM public.sacco_product_gl_mappings WHERE organization_id=v_staff.organization_id AND product_family=p_product_family AND product_id IS NOT DISTINCT FROM p_product_id AND transaction_type=p_transaction_type AND is_active; IF NOT FOUND THEN RAISE EXCEPTION 'No active product GL mapping exists for this transaction'; END IF;
  v_journal:=public.create_journal_entry_atomic(p_entry_date,coalesce(nullif(trim(p_description),''),initcap(replace(p_transaction_type,'_',' '))), 'sacco_'||p_product_family||'_'||p_transaction_type,p_source_id,auth.uid(),jsonb_build_array(jsonb_build_object('gl_account_id',v_map.debit_gl_account_id,'debit',p_amount,'credit',0),jsonb_build_object('gl_account_id',v_map.credit_gl_account_id,'debit',0,'credit',p_amount)));
  PERFORM public.record_financial_event('mapped_journal_posted',p_entry_date,'journal_entries',v_journal,v_journal,jsonb_build_object('product_family',p_product_family,'transaction_type',p_transaction_type,'source_id',p_source_id,'amount',p_amount)); RETURN v_journal;
END $$;
REVOKE ALL ON FUNCTION public.seal_sacco_financial_period_snapshots(date),public.issue_sacco_fixed_deposit_document(uuid,text,jsonb),public.post_sacco_mapped_journal(text,uuid,text,uuid,numeric,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seal_sacco_financial_period_snapshots(date),public.issue_sacco_fixed_deposit_document(uuid,text,jsonb),public.post_sacco_mapped_journal(text,uuid,text,uuid,numeric,date,text) TO authenticated;
