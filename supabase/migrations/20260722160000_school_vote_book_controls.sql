-- School vote-book controls and exception approval trail.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS school_budget_amber_percent numeric NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS school_headteacher_approval_percent numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS school_board_approval_percent numeric NOT NULL DEFAULT 120;

CREATE TABLE IF NOT EXISTS public.school_expense_budget_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  budget_line_id uuid NOT NULL REFERENCES public.budget_lines(id) ON DELETE RESTRICT,
  description text NOT NULL,
  quantity numeric NOT NULL CHECK(quantity>0),
  unit_rate numeric NOT NULL CHECK(unit_rate>=0),
  amount numeric NOT NULL CHECK(amount>=0),
  reason text NOT NULL,
  projected_percent numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending_headteacher' CHECK(status IN('pending_headteacher','pending_board','approved','rejected','used')),
  requested_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  decision_reason text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.school_expense_budget_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_expense_budget_requests_org ON public.school_expense_budget_requests FOR ALL TO authenticated
USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()))
WITH CHECK(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT,INSERT,UPDATE ON public.school_expense_budget_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.save_school_budget_controls(p_amber_percent numeric,p_headteacher_percent numeric,p_board_percent numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE oid uuid;
BEGIN
 SELECT organization_id INTO oid FROM staff WHERE id=auth.uid();
 IF oid IS NULL THEN RAISE EXCEPTION 'No organization for current user'; END IF;
 IF p_amber_percent<0 OR p_headteacher_percent<p_amber_percent OR p_board_percent<p_headteacher_percent THEN RAISE EXCEPTION 'Thresholds must increase from amber to headteacher to board'; END IF;
 UPDATE organizations SET school_budget_amber_percent=p_amber_percent,school_headteacher_approval_percent=p_headteacher_percent,school_board_approval_percent=p_board_percent WHERE id=oid;
END $$;
REVOKE ALL ON FUNCTION public.save_school_budget_controls(numeric,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_school_budget_controls(numeric,numeric,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_school_expense_budget_request(p_request_id uuid,p_decision text,p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE oid uuid; req school_expense_budget_requests%ROWTYPE; board_at numeric;
BEGIN
 SELECT organization_id INTO oid FROM staff WHERE id=auth.uid();
 SELECT * INTO req FROM school_expense_budget_requests WHERE id=p_request_id AND organization_id=oid FOR UPDATE;
 IF req.id IS NULL OR req.status NOT IN('pending_headteacher','pending_board') THEN RAISE EXCEPTION 'Request is not pending'; END IF;
 IF p_decision='rejected' THEN UPDATE school_expense_budget_requests SET status='rejected',decision_reason=p_reason,decided_by=auth.uid(),decided_at=now() WHERE id=p_request_id; RETURN; END IF;
 IF p_decision<>'approved' THEN RAISE EXCEPTION 'Invalid decision'; END IF;
 SELECT school_board_approval_percent INTO board_at FROM organizations WHERE id=oid;
 UPDATE school_expense_budget_requests SET status=CASE WHEN req.status='pending_headteacher' AND req.projected_percent>=board_at THEN 'pending_board' ELSE 'approved' END,decision_reason=p_reason,decided_by=auth.uid(),decided_at=now() WHERE id=p_request_id;
END $$;
REVOKE ALL ON FUNCTION public.decide_school_expense_budget_request(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_school_expense_budget_request(uuid,text,text) TO authenticated;
