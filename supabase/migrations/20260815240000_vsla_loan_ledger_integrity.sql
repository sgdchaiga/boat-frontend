-- Make the meeting loan ledger contractual and historically auditable.
ALTER TABLE public.vsla_loan_repayments
  ADD COLUMN IF NOT EXISTS balance_after numeric(18,2);

-- Re-establish the agreed total for active loans. Interest is fixed over the
-- agreed period and no longer changes merely because a repayment is posted.
UPDATE public.vsla_loans l
SET total_due = l.principal_amount + CASE
      WHEN COALESCE(l.interest_type, 'flat') = 'flat'
        THEN l.principal_amount * (l.interest_rate_percent / 100) * l.duration_meetings
      ELSE l.principal_amount * (l.interest_rate_percent / 100) * (l.duration_meetings + 1) / 2
    END,
    outstanding_balance = GREATEST(0,
      l.principal_amount + CASE
        WHEN COALESCE(l.interest_type, 'flat') = 'flat'
          THEN l.principal_amount * (l.interest_rate_percent / 100) * l.duration_meetings
        ELSE l.principal_amount * (l.interest_rate_percent / 100) * (l.duration_meetings + 1) / 2
      END - COALESCE((SELECT sum(r.principal_paid+r.interest_paid+r.penalty_paid)
                      FROM public.vsla_loan_repayments r WHERE r.loan_id=l.id), 0))
WHERE l.status IN ('disbursed','closed','defaulted');

UPDATE public.vsla_loans SET status='disbursed'
WHERE status='closed' AND outstanding_balance>0;
UPDATE public.vsla_loans SET status='closed'
WHERE status IN ('disbursed','defaulted') AND outstanding_balance=0;

WITH running AS (
  SELECT r.id,
    GREATEST(0, l.total_due - sum(r.principal_paid+r.interest_paid+r.penalty_paid)
      OVER (PARTITION BY r.loan_id ORDER BY r.paid_on, r.created_at, r.id)) AS balance
  FROM public.vsla_loan_repayments r JOIN public.vsla_loans l ON l.id=r.loan_id
)
UPDATE public.vsla_loan_repayments r SET balance_after=running.balance
FROM running WHERE running.id=r.id;

ALTER TABLE public.vsla_loan_repayments
  ALTER COLUMN balance_after SET DEFAULT 0;

CREATE OR REPLACE FUNCTION public.vsla_post_loan_repayment(
  p_loan_id uuid,
  p_principal numeric,
  p_interest numeric,
  p_penalty numeric DEFAULT 0,
  p_meeting_id uuid DEFAULT NULL,
  p_paid_on date DEFAULT CURRENT_DATE
) RETURNS numeric
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_loan public.vsla_loans%ROWTYPE;
  v_total numeric;
  v_principal_paid numeric;
  v_interest_paid numeric;
  v_total_paid numeric;
  v_contract_interest numeric;
  v_outstanding numeric;
BEGIN
  v_total := COALESCE(p_principal,0)+COALESCE(p_interest,0)+COALESCE(p_penalty,0);
  IF COALESCE(p_principal,0)<0 OR COALESCE(p_interest,0)<0 OR COALESCE(p_penalty,0)<0 OR v_total<=0 THEN
    RAISE EXCEPTION 'Repayment amounts must be non-negative and total more than zero';
  END IF;
  IF p_meeting_id IS NULL THEN RAISE EXCEPTION 'Repayments must be recorded during an open VSLA meeting'; END IF;
  SELECT * INTO v_loan FROM public.vsla_loans WHERE id=p_loan_id FOR UPDATE;
  IF v_loan.id IS NULL THEN RAISE EXCEPTION 'Loan not found'; END IF;
  IF NOT (public.is_platform_admin() OR v_loan.organization_id=public.auth_staff_org_id()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_loan.status <> 'disbursed' THEN RAISE EXCEPTION 'Only disbursed loans can receive repayments'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vsla_meetings WHERE id=p_meeting_id
      AND organization_id=v_loan.organization_id AND status='open') THEN
    RAISE EXCEPTION 'Open meeting not found in this organization';
  END IF;

  SELECT COALESCE(sum(principal_paid),0), COALESCE(sum(interest_paid),0),
         COALESCE(sum(principal_paid+interest_paid+penalty_paid),0)
  INTO v_principal_paid, v_interest_paid, v_total_paid
  FROM public.vsla_loan_repayments WHERE loan_id=p_loan_id;
  v_contract_interest := GREATEST(0, v_loan.total_due-v_loan.principal_amount);
  IF v_principal_paid+p_principal > v_loan.principal_amount THEN RAISE EXCEPTION 'Principal payment exceeds remaining principal'; END IF;
  IF v_interest_paid+p_interest > v_contract_interest THEN RAISE EXCEPTION 'Interest payment exceeds agreed interest'; END IF;
  IF v_total_paid+v_total > v_loan.total_due THEN RAISE EXCEPTION 'Payment exceeds outstanding balance'; END IF;

  v_outstanding := GREATEST(0, v_loan.total_due-v_total_paid-v_total);
  INSERT INTO public.vsla_loan_repayments(
    organization_id,meeting_id,loan_id,principal_paid,interest_paid,penalty_paid,paid_on,balance_after
  ) VALUES (
    v_loan.organization_id,p_meeting_id,p_loan_id,p_principal,p_interest,p_penalty,p_paid_on,v_outstanding
  );
  UPDATE public.vsla_loans SET outstanding_balance=v_outstanding,
    status=CASE WHEN v_outstanding=0 THEN 'closed' ELSE status END WHERE id=p_loan_id;
  INSERT INTO public.vsla_meeting_transactions(organization_id,meeting_id,member_id,kind,amount,note)
  VALUES(v_loan.organization_id,p_meeting_id,v_loan.member_id,'loan_repayment',v_total,'Repayment posted from meeting dashboard');
  RETURN v_outstanding;
END; $$;

GRANT EXECUTE ON FUNCTION public.vsla_post_loan_repayment(uuid,numeric,numeric,numeric,uuid,date) TO authenticated;
NOTIFY pgrst, 'reload schema';
