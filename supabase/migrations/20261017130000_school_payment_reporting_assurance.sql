-- School finance excellence: payment-run control, report snapshots and operational assurance.
-- No bank file or external distribution creates accounting entries automatically.

CREATE TABLE IF NOT EXISTS public.school_payment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_number text NOT NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  bank_name text,
  bank_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','exported','reconciled','cancelled')),
  total_amount numeric(18,2) NOT NULL DEFAULT 0,
  prepared_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  approved_at timestamptz,
  exported_at timestamptz,
  reconciled_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, run_number)
);

CREATE TABLE IF NOT EXISTS public.school_payment_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_run_id uuid NOT NULL REFERENCES public.school_payment_runs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  bill_id uuid REFERENCES public.bills(id) ON DELETE SET NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  payment_reference text,
  beneficiary_name text,
  beneficiary_account text,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','held','exported','reconciled','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_open_payment_run_bill
  ON public.school_payment_run_items (bill_id)
  WHERE status IN ('ready','held','exported');
CREATE INDEX IF NOT EXISTS idx_school_payment_runs_org_status ON public.school_payment_runs (organization_id, status, payment_date DESC);

CREATE TABLE IF NOT EXISTS public.school_supplier_advance_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_payment_id uuid NOT NULL REFERENCES public.vendor_payments(id) ON DELETE RESTRICT,
  bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE RESTRICT,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  note text,
  applied_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_payment_id, bill_id)
);

CREATE TABLE IF NOT EXISTS public.school_supplier_credit_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_credit_id uuid NOT NULL REFERENCES public.vendor_credits(id) ON DELETE RESTRICT,
  bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE RESTRICT,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  note text,
  applied_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_credit_id, bill_id)
);

CREATE TABLE IF NOT EXISTS public.school_report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  report_type text NOT NULL DEFAULT 'board_pack' CHECK (report_type IN ('board_pack','budget_owner','management_dashboard')),
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly','monthly','termly','quarterly')),
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  next_run_on date,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.school_report_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES public.school_report_schedules(id) ON DELETE SET NULL,
  title text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, title, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS public.school_report_commentary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  snapshot_id uuid REFERENCES public.school_report_snapshots(id) ON DELETE CASCADE,
  topic text NOT NULL,
  variance_amount numeric(18,2),
  commentary text NOT NULL,
  action_owner uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  due_on date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','monitoring','closed')),
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.school_report_distributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES public.school_report_snapshots(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  channel text NOT NULL DEFAULT 'manual' CHECK (channel IN ('manual','email','secure_link')),
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','sent','cancelled','failed')),
  prepared_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.school_assurance_policies (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  data_retention_months integer NOT NULL DEFAULT 84 CHECK (data_retention_months BETWEEN 12 AND 240),
  guardian_privacy_review_due_on date,
  backup_frequency_days integer NOT NULL DEFAULT 7 CHECK (backup_frequency_days BETWEEN 1 AND 90),
  backup_restore_test_due_on date,
  workflow_test_due_on date,
  incident_review_due_on date,
  updated_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.school_assurance_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  check_type text NOT NULL CHECK (check_type IN ('backup','restore','workflow_test','privacy_review','performance_review','access_review')),
  status text NOT NULL CHECK (status IN ('passed','failed','follow_up')),
  evidence_note text NOT NULL,
  performed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  performed_at timestamptz NOT NULL DEFAULT now(),
  next_due_on date
);
CREATE INDEX IF NOT EXISTS idx_school_assurance_checks_org ON public.school_assurance_checks (organization_id, check_type, performed_at DESC);

CREATE TABLE IF NOT EXISTS public.school_assurance_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  detail text,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  reported_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.capture_school_management_snapshot(p_organization_id uuid, p_title text, p_period_start date, p_period_end date, p_schedule_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_metrics jsonb;
BEGIN
  IF NOT public.school_finance_org_member(p_organization_id) THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  v_metrics := jsonb_build_object(
    'fee_invoiced', coalesce((SELECT sum(total_due) FROM public.student_invoices WHERE organization_id=p_organization_id AND issue_date BETWEEN p_period_start AND p_period_end AND status <> 'cancelled'),0),
    'fee_collected', coalesce((SELECT sum(amount) FROM public.school_payments WHERE organization_id=p_organization_id AND paid_at::date BETWEEN p_period_start AND p_period_end),0),
    'fee_outstanding', coalesce((SELECT sum(greatest(0,coalesce(total_due,0)-coalesce(amount_paid,0))) FROM public.student_invoices WHERE organization_id=p_organization_id AND status NOT IN ('cancelled','paid')),0),
    'expenses_recorded', coalesce((SELECT sum(amount) FROM public.expenses WHERE organization_id=p_organization_id AND expense_date BETWEEN p_period_start AND p_period_end),0),
    'supplier_payments', coalesce((SELECT sum(amount) FROM public.vendor_payments WHERE organization_id=p_organization_id AND payment_date BETWEEN p_period_start AND p_period_end AND coalesce(status,'active') <> 'reversed'),0),
    'supplier_bills', coalesce((SELECT sum(amount) FROM public.bills WHERE organization_id=p_organization_id AND bill_date BETWEEN p_period_start AND p_period_end AND coalesce(status,'pending') <> 'rejected'),0)
  );
  INSERT INTO public.school_report_snapshots (organization_id,schedule_id,title,period_start,period_end,metrics,generated_by)
  VALUES (p_organization_id,p_schedule_id,coalesce(nullif(btrim(p_title),''),'Management report'),p_period_start,p_period_end,v_metrics,auth.uid())
  ON CONFLICT (organization_id,title,period_start,period_end) DO UPDATE SET metrics=EXCLUDED.metrics,generated_by=EXCLUDED.generated_by,generated_at=now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'school_payment_runs','school_payment_run_items','school_supplier_advance_applications','school_supplier_credit_applications',
    'school_report_schedules','school_report_snapshots','school_report_commentary','school_report_distributions',
    'school_assurance_policies','school_assurance_checks','school_assurance_incidents'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS school_finance_org_%I ON public.%I', t, t);
    EXECUTE format('CREATE POLICY school_finance_org_%I ON public.%I FOR ALL TO authenticated USING (public.school_finance_org_member(organization_id)) WITH CHECK (public.school_finance_org_member(organization_id))', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.capture_school_management_snapshot(uuid,text,date,date,uuid) TO authenticated;
