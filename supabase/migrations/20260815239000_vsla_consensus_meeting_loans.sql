-- VSLA loans are agreed collectively and disbursed during a meeting; there is
-- no separate application/approval stage.
ALTER TABLE public.vsla_loans
  ADD COLUMN IF NOT EXISTS disbursement_meeting_id uuid
    REFERENCES public.vsla_meetings(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_vsla_loans_disbursement_meeting
  ON public.vsla_loans(disbursement_meeting_id);

CREATE OR REPLACE FUNCTION public.vsla_record_meeting_loan(
  p_meeting_id uuid,
  p_member_id uuid,
  p_principal numeric,
  p_period_months integer,
  p_interest_rate numeric,
  p_interest_type text DEFAULT 'flat'
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_meeting public.vsla_meetings%ROWTYPE;
  v_member public.vsla_members%ROWTYPE;
  v_loan_id uuid;
  v_projected_interest numeric;
BEGIN
  SELECT * INTO v_meeting FROM public.vsla_meetings WHERE id=p_meeting_id FOR UPDATE;
  SELECT * INTO v_member FROM public.vsla_members WHERE id=p_member_id;
  IF v_meeting.id IS NULL OR v_member.id IS NULL THEN RAISE EXCEPTION 'Meeting or member not found'; END IF;
  IF v_meeting.organization_id <> v_member.organization_id THEN RAISE EXCEPTION 'Meeting and member belong to different organizations'; END IF;
  IF NOT (public.is_platform_admin() OR v_meeting.organization_id=public.auth_staff_org_id()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_meeting.status <> 'open' THEN RAISE EXCEPTION 'Open the meeting before disbursing loans'; END IF;
  IF p_principal <= 0 OR p_period_months <= 0 OR p_interest_rate < 0 THEN RAISE EXCEPTION 'Loan amount, period or interest is invalid'; END IF;
  IF p_interest_type NOT IN ('flat','declining') THEN RAISE EXCEPTION 'Invalid interest type'; END IF;

  -- Projected total is informational; live outstanding is recalculated by the
  -- repayment function as interest accrues.
  v_projected_interest := CASE WHEN p_interest_type='flat'
    THEN p_principal*(p_interest_rate/100)*p_period_months
    ELSE p_principal*(p_interest_rate/100)*(p_period_months+1)/2 END;

  INSERT INTO public.vsla_loans(
    organization_id, member_id, principal_amount, interest_rate_percent,
    interest_type, duration_meetings, due_date, status, total_due,
    outstanding_balance, disbursed_on, disbursement_meeting_id, notes
  ) VALUES (
    v_meeting.organization_id, p_member_id, p_principal, p_interest_rate,
    p_interest_type, p_period_months,
    (v_meeting.meeting_date + make_interval(months => p_period_months))::date,
    'disbursed', p_principal+v_projected_interest,
    p_principal+v_projected_interest, v_meeting.meeting_date,
    p_meeting_id, 'Agreed and disbursed collectively during meeting'
  ) RETURNING id INTO v_loan_id;

  INSERT INTO public.vsla_meeting_transactions(
    organization_id, meeting_id, member_id, kind, amount, note
  ) VALUES (
    v_meeting.organization_id, p_meeting_id, p_member_id, 'loan_issue',
    p_principal, 'Consensus loan disbursement ('||v_loan_id||')'
  );
  RETURN v_loan_id;
END; $$;

REVOKE ALL ON FUNCTION public.vsla_record_meeting_loan(uuid,uuid,numeric,integer,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_record_meeting_loan(uuid,uuid,numeric,integer,numeric,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
