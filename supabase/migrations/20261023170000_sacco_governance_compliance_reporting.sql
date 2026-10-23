-- Releases 4-6: reusable maker-checker, SACCO compliance/reconciliation queues,
-- and reports that can only be sealed from a closed accounting period.

CREATE TABLE IF NOT EXISTS public.sacco_product_control_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_family text NOT NULL CHECK(product_family IN('loan','savings','fixed_deposit','cash','provision','other')),
  action_code text NOT NULL, minimum_amount numeric NOT NULL DEFAULT 0, enabled boolean NOT NULL DEFAULT true,
  maker_roles text[] NOT NULL DEFAULT ARRAY['teller','officer','accountant','manager','admin'],
  checker_roles text[] NOT NULL DEFAULT ARRAY['accountant','manager','admin','super_admin'],
  require_distinct_users boolean NOT NULL DEFAULT true, created_by uuid REFERENCES public.staff(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,product_family,action_code)
);
CREATE TABLE IF NOT EXISTS public.sacco_financial_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES public.sacco_product_control_policies(id) ON DELETE SET NULL,
  product_family text NOT NULL, action_code text NOT NULL, source_table text NOT NULL, source_id uuid NOT NULL,
  amount numeric NOT NULL DEFAULT 0, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','cancelled','expired')),
  submitted_by uuid REFERENCES public.staff(id), submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.staff(id), decided_at timestamptz, decision_note text,
  UNIQUE(organization_id,source_table,source_id,action_code,status) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX IF NOT EXISTS idx_sacco_approval_queue ON public.sacco_financial_approval_requests(organization_id,status,submitted_at);
ALTER TABLE public.sacco_product_control_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_financial_approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY sacco_product_control_policies_org ON public.sacco_product_control_policies FOR ALL TO authenticated USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())) WITH CHECK(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY sacco_financial_approval_requests_org ON public.sacco_financial_approval_requests FOR ALL TO authenticated USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())) WITH CHECK(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sacco_product_control_policies,sacco_financial_approval_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_sacco_financial_approval(p_request_id uuid,p_approve boolean,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_staff public.staff%ROWTYPE; v_request public.sacco_financial_approval_requests%ROWTYPE; v_policy public.sacco_product_control_policies%ROWTYPE;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE id=auth.uid(); IF NOT FOUND THEN RAISE EXCEPTION 'Staff authorization required'; END IF;
  SELECT * INTO v_request FROM public.sacco_financial_approval_requests WHERE id=p_request_id AND organization_id=v_staff.organization_id FOR UPDATE;
  IF NOT FOUND OR v_request.status<>'pending' THEN RAISE EXCEPTION 'Approval request is not pending'; END IF;
  SELECT * INTO v_policy FROM public.sacco_product_control_policies WHERE id=v_request.policy_id;
  IF FOUND AND NOT(lower(coalesce(v_staff.role,''))=ANY(v_policy.checker_roles)) THEN RAISE EXCEPTION 'Your role cannot approve this action'; END IF;
  IF FOUND AND v_policy.require_distinct_users AND v_request.submitted_by=auth.uid() THEN RAISE EXCEPTION 'Maker and checker must be different users'; END IF;
  UPDATE public.sacco_financial_approval_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,decided_by=auth.uid(),decided_at=now(),decision_note=nullif(trim(p_note),'') WHERE id=v_request.id;
  PERFORM public.record_financial_event(CASE WHEN p_approve THEN 'approval_approved' ELSE 'approval_rejected' END,current_date,'sacco_financial_approval_requests',v_request.id,NULL,jsonb_build_object('action_code',v_request.action_code,'source_table',v_request.source_table,'source_id',v_request.source_id));
  RETURN v_request.id;
END $$;
REVOKE ALL ON FUNCTION public.decide_sacco_financial_approval(uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_sacco_financial_approval(uuid,boolean,text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.sacco_member_compliance_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE, check_type text NOT NULL CHECK(check_type IN('identity','address','pep_sanctions','source_of_funds','enhanced_due_diligence')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','clear','review_required','failed','expired')),
  risk_rating text NOT NULL DEFAULT 'normal' CHECK(risk_rating IN('low','normal','high','prohibited')), evidence_note text, expires_on date,
  checked_by uuid REFERENCES public.staff(id), checked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sacco_aml_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.sacco_members(id) ON DELETE SET NULL, source_table text, source_id uuid, alert_type text NOT NULL,
  risk_rating text NOT NULL DEFAULT 'medium' CHECK(risk_rating IN('low','medium','high','critical')), status text NOT NULL DEFAULT 'open' CHECK(status IN('open','under_review','reported','closed','false_positive')),
  narrative text NOT NULL, opened_at timestamptz NOT NULL DEFAULT now(), owner_id uuid REFERENCES public.staff(id), resolved_at timestamptz, resolved_by uuid REFERENCES public.staff(id), resolution_note text
);
CREATE TABLE IF NOT EXISTS public.sacco_payment_reconciliation_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_channel text NOT NULL, external_reference text, transaction_date date NOT NULL, amount numeric NOT NULL,
  exception_type text NOT NULL CHECK(exception_type IN('unmatched','duplicate','amount_mismatch','reversed','failed','manual_review')),
  status text NOT NULL DEFAULT 'open' CHECK(status IN('open','investigating','matched','written_off','closed')), details jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_to uuid REFERENCES public.staff(id), resolved_by uuid REFERENCES public.staff(id), resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,payment_channel,external_reference)
);
ALTER TABLE public.sacco_member_compliance_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_aml_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_payment_reconciliation_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sacco_compliance_org ON public.sacco_member_compliance_checks FOR ALL TO authenticated USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())) WITH CHECK(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY sacco_aml_org ON public.sacco_aml_alerts FOR ALL TO authenticated USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())) WITH CHECK(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY sacco_reconciliation_exception_org ON public.sacco_payment_reconciliation_exceptions FOR ALL TO authenticated USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())) WITH CHECK(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sacco_member_compliance_checks,sacco_aml_alerts,sacco_payment_reconciliation_exceptions TO authenticated;

CREATE TABLE IF NOT EXISTS public.sacco_closed_period_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_end date NOT NULL, report_type text NOT NULL CHECK(report_type IN('board_pack','audit_pack','regulatory_return')),
  report_payload jsonb NOT NULL, generated_by uuid REFERENCES public.staff(id), generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,period_end,report_type)
);
ALTER TABLE public.sacco_closed_period_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY sacco_closed_period_reports_org ON public.sacco_closed_period_reports FOR SELECT TO authenticated USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
REVOKE INSERT,UPDATE,DELETE ON public.sacco_closed_period_reports FROM authenticated;
GRANT SELECT ON public.sacco_closed_period_reports TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_sacco_closed_period_report(p_period_end date,p_report_type text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_staff public.staff%ROWTYPE; v_id uuid; v_payload jsonb; v_close public.accounting_period_closes%ROWTYPE; v_debits numeric; v_credits numeric; v_open_alerts integer; v_open_recon integer; v_portfolio jsonb;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE id=auth.uid(); IF NOT FOUND THEN RAISE EXCEPTION 'Staff authorization required'; END IF;
  IF lower(coalesce(v_staff.role,'')) NOT IN('accountant','manager','admin','super_admin') THEN RAISE EXCEPTION 'Only authorized finance staff can generate controlled reports'; END IF;
  SELECT * INTO v_close FROM public.accounting_period_closes WHERE organization_id=v_staff.organization_id AND period_end=p_period_end AND status='closed'; IF NOT FOUND THEN RAISE EXCEPTION 'Close this accounting period before generating board, audit or regulatory reports'; END IF;
  IF p_report_type NOT IN('board_pack','audit_pack','regulatory_return') THEN RAISE EXCEPTION 'Unsupported report type'; END IF;
  SELECT coalesce(sum(jel.debit),0),coalesce(sum(jel.credit),0) INTO v_debits,v_credits FROM public.journal_entries je JOIN public.journal_entry_lines jel ON jel.journal_entry_id=je.id WHERE je.organization_id=v_staff.organization_id AND je.entry_date BETWEEN v_close.period_start AND v_close.period_end AND coalesce(je.is_posted,true) AND NOT coalesce(je.is_deleted,false);
  SELECT count(*) INTO v_open_alerts FROM public.sacco_aml_alerts WHERE organization_id=v_staff.organization_id AND status IN('open','under_review');
  SELECT count(*) INTO v_open_recon FROM public.sacco_payment_reconciliation_exceptions WHERE organization_id=v_staff.organization_id AND status IN('open','investigating');
  SELECT jsonb_build_object('principal_outstanding',principal_outstanding,'amount_in_arrears',amount_in_arrears,'par_1_percent',par_1_percent,'par_30_percent',par_30_percent,'active_loans',active_loans,'delinquent_loans',delinquent_loans) INTO v_portfolio FROM public.sacco_loan_portfolio_snapshots WHERE organization_id=v_staff.organization_id AND reporting_date<=p_period_end ORDER BY reporting_date DESC LIMIT 1;
  v_payload:=jsonb_build_object('period_start',v_close.period_start,'period_end',v_close.period_end,'close_checklist',v_close.checklist_snapshot,'posted_debits',v_debits,'posted_credits',v_credits,'trial_balance_difference',v_debits-v_credits,'portfolio',coalesce(v_portfolio,'{}'::jsonb),'open_aml_alerts',v_open_alerts,'open_reconciliation_exceptions',v_open_recon);
  INSERT INTO public.sacco_closed_period_reports(organization_id,period_end,report_type,report_payload,generated_by) VALUES(v_staff.organization_id,p_period_end,p_report_type,v_payload,auth.uid()) ON CONFLICT(organization_id,period_end,report_type) DO UPDATE SET report_payload=EXCLUDED.report_payload,generated_by=EXCLUDED.generated_by,generated_at=now() RETURNING id INTO v_id;
  PERFORM public.record_financial_event('closed_period_report_generated',p_period_end,'sacco_closed_period_reports',v_id,NULL,jsonb_build_object('report_type',p_report_type)); RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.generate_sacco_closed_period_report(date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_sacco_closed_period_report(date,text) TO authenticated;
