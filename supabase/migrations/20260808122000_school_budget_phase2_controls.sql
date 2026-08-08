-- Phase 2: auditable transfers and commitment lifecycle.

CREATE TABLE IF NOT EXISTS public.budget_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  budget_id uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  source_line_id uuid NOT NULL REFERENCES public.budget_lines(id) ON DELETE RESTRICT,
  destination_line_id uuid NOT NULL REFERENCES public.budget_lines(id) ON DELETE RESTRICT,
  amount numeric(18,2) NOT NULL CHECK(amount>0), reason text NOT NULL,
  status text NOT NULL DEFAULT 'approved' CHECK(status IN('approved','reversed')),
  requested_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  approved_at timestamptz, reversed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK(source_line_id<>destination_line_id)
);
CREATE INDEX IF NOT EXISTS idx_budget_transfers_budget ON public.budget_transfers(budget_id,created_at DESC);
ALTER TABLE public.budget_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY budget_transfers_org_select ON public.budget_transfers FOR SELECT TO authenticated
USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT ON public.budget_transfers TO authenticated;

CREATE OR REPLACE FUNCTION public.create_budget_transfer(p_source_line_id uuid,p_destination_line_id uuid,p_amount numeric,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE src public.budget_lines%ROWTYPE; dst public.budget_lines%ROWTYPE; b public.budgets%ROWTYPE; oid uuid; available numeric; transfer_id uuid;
BEGIN
  IF NOT public.has_budget_permission('budget_approve') THEN RAISE EXCEPTION 'You do not have permission to approve budget transfers'; END IF;
  IF p_amount<=0 OR NULLIF(trim(p_reason),'') IS NULL OR p_source_line_id=p_destination_line_id THEN RAISE EXCEPTION 'Valid source, destination, amount and reason are required'; END IF;
  SELECT organization_id INTO oid FROM public.staff WHERE id=auth.uid();
  SELECT * INTO src FROM public.budget_lines WHERE id=p_source_line_id FOR UPDATE;
  SELECT * INTO dst FROM public.budget_lines WHERE id=p_destination_line_id FOR UPDATE;
  IF src.id IS NULL OR dst.id IS NULL OR src.budget_id<>dst.budget_id THEN RAISE EXCEPTION 'Transfer lines must belong to the same budget'; END IF;
  SELECT * INTO b FROM public.budgets WHERE id=src.budget_id AND organization_id=oid AND status='active';
  IF b.id IS NULL THEN RAISE EXCEPTION 'Transfers are allowed only within an active budget'; END IF;
  SELECT src.amount
    + COALESCE(sum(CASE WHEN destination_line_id=src.id THEN amount WHEN source_line_id=src.id THEN -amount ELSE 0 END),0)
  INTO available FROM public.budget_transfers WHERE status='approved' AND budget_id=b.id
    AND (source_line_id=src.id OR destination_line_id=src.id);
  IF available<p_amount THEN RAISE EXCEPTION 'Transfer exceeds the source line current budget'; END IF;
  INSERT INTO public.budget_transfers(organization_id,budget_id,source_line_id,destination_line_id,amount,reason,requested_by,approved_by,approved_at)
  VALUES(oid,b.id,src.id,dst.id,p_amount,trim(p_reason),auth.uid(),auth.uid(),now()) RETURNING id INTO transfer_id;
  RETURN transfer_id;
END $$;
REVOKE ALL ON FUNCTION public.create_budget_transfer(uuid,uuid,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_budget_transfer(uuid,uuid,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_school_budget_commitment(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE oid uuid; req public.school_expense_budget_requests%ROWTYPE;
BEGIN
  SELECT organization_id INTO oid FROM public.staff WHERE id=auth.uid();
  SELECT * INTO req FROM public.school_expense_budget_requests WHERE id=p_request_id AND organization_id=oid FOR UPDATE;
  IF req.id IS NULL OR req.status<>'approved' THEN RAISE EXCEPTION 'Only an approved commitment can be released'; END IF;
  UPDATE public.school_expense_budget_requests SET status='used',decided_by=auth.uid(),decided_at=now(),decision_reason=COALESCE(decision_reason,'')||' Released when actual expense posted.' WHERE id=req.id;
END $$;
REVOKE ALL ON FUNCTION public.complete_school_budget_commitment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_school_budget_commitment(uuid) TO authenticated;
