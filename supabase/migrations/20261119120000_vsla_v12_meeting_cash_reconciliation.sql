-- BOAT VSLA v1.2 / Phase 1: server-calculated meeting cash reconciliation.

CREATE TABLE IF NOT EXISTS public.vsla_cash_reconciliation_controls (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  allowed_variance numeric(18,2) NOT NULL DEFAULT 0 CHECK (allowed_variance >= 0),
  block_meeting_close_on_variance boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vsla_v12_cash_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.vsla_meetings(id) ON DELETE RESTRICT,
  opening_cash numeric(18,2) NOT NULL CHECK (opening_cash >= 0),
  savings_receipts numeric(18,2) NOT NULL DEFAULT 0,
  loan_repayments numeric(18,2) NOT NULL DEFAULT 0,
  fines_receipts numeric(18,2) NOT NULL DEFAULT 0,
  social_fund_receipts numeric(18,2) NOT NULL DEFAULT 0,
  loan_disbursements numeric(18,2) NOT NULL DEFAULT 0,
  expenses_paid numeric(18,2) NOT NULL DEFAULT 0,
  social_fund_paid numeric(18,2) NOT NULL DEFAULT 0,
  expected_closing_cash numeric(18,2) NOT NULL,
  actual_physical_cash numeric(18,2) NOT NULL CHECK (actual_physical_cash >= 0),
  variance numeric(18,2) NOT NULL,
  status text NOT NULL CHECK (status IN ('reconciled','requires_approval')),
  counted_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  counted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(meeting_id)
);
CREATE INDEX IF NOT EXISTS idx_vsla_v12_cash_reconciliations_org ON public.vsla_v12_cash_reconciliations(organization_id,counted_at DESC);

ALTER TABLE public.vsla_cash_reconciliation_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vsla_v12_cash_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY vsla_cash_controls_read ON public.vsla_cash_reconciliation_controls FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
CREATE POLICY vsla_cash_controls_manage ON public.vsla_cash_reconciliation_controls FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY vsla_v12_cash_reconciliation_read ON public.vsla_v12_cash_reconciliations FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
REVOKE ALL ON public.vsla_v12_cash_reconciliations FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.vsla_cash_reconciliation_controls TO authenticated;
GRANT SELECT ON public.vsla_v12_cash_reconciliations TO authenticated;

CREATE OR REPLACE FUNCTION public.vsla_v12_open_meeting(p_meeting_date date DEFAULT current_date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_id uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
  IF v_org IS NULL OR NOT EXISTS(SELECT 1 FROM public.vsla_workflow_settings WHERE organization_id=v_org AND workflow_version='v1_2') THEN
    RAISE EXCEPTION 'VSLA v1.2 is not enabled for this organization';
  END IF;
  IF NOT public.vsla_v12_actor_has_role(v_org,NULL,ARRAY['chairperson','treasurer','secretary']) THEN
    RAISE EXCEPTION 'Your VSLA role cannot open a meeting';
  END IF;
  SELECT id INTO v_id FROM public.vsla_meetings WHERE organization_id=v_org AND status='open' FOR UPDATE;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.vsla_meetings(organization_id,meeting_date,status) VALUES(v_org,coalesce(p_meeting_date,current_date),'open') RETURNING id INTO v_id;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,after_data)
  VALUES(v_org,auth.uid(),'meeting_opened','vsla_meetings',v_id,jsonb_build_object('meeting_date',coalesce(p_meeting_date,current_date)));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_reconcile_meeting_cash(
  p_meeting_id uuid, p_opening_cash numeric, p_actual_physical_cash numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_expected numeric; v_variance numeric; v_allowed numeric:=0; v_id uuid;
  v_savings numeric:=0; v_repayments numeric:=0; v_fines numeric:=0; v_social_in numeric:=0;
  v_loans numeric:=0; v_expenses numeric:=0; v_social_out numeric:=0;
BEGIN
  SELECT organization_id INTO v_org FROM public.vsla_meetings WHERE id=p_meeting_id AND status='open' FOR UPDATE;
  IF v_org IS NULL OR v_org<>public.auth_staff_org_id() THEN RAISE EXCEPTION 'Open meeting not found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vsla_workflow_settings WHERE organization_id=v_org AND workflow_version='v1_2') THEN RAISE EXCEPTION 'VSLA v1.2 is not enabled for this organization'; END IF;
  IF NOT public.vsla_v12_actor_has_role(v_org,NULL,ARRAY['chairperson','treasurer','secretary']) THEN RAISE EXCEPTION 'Your VSLA role cannot reconcile cash'; END IF;
  IF coalesce(p_opening_cash,-1)<0 OR coalesce(p_actual_physical_cash,-1)<0 THEN RAISE EXCEPTION 'Cash amounts cannot be negative'; END IF;
  SELECT coalesce(sum(amount) FILTER (WHERE event_type='savings_received'),0),
    coalesce(sum(amount) FILTER (WHERE event_type='loan_repayment'),0),
    coalesce(sum(amount) FILTER (WHERE event_type='fine_received'),0),
    coalesce(sum(amount) FILTER (WHERE event_type='social_fund_received'),0),
    coalesce(sum(amount) FILTER (WHERE event_type='loan_disbursed'),0),
    coalesce(sum(amount) FILTER (WHERE event_type='expense_paid'),0),
    coalesce(sum(amount) FILTER (WHERE event_type='social_fund_paid'),0)
  INTO v_savings,v_repayments,v_fines,v_social_in,v_loans,v_expenses,v_social_out
  FROM public.vsla_financial_events WHERE meeting_id=p_meeting_id AND status='posted';
  SELECT allowed_variance INTO v_allowed FROM public.vsla_cash_reconciliation_controls WHERE organization_id=v_org;
  v_expected:=p_opening_cash+v_savings+v_repayments+v_fines+v_social_in-v_loans-v_expenses-v_social_out;
  v_variance:=p_actual_physical_cash-v_expected;
  INSERT INTO public.vsla_v12_cash_reconciliations(organization_id,meeting_id,opening_cash,savings_receipts,loan_repayments,fines_receipts,social_fund_receipts,loan_disbursements,expenses_paid,social_fund_paid,expected_closing_cash,actual_physical_cash,variance,status,counted_by)
  VALUES(v_org,p_meeting_id,p_opening_cash,v_savings,v_repayments,v_fines,v_social_in,v_loans,v_expenses,v_social_out,v_expected,p_actual_physical_cash,v_variance,
    CASE WHEN abs(v_variance)<=coalesce(v_allowed,0) THEN 'reconciled' ELSE 'requires_approval' END,auth.uid())
  ON CONFLICT(meeting_id) DO UPDATE SET opening_cash=EXCLUDED.opening_cash,savings_receipts=EXCLUDED.savings_receipts,loan_repayments=EXCLUDED.loan_repayments,
    fines_receipts=EXCLUDED.fines_receipts,social_fund_receipts=EXCLUDED.social_fund_receipts,loan_disbursements=EXCLUDED.loan_disbursements,
    expenses_paid=EXCLUDED.expenses_paid,social_fund_paid=EXCLUDED.social_fund_paid,expected_closing_cash=EXCLUDED.expected_closing_cash,
    actual_physical_cash=EXCLUDED.actual_physical_cash,variance=EXCLUDED.variance,status=EXCLUDED.status,counted_by=EXCLUDED.counted_by,counted_at=now()
  RETURNING id INTO v_id;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,after_data)
  VALUES(v_org,auth.uid(),'cash_reconciled','vsla_v12_cash_reconciliations',v_id,jsonb_build_object('meeting_id',p_meeting_id,'expected',v_expected,'actual',p_actual_physical_cash,'variance',v_variance));
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.vsla_v12_open_meeting(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vsla_v12_reconcile_meeting_cash(uuid,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_open_meeting(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vsla_v12_reconcile_meeting_cash(uuid,numeric,numeric) TO authenticated;
