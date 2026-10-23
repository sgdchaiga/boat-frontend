ALTER TABLE public.sacco_monthly_provision_snapshots
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES public.journal_entries(id),
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_by uuid;

CREATE TABLE IF NOT EXISTS public.sacco_provision_posting_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  provision_expense_gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id),
  provision_reserve_gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
ALTER TABLE public.sacco_provision_posting_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY sacco_provision_posting_settings_org ON public.sacco_provision_posting_settings FOR ALL TO authenticated
  USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()))
  WITH CHECK (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sacco_provision_posting_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.post_sacco_monthly_provision(p_reporting_month date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_staff public.staff%ROWTYPE; v_snapshot public.sacco_monthly_provision_snapshots%ROWTYPE; v_settings public.sacco_provision_posting_settings%ROWTYPE; v_journal uuid; v_role text;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff authorization required'; END IF;
  v_role:=lower(coalesce(v_staff.role,''));
  IF v_role NOT IN ('accountant','manager','admin','super_admin') THEN RAISE EXCEPTION 'Only accountants, managers and administrators can post provisions'; END IF;
  SELECT * INTO v_snapshot FROM public.sacco_monthly_provision_snapshots WHERE organization_id=v_staff.organization_id AND reporting_month=p_reporting_month FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Save the month-end provision snapshot before posting'; END IF;
  IF v_snapshot.journal_entry_id IS NOT NULL THEN RAISE EXCEPTION 'This provision month has already been posted'; END IF;
  IF v_snapshot.monthly_provision <= 0 THEN RAISE EXCEPTION 'A positive monthly provision is required to post'; END IF;
  SELECT * INTO v_settings FROM public.sacco_provision_posting_settings WHERE organization_id=v_staff.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configure provision expense and loan-loss reserve GL accounts before posting'; END IF;
  INSERT INTO public.journal_entries(entry_date,description,reference_type,reference_id,created_by,organization_id,is_posted,is_deleted)
  VALUES((p_reporting_month + interval '1 month - 1 day')::date,'Loan loss provision — '||to_char(p_reporting_month,'Mon YYYY'),'sacco_monthly_provision',v_snapshot.id,auth.uid(),v_staff.organization_id,true,false) RETURNING id INTO v_journal;
  INSERT INTO public.journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order)
  VALUES(v_journal,v_settings.provision_expense_gl_account_id,v_snapshot.monthly_provision,0,'Loan loss provision expense',1),
        (v_journal,v_settings.provision_reserve_gl_account_id,0,v_snapshot.monthly_provision,'Loan loss reserve',2);
  UPDATE public.sacco_monthly_provision_snapshots SET journal_entry_id=v_journal,posted_at=now(),posted_by=auth.uid() WHERE id=v_snapshot.id;
  RETURN v_journal;
END $$;
REVOKE ALL ON FUNCTION public.post_sacco_monthly_provision(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_sacco_monthly_provision(date) TO authenticated;
