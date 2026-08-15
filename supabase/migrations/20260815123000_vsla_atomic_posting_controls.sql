-- Make the VSLA meeting-day financial postings atomic and idempotent at the
-- database boundary. The client must not coordinate multi-table bookkeeping.

CREATE OR REPLACE FUNCTION public.vsla_set_member_meeting_shares(
  p_meeting_id uuid,
  p_member_id uuid,
  p_shares integer,
  p_share_value numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_status text;
  v_max_shares integer;
BEGIN
  IF p_shares < 0 OR p_share_value <= 0 THEN
    RAISE EXCEPTION 'Shares cannot be negative and share value must be positive';
  END IF;

  SELECT organization_id, status INTO v_org_id, v_status
  FROM public.vsla_meetings WHERE id = p_meeting_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meeting not found'; END IF;
  IF v_status = 'closed' THEN RAISE EXCEPTION 'Closed meetings cannot be changed'; END IF;
  IF NOT (public.is_platform_admin() OR v_org_id = public.auth_staff_org_id()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vsla_members
    WHERE id = p_member_id AND organization_id = v_org_id AND status = 'active'
  ) THEN RAISE EXCEPTION 'Active member not found in this organization'; END IF;

  SELECT max_shares_per_meeting INTO v_max_shares
  FROM public.vsla_settings WHERE organization_id = v_org_id;
  IF p_shares > COALESCE(v_max_shares, 0) THEN
    RAISE EXCEPTION 'Maximum shares per meeting is %', COALESCE(v_max_shares, 0);
  END IF;

  DELETE FROM public.vsla_share_transactions
  WHERE meeting_id = p_meeting_id AND member_id = p_member_id;
  IF p_shares > 0 THEN
    INSERT INTO public.vsla_share_transactions
      (organization_id, meeting_id, member_id, shares_bought, share_value, total_value)
    VALUES
      (v_org_id, p_meeting_id, p_member_id, p_shares, p_share_value, p_shares * p_share_value);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.vsla_disburse_loan(
  p_loan_id uuid,
  p_meeting_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_loan public.vsla_loans%ROWTYPE;
  v_meeting public.vsla_meetings%ROWTYPE;
BEGIN
  SELECT * INTO v_loan FROM public.vsla_loans WHERE id = p_loan_id FOR UPDATE;
  SELECT * INTO v_meeting FROM public.vsla_meetings WHERE id = p_meeting_id FOR UPDATE;
  IF v_loan.id IS NULL OR v_meeting.id IS NULL THEN RAISE EXCEPTION 'Loan or meeting not found'; END IF;
  IF v_loan.organization_id <> v_meeting.organization_id THEN RAISE EXCEPTION 'Loan and meeting belong to different organizations'; END IF;
  IF NOT (public.is_platform_admin() OR v_loan.organization_id = public.auth_staff_org_id()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_meeting.status = 'closed' THEN RAISE EXCEPTION 'Closed meetings cannot be changed'; END IF;
  IF v_loan.status <> 'approved' THEN RAISE EXCEPTION 'Only approved loans can be disbursed'; END IF;

  UPDATE public.vsla_loans
  SET status = 'disbursed', disbursed_on = v_meeting.meeting_date
  WHERE id = p_loan_id;
  INSERT INTO public.vsla_meeting_transactions
    (organization_id, meeting_id, member_id, kind, amount, note)
  VALUES
    (v_loan.organization_id, p_meeting_id, v_loan.member_id, 'loan_issue',
     v_loan.principal_amount, 'Loan disbursed in meeting (' || p_loan_id || ')');
END;
$$;

CREATE OR REPLACE FUNCTION public.vsla_post_loan_repayment(
  p_loan_id uuid,
  p_principal numeric,
  p_interest numeric,
  p_penalty numeric DEFAULT 0,
  p_meeting_id uuid DEFAULT NULL,
  p_paid_on date DEFAULT CURRENT_DATE
) RETURNS numeric
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_loan public.vsla_loans%ROWTYPE;
  v_total numeric;
  v_principal_paid numeric;
  v_interest_paid numeric;
  v_penalty_paid numeric;
  v_months integer;
  v_accrued_interest numeric;
  v_total_due numeric;
  v_outstanding numeric;
BEGIN
  v_total := COALESCE(p_principal, 0) + COALESCE(p_interest, 0) + COALESCE(p_penalty, 0);
  IF COALESCE(p_principal, 0) < 0 OR COALESCE(p_interest, 0) < 0 OR COALESCE(p_penalty, 0) < 0 OR v_total <= 0 THEN
    RAISE EXCEPTION 'Repayment amounts must be non-negative and total more than zero';
  END IF;
  SELECT * INTO v_loan FROM public.vsla_loans WHERE id = p_loan_id FOR UPDATE;
  IF v_loan.id IS NULL THEN RAISE EXCEPTION 'Loan not found'; END IF;
  IF NOT (public.is_platform_admin() OR v_loan.organization_id = public.auth_staff_org_id()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_loan.status <> 'disbursed' THEN RAISE EXCEPTION 'Only disbursed loans can receive repayments'; END IF;
  IF p_meeting_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vsla_meetings
    WHERE id = p_meeting_id AND organization_id = v_loan.organization_id AND status <> 'closed'
  ) THEN RAISE EXCEPTION 'Open meeting not found in this organization'; END IF;

  SELECT COALESCE(sum(principal_paid),0), COALESCE(sum(interest_paid),0), COALESCE(sum(penalty_paid),0)
  INTO v_principal_paid, v_interest_paid, v_penalty_paid
  FROM public.vsla_loan_repayments WHERE loan_id = p_loan_id;
  IF v_principal_paid + p_principal > v_loan.principal_amount THEN
    RAISE EXCEPTION 'Principal payment exceeds remaining principal';
  END IF;
  v_months := GREATEST(0, (date_part('year', age(p_paid_on, v_loan.disbursed_on))::integer * 12)
    + date_part('month', age(p_paid_on, v_loan.disbursed_on))::integer);
  IF COALESCE(v_loan.interest_type, 'flat') = 'flat' THEN
    v_accrued_interest := v_loan.principal_amount
      * (v_loan.interest_rate_percent / 100) * v_months;
  ELSE
    SELECT COALESCE(sum(
      GREATEST(0, v_loan.principal_amount - COALESCE((
        SELECT sum(r.principal_paid)
        FROM public.vsla_loan_repayments r
        WHERE r.loan_id = p_loan_id
          AND date_trunc('month', r.paid_on) < date_trunc('month', v_loan.disbursed_on) + (n || ' months')::interval
      ), 0)) * (v_loan.interest_rate_percent / 100)
    ), 0)
    INTO v_accrued_interest
    FROM generate_series(1, v_months) AS n;
  END IF;
  v_total_due := GREATEST(0, v_loan.principal_amount - v_principal_paid) + v_accrued_interest;
  v_outstanding := GREATEST(0, v_total_due - v_interest_paid - v_penalty_paid);
  IF v_total > v_outstanding AND v_outstanding > 0 THEN
    RAISE EXCEPTION 'Payment exceeds outstanding balance';
  END IF;

  INSERT INTO public.vsla_loan_repayments
    (organization_id, meeting_id, loan_id, principal_paid, interest_paid, penalty_paid, paid_on)
  VALUES
    (v_loan.organization_id, p_meeting_id, p_loan_id, p_principal, p_interest, p_penalty, p_paid_on);

  v_total_due := GREATEST(0, v_total_due - p_principal);
  v_outstanding := GREATEST(0, v_outstanding - v_total);
  UPDATE public.vsla_loans
  SET outstanding_balance = v_outstanding, total_due = v_total_due,
      status = CASE WHEN v_outstanding = 0 THEN 'closed' ELSE status END
  WHERE id = p_loan_id;

  IF p_meeting_id IS NOT NULL THEN
    INSERT INTO public.vsla_meeting_transactions
      (organization_id, meeting_id, member_id, kind, amount, note)
    VALUES
      (v_loan.organization_id, p_meeting_id, v_loan.member_id, 'loan_repayment',
       v_total, 'Repayment posted from meeting dashboard');
  END IF;
  RETURN v_outstanding;
END;
$$;

GRANT EXECUTE ON FUNCTION public.vsla_set_member_meeting_shares(uuid, uuid, integer, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vsla_disburse_loan(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vsla_post_loan_repayment(uuid, numeric, numeric, numeric, uuid, date) TO authenticated;
