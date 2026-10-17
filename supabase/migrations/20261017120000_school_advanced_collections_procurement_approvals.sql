-- School finance controls: collection queues, three-way match evidence and
-- configured maker/checker approval routing. Every control is opt-in per
-- organization so established schools retain their existing workflow until
-- they deliberately enable it.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS school_three_way_match_required boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.school_collection_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  days_after_due integer NOT NULL DEFAULT 0 CHECK (days_after_due >= 0),
  minimum_balance numeric(18,2) NOT NULL DEFAULT 0 CHECK (minimum_balance >= 0),
  channel text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','whatsapp','email','manual')),
  message_template text NOT NULL,
  create_clearance_hold boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS public.school_collection_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.school_collection_rules(id) ON DELETE SET NULL,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  student_invoice_id uuid NOT NULL REFERENCES public.student_invoices(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('sms','whatsapp','email','manual')),
  recipient text,
  body text NOT NULL,
  scheduled_for date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed','cancelled','manual_logged')),
  provider_message_id text,
  delivery_error text,
  sent_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_school_collection_message_rule_invoice_day
  ON public.school_collection_messages (rule_id, student_invoice_id, scheduled_for)
  WHERE rule_id IS NOT NULL AND status IN ('queued','sent','delivered','manual_logged');
CREATE INDEX IF NOT EXISTS idx_school_collection_messages_queue
  ON public.school_collection_messages (organization_id, status, scheduled_for, created_at);

CREATE TABLE IF NOT EXISTS public.school_student_finance_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  source_invoice_id uuid REFERENCES public.student_invoices(id) ON DELETE SET NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released')),
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  released_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  released_at timestamptz,
  release_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_school_finance_hold_per_invoice
  ON public.school_student_finance_holds (student_id, source_invoice_id)
  WHERE status = 'active' AND source_invoice_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.school_purchase_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  receipt_number text NOT NULL,
  receipt_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('draft','completed','cancelled')),
  notes text,
  recorded_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, receipt_number)
);
CREATE INDEX IF NOT EXISTS idx_school_purchase_receipts_po ON public.school_purchase_receipts (organization_id, purchase_order_id, receipt_date DESC);

CREATE TABLE IF NOT EXISTS public.school_purchase_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.school_purchase_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id uuid NOT NULL REFERENCES public.purchase_order_items(id) ON DELETE RESTRICT,
  received_quantity numeric(18,4) NOT NULL CHECK (received_quantity >= 0),
  accepted_quantity numeric(18,4) NOT NULL CHECK (accepted_quantity >= 0 AND accepted_quantity <= received_quantity),
  accepted_unit_price numeric(18,2),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receipt_id, purchase_order_item_id)
);
CREATE INDEX IF NOT EXISTS idx_school_receipt_lines_po_item ON public.school_purchase_receipt_lines (organization_id, purchase_order_item_id);

CREATE TABLE IF NOT EXISTS public.school_supplier_bill_match_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  purchase_order_item_id uuid NOT NULL REFERENCES public.purchase_order_items(id) ON DELETE RESTRICT,
  received_quantity numeric(18,4) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  billed_quantity numeric(18,4) NOT NULL DEFAULT 0 CHECK (billed_quantity >= 0),
  po_unit_price numeric(18,2) NOT NULL DEFAULT 0,
  billed_unit_price numeric(18,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'matched' CHECK (status IN ('matched','exception','waived')),
  exception_reason text,
  waived_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  waived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bill_id, purchase_order_item_id)
);
CREATE INDEX IF NOT EXISTS idx_school_bill_match_lines_bill ON public.school_supplier_bill_match_lines (organization_id, bill_id);

CREATE TABLE IF NOT EXISTS public.school_approval_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('purchase_order','supplier_bill','supplier_payment','expense')),
  minimum_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (minimum_amount >= 0),
  maximum_amount numeric(18,2),
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_approval_rule_amount_range CHECK (maximum_amount IS NULL OR maximum_amount >= minimum_amount)
);
CREATE INDEX IF NOT EXISTS idx_school_approval_rules_lookup ON public.school_approval_rules (organization_id, transaction_type, active, minimum_amount);

CREATE TABLE IF NOT EXISTS public.school_approval_rule_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.school_approval_rules(id) ON DELETE CASCADE,
  step_number integer NOT NULL CHECK (step_number > 0),
  approver_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, step_number)
);

CREATE TABLE IF NOT EXISTS public.school_approval_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  delegator_staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  delegate_staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  transaction_type text CHECK (transaction_type IS NULL OR transaction_type IN ('purchase_order','supplier_bill','supplier_payment','expense')),
  starts_on date NOT NULL DEFAULT CURRENT_DATE,
  ends_on date NOT NULL,
  note text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_approval_delegation_dates CHECK (ends_on >= starts_on),
  CONSTRAINT school_approval_delegation_not_self CHECK (delegator_staff_id <> delegate_staff_id)
);

CREATE TABLE IF NOT EXISTS public.school_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.school_approval_rules(id) ON DELETE RESTRICT,
  transaction_type text NOT NULL CHECK (transaction_type IN ('purchase_order','supplier_bill','supplier_payment','expense')),
  source_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL DEFAULT 0,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  current_step integer NOT NULL DEFAULT 1,
  requested_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_school_approval_request_source
  ON public.school_approval_requests (transaction_type, source_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_school_approval_requests_queue
  ON public.school_approval_requests (organization_id, status, transaction_type, current_step, requested_at);

CREATE TABLE IF NOT EXISTS public.school_approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.school_approval_requests(id) ON DELETE CASCADE,
  step_number integer NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  note text,
  decided_by uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  acting_for_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, step_number)
);

-- Reuse the organization/staff RLS model used by the other school records.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'school_collection_rules','school_collection_messages','school_student_finance_holds',
    'school_purchase_receipts','school_purchase_receipt_lines','school_supplier_bill_match_lines',
    'school_approval_rules','school_approval_rule_steps','school_approval_delegations',
    'school_approval_requests','school_approval_decisions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.school_finance_org_member(p_organization_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.organization_id = p_organization_id
  );
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'school_collection_rules','school_collection_messages','school_student_finance_holds',
    'school_purchase_receipts','school_purchase_receipt_lines','school_supplier_bill_match_lines',
    'school_approval_rules','school_approval_delegations','school_approval_requests'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS school_finance_org_%I ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY school_finance_org_%I ON public.%I FOR ALL TO authenticated USING (public.school_finance_org_member(organization_id)) WITH CHECK (public.school_finance_org_member(organization_id))', table_name, table_name);
  END LOOP;
END $$;

DROP POLICY IF EXISTS school_approval_rule_steps_org ON public.school_approval_rule_steps;
CREATE POLICY school_approval_rule_steps_org ON public.school_approval_rule_steps FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.school_approval_rules r WHERE r.id = rule_id AND public.school_finance_org_member(r.organization_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.school_approval_rules r WHERE r.id = rule_id AND public.school_finance_org_member(r.organization_id)));
DROP POLICY IF EXISTS school_approval_decisions_org ON public.school_approval_decisions;
CREATE POLICY school_approval_decisions_org ON public.school_approval_decisions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.school_approval_requests r WHERE r.id = request_id AND public.school_finance_org_member(r.organization_id)));

CREATE OR REPLACE FUNCTION public.generate_school_collection_queue(p_organization_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer := 0; r record; v_recipient text; v_body text;
BEGIN
  IF NOT public.school_finance_org_member(p_organization_id) THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  FOR r IN
    SELECT rule.id AS rule_id, rule.channel, rule.message_template, rule.create_clearance_hold,
           invoice.id AS invoice_id, invoice.student_id, invoice.invoice_number, invoice.due_date,
           greatest(0, coalesce(invoice.total_due,0) - coalesce(invoice.amount_paid,0)) AS balance,
           concat_ws(' ', student.first_name, student.other_names, student.last_name) AS student_name,
           parent.phone, parent.phone_alt, parent.email
    FROM public.school_collection_rules rule
    JOIN public.student_invoices invoice ON invoice.organization_id = rule.organization_id
    JOIN public.students student ON student.id = invoice.student_id
    LEFT JOIN LATERAL (
      SELECT p.phone, p.phone_alt, p.email FROM public.student_parents sp
      JOIN public.parents p ON p.id = sp.parent_id
      WHERE sp.student_id = student.id AND sp.organization_id = rule.organization_id
      ORDER BY sp.is_primary DESC, sp.created_at ASC LIMIT 1
    ) parent ON true
    WHERE rule.organization_id = p_organization_id AND rule.active
      AND invoice.status NOT IN ('cancelled','paid')
      AND greatest(0, coalesce(invoice.total_due,0) - coalesce(invoice.amount_paid,0)) >= rule.minimum_balance
      AND coalesce(invoice.due_date, invoice.issue_date) <= p_as_of - rule.days_after_due
  LOOP
    v_recipient := CASE r.channel WHEN 'email' THEN r.email ELSE coalesce(r.phone, r.phone_alt) END;
    v_body := replace(replace(replace(replace(r.message_template, '{{student_name}}', coalesce(r.student_name, 'Parent/Guardian')), '{{invoice_number}}', r.invoice_number), '{{balance}}', to_char(r.balance, 'FM999,999,999,999,990.00')), '{{due_date}}', coalesce(r.due_date::text, ''));
    INSERT INTO public.school_collection_messages (organization_id, rule_id, student_id, student_invoice_id, channel, recipient, body, scheduled_for)
    VALUES (p_organization_id, r.rule_id, r.student_id, r.invoice_id, r.channel, v_recipient, v_body, p_as_of)
    ON CONFLICT (rule_id, student_invoice_id, scheduled_for) WHERE status IN ('queued','sent','delivered','manual_logged') DO NOTHING;
    IF FOUND THEN v_count := v_count + 1; END IF;
    IF r.create_clearance_hold THEN
      INSERT INTO public.school_student_finance_holds (organization_id, student_id, source_invoice_id, reason, created_by)
      VALUES (p_organization_id, r.student_id, r.invoice_id, 'Outstanding fee balance reached the configured clearance-control threshold.', auth.uid())
      ON CONFLICT (student_id, source_invoice_id) WHERE status = 'active' DO NOTHING;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_school_supplier_bill_match(p_bill_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bill record; v_expected numeric := 0; v_billed numeric := 0;
BEGIN
  SELECT bill.*, o.school_three_way_match_required INTO v_bill FROM public.bills bill JOIN public.organizations o ON o.id=bill.organization_id WHERE bill.id=p_bill_id;
  IF NOT FOUND OR NOT coalesce(v_bill.school_three_way_match_required,false) OR v_bill.purchase_order_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.school_purchase_receipts r WHERE r.purchase_order_id=v_bill.purchase_order_id AND r.status='completed') THEN
    RAISE EXCEPTION 'A completed goods receipt is required before this supplier bill can be approved.' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.school_supplier_bill_match_lines m WHERE m.bill_id=v_bill.id) THEN
    RAISE EXCEPTION 'Complete the PO, goods receipt and bill line match before approving this bill.' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.school_supplier_bill_match_lines m WHERE m.bill_id=v_bill.id AND m.status='exception') THEN
    RAISE EXCEPTION 'Resolve or formally waive every three-way-match exception before approving this bill.' USING ERRCODE='55000';
  END IF;
  SELECT coalesce(sum(received_quantity * po_unit_price),0), coalesce(sum(billed_quantity * billed_unit_price),0) INTO v_expected, v_billed FROM public.school_supplier_bill_match_lines WHERE bill_id=v_bill.id;
  IF abs(v_billed - coalesce(v_bill.amount,0)) > 0.01 THEN RAISE EXCEPTION 'Matched bill lines total % but the bill total is %.', v_billed, v_bill.amount USING ERRCODE='55000'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.school_route_approval_request(p_organization_id uuid, p_transaction_type text, p_source_id uuid, p_amount numeric, p_department_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rule public.school_approval_rules; v_id uuid;
BEGIN
  SELECT * INTO v_rule FROM public.school_approval_rules r WHERE r.organization_id=p_organization_id AND r.transaction_type=p_transaction_type AND r.active
    AND p_amount >= r.minimum_amount AND (r.maximum_amount IS NULL OR p_amount <= r.maximum_amount)
    AND (r.department_id IS NULL OR r.department_id=p_department_id)
  ORDER BY r.minimum_amount DESC, r.created_at ASC LIMIT 1;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.school_approval_rule_steps s WHERE s.rule_id=v_rule.id) THEN RETURN NULL; END IF;
  INSERT INTO public.school_approval_requests (organization_id,rule_id,transaction_type,source_id,amount,department_id,requested_by)
  VALUES (p_organization_id,v_rule.id,p_transaction_type,p_source_id,p_amount,p_department_id,auth.uid())
  ON CONFLICT (transaction_type,source_id) WHERE status='pending' DO UPDATE SET amount=EXCLUDED.amount, department_id=EXCLUDED.department_id, updated_at=now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.school_route_purchase_document_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME='purchase_orders' THEN
    PERFORM public.school_route_approval_request(NEW.organization_id,'purchase_order',NEW.id,coalesce(NEW.total_amount,0),NEW.department_id);
  ELSIF TG_TABLE_NAME='bills' THEN
    PERFORM public.school_route_approval_request(NEW.organization_id,'supplier_bill',NEW.id,coalesce(NEW.amount,0),NULL);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_school_route_purchase_order_approval ON public.purchase_orders;
CREATE TRIGGER trg_school_route_purchase_order_approval AFTER INSERT ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.school_route_purchase_document_approval();
DROP TRIGGER IF EXISTS trg_school_route_bill_approval ON public.bills;
CREATE TRIGGER trg_school_route_bill_approval AFTER INSERT ON public.bills FOR EACH ROW EXECUTE FUNCTION public.school_route_purchase_document_approval();

CREATE OR REPLACE FUNCTION public.school_decide_approval(p_request_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.school_approval_requests; step public.school_approval_rule_steps; me public.staff; v_acting_for uuid := NULL; v_next boolean;
BEGIN
  SELECT * INTO r FROM public.school_approval_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approval request not found.' USING ERRCODE='P0002'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'This request is already %.', r.status USING ERRCODE='55000'; END IF;
  SELECT * INTO me FROM public.staff WHERE id=auth.uid() AND organization_id=r.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE='42501'; END IF;
  SELECT * INTO step FROM public.school_approval_rule_steps WHERE rule_id=r.rule_id AND step_number=r.current_step;
  IF NOT FOUND THEN RAISE EXCEPTION 'The current approval step is not configured.' USING ERRCODE='55000'; END IF;
  IF lower(coalesce(me.role::text,'')) <> lower(step.approver_role) THEN
    SELECT d.delegator_staff_id INTO v_acting_for FROM public.school_approval_delegations d JOIN public.staff delegator ON delegator.id=d.delegator_staff_id
    WHERE d.organization_id=r.organization_id AND d.delegate_staff_id=me.id AND d.active AND current_date BETWEEN d.starts_on AND d.ends_on
      AND (d.transaction_type IS NULL OR d.transaction_type=r.transaction_type) AND lower(coalesce(delegator.role::text,''))=lower(step.approver_role)
    LIMIT 1;
    IF v_acting_for IS NULL THEN RAISE EXCEPTION 'Only the configured % approver (or an active delegate) may decide this step.', step.approver_role USING ERRCODE='42501'; END IF;
  END IF;
  IF r.requested_by=me.id OR r.requested_by=v_acting_for THEN RAISE EXCEPTION 'Maker-checker control: the preparer cannot approve this request.' USING ERRCODE='42501'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Decision must be approved or rejected.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.school_approval_decisions (request_id,step_number,decision,note,decided_by,acting_for_staff_id) VALUES (r.id,r.current_step,p_decision,NULLIF(btrim(coalesce(p_note,'')),''),me.id,v_acting_for);
  IF p_decision='rejected' THEN
    UPDATE public.school_approval_requests SET status='rejected',resolved_at=now(),updated_at=now() WHERE id=r.id;
    IF r.transaction_type='purchase_order' THEN UPDATE public.purchase_orders SET status='rejected',rejected_by=me.id,rejected_at=now(),rejection_reason=coalesce(NULLIF(btrim(coalesce(p_note,'')),''),'Rejected in approval workflow') WHERE id=r.source_id;
    ELSIF r.transaction_type='supplier_bill' THEN UPDATE public.bills SET status='rejected' WHERE id=r.source_id; END IF;
    RETURN jsonb_build_object('status','rejected','final',true);
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.school_approval_rule_steps WHERE rule_id=r.rule_id AND step_number>r.current_step) INTO v_next;
  IF v_next THEN UPDATE public.school_approval_requests SET current_step=current_step+1,updated_at=now() WHERE id=r.id; RETURN jsonb_build_object('status','pending','final',false,'next_step',r.current_step+1); END IF;
  UPDATE public.school_approval_requests SET status='approved',resolved_at=now(),updated_at=now() WHERE id=r.id;
  IF r.transaction_type='purchase_order' THEN UPDATE public.purchase_orders SET status='approved',approved_at=now() WHERE id=r.source_id;
  ELSIF r.transaction_type='supplier_bill' THEN PERFORM public.assert_school_supplier_bill_match(r.source_id); UPDATE public.bills SET status='approved',approved_at=now(),approved_by=me.id WHERE id=r.source_id; END IF;
  RETURN jsonb_build_object('status','approved','final',true);
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_collection_rules, public.school_collection_messages, public.school_student_finance_holds, public.school_purchase_receipts, public.school_purchase_receipt_lines, public.school_supplier_bill_match_lines, public.school_approval_rules, public.school_approval_rule_steps, public.school_approval_delegations, public.school_approval_requests TO authenticated;
GRANT SELECT ON public.school_approval_decisions TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_school_collection_queue(uuid,date), public.assert_school_supplier_bill_match(uuid), public.school_decide_approval(uuid,text,text) TO authenticated;
