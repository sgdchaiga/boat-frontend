-- Introduce explicit VSLA cycles and make share-out a single, finalizing action.

CREATE TABLE IF NOT EXISTS public.vsla_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  starts_on date NOT NULL DEFAULT CURRENT_DATE,
  ends_on date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vsla_one_active_cycle
  ON public.vsla_cycles (organization_id) WHERE status = 'active';

ALTER TABLE public.vsla_meetings ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.vsla_cycles(id) ON DELETE RESTRICT;
ALTER TABLE public.vsla_share_transactions ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.vsla_cycles(id) ON DELETE RESTRICT;
ALTER TABLE public.vsla_loans ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.vsla_cycles(id) ON DELETE RESTRICT;
ALTER TABLE public.vsla_loan_repayments ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.vsla_cycles(id) ON DELETE RESTRICT;
ALTER TABLE public.vsla_cycle_shareout ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.vsla_cycles(id) ON DELETE RESTRICT;
ALTER TABLE public.vsla_cycle_shareout ADD COLUMN IF NOT EXISTS finalized boolean NOT NULL DEFAULT false;
ALTER TABLE public.vsla_cashbox_snapshots ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.vsla_cycles(id) ON DELETE RESTRICT;
ALTER TABLE public.vsla_fines ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.vsla_cycles(id) ON DELETE RESTRICT;
ALTER TABLE public.vsla_fund_transactions ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.vsla_cycles(id) ON DELETE RESTRICT;
ALTER TABLE public.vsla_meeting_transactions ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.vsla_cycles(id) ON DELETE RESTRICT;
ALTER TABLE public.vsla_social_welfare_stamps ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.vsla_cycles(id) ON DELETE RESTRICT;

INSERT INTO public.vsla_cycles (organization_id, name, starts_on)
SELECT organization_id, 'Initial cycle', COALESCE(min(activity_date), CURRENT_DATE)
FROM (
  SELECT organization_id, meeting_date AS activity_date FROM public.vsla_meetings
  UNION ALL SELECT organization_id, applied_at::date FROM public.vsla_loans
  UNION ALL SELECT organization_id, created_at::date FROM public.vsla_share_transactions
) activity
WHERE organization_id IS NOT NULL
GROUP BY organization_id
ON CONFLICT DO NOTHING;

-- Also seed organizations that have members/settings but no transactions yet.
INSERT INTO public.vsla_cycles (organization_id, name)
SELECT DISTINCT organization_id, 'Initial cycle' FROM public.vsla_members
WHERE organization_id IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO public.vsla_cycles (organization_id, name)
SELECT DISTINCT organization_id, 'Initial cycle' FROM public.vsla_settings
WHERE organization_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE public.vsla_meetings t SET cycle_id = c.id
FROM public.vsla_cycles c WHERE t.cycle_id IS NULL AND c.organization_id = t.organization_id AND c.status = 'active';
UPDATE public.vsla_share_transactions t SET cycle_id = c.id
FROM public.vsla_cycles c WHERE t.cycle_id IS NULL AND c.organization_id = t.organization_id AND c.status = 'active';
UPDATE public.vsla_loans t SET cycle_id = c.id
FROM public.vsla_cycles c WHERE t.cycle_id IS NULL AND c.organization_id = t.organization_id AND c.status = 'active';
UPDATE public.vsla_loan_repayments t SET cycle_id = l.cycle_id
FROM public.vsla_loans l WHERE t.cycle_id IS NULL AND l.id = t.loan_id;
UPDATE public.vsla_cycle_shareout t SET cycle_id = c.id
FROM public.vsla_cycles c WHERE t.cycle_id IS NULL AND c.organization_id = t.organization_id AND c.status = 'active';
UPDATE public.vsla_cashbox_snapshots t SET cycle_id = COALESCE(
  (SELECT cycle_id FROM public.vsla_meetings WHERE id = t.meeting_id),
  (SELECT id FROM public.vsla_cycles WHERE organization_id = t.organization_id AND status = 'active')
) WHERE t.cycle_id IS NULL;
UPDATE public.vsla_fines t SET cycle_id = COALESCE(
  (SELECT cycle_id FROM public.vsla_meetings WHERE id = t.meeting_id),
  (SELECT id FROM public.vsla_cycles WHERE organization_id = t.organization_id AND status = 'active')
) WHERE t.cycle_id IS NULL;
UPDATE public.vsla_fund_transactions t SET cycle_id = COALESCE(
  (SELECT cycle_id FROM public.vsla_meetings WHERE id = t.meeting_id),
  (SELECT id FROM public.vsla_cycles WHERE organization_id = t.organization_id AND status = 'active')
) WHERE t.cycle_id IS NULL;
UPDATE public.vsla_meeting_transactions t SET cycle_id = m.cycle_id
FROM public.vsla_meetings m WHERE t.cycle_id IS NULL AND m.id = t.meeting_id;
UPDATE public.vsla_social_welfare_stamps t SET cycle_id = COALESCE(
  (SELECT cycle_id FROM public.vsla_meetings WHERE id = t.meeting_id),
  (SELECT id FROM public.vsla_cycles WHERE organization_id = t.organization_id AND status = 'active')
) WHERE t.cycle_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vsla_finalized_shareout_cycle
  ON public.vsla_cycle_shareout (cycle_id) WHERE cycle_id IS NOT NULL AND finalized;
CREATE INDEX IF NOT EXISTS idx_vsla_meetings_cycle ON public.vsla_meetings (cycle_id, meeting_date DESC);
CREATE INDEX IF NOT EXISTS idx_vsla_shares_cycle ON public.vsla_share_transactions (cycle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vsla_loans_cycle ON public.vsla_loans (cycle_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_vsla_cashbox_cycle ON public.vsla_cashbox_snapshots (cycle_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.vsla_assign_active_cycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.cycle_id IS NULL THEN
    SELECT id INTO NEW.cycle_id FROM public.vsla_cycles
    WHERE organization_id = NEW.organization_id AND status = 'active';
  END IF;
  IF NEW.cycle_id IS NULL THEN RAISE EXCEPTION 'Start an active VSLA cycle before posting transactions'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vsla_cycles
    WHERE id = NEW.cycle_id AND organization_id = NEW.organization_id AND status = 'active'
  ) THEN RAISE EXCEPTION 'Transactions can only be posted to the active VSLA cycle'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.vsla_assign_repayment_cycle()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  SELECT cycle_id, organization_id INTO NEW.cycle_id, NEW.organization_id
  FROM public.vsla_loans WHERE id = NEW.loan_id;
  IF NEW.cycle_id IS NULL OR EXISTS (SELECT 1 FROM public.vsla_cycles WHERE id = NEW.cycle_id AND status = 'closed') THEN
    RAISE EXCEPTION 'Repayments cannot be posted to a closed or missing cycle';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.vsla_prevent_closed_cycle_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_cycle_id uuid;
BEGIN
  v_cycle_id := COALESCE(OLD.cycle_id, NEW.cycle_id);
  IF EXISTS (SELECT 1 FROM public.vsla_cycles WHERE id = v_cycle_id AND status = 'closed') THEN
    RAISE EXCEPTION 'Closed VSLA cycle records are locked';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DO $triggers$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'vsla_meetings','vsla_share_transactions','vsla_loans','vsla_cashbox_snapshots',
    'vsla_fines','vsla_fund_transactions','vsla_meeting_transactions','vsla_social_welfare_stamps'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_assign_cycle ON public.%I', tbl, tbl);
    EXECUTE format('CREATE TRIGGER trg_%s_assign_cycle BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.vsla_assign_active_cycle()', tbl, tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_lock_cycle ON public.%I', tbl, tbl);
    EXECUTE format('CREATE TRIGGER trg_%s_lock_cycle BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.vsla_prevent_closed_cycle_change()', tbl, tbl);
  END LOOP;
END $triggers$;
DROP TRIGGER IF EXISTS trg_vsla_repayments_assign_cycle ON public.vsla_loan_repayments;
CREATE TRIGGER trg_vsla_repayments_assign_cycle BEFORE INSERT ON public.vsla_loan_repayments
FOR EACH ROW EXECUTE FUNCTION public.vsla_assign_repayment_cycle();
DROP TRIGGER IF EXISTS trg_vsla_repayments_lock_cycle ON public.vsla_loan_repayments;
CREATE TRIGGER trg_vsla_repayments_lock_cycle BEFORE UPDATE OR DELETE ON public.vsla_loan_repayments
FOR EACH ROW EXECUTE FUNCTION public.vsla_prevent_closed_cycle_change();

ALTER TABLE public.vsla_cycles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vsla_cycles_tenant_all ON public.vsla_cycles;
CREATE POLICY vsla_cycles_tenant_all ON public.vsla_cycles FOR ALL TO authenticated
USING (public.is_platform_admin() OR organization_id = public.auth_staff_org_id())
WITH CHECK (public.is_platform_admin() OR organization_id = public.auth_staff_org_id());
GRANT SELECT, INSERT, UPDATE ON public.vsla_cycles TO authenticated;

CREATE OR REPLACE FUNCTION public.vsla_start_cycle(p_name text, p_starts_on date DEFAULT CURRENT_DATE)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_org_id uuid; v_id uuid;
BEGIN
  v_org_id := public.auth_staff_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Organization not found'; END IF;
  IF nullif(trim(p_name), '') IS NULL THEN RAISE EXCEPTION 'Cycle name is required'; END IF;
  IF EXISTS (SELECT 1 FROM public.vsla_cycles WHERE organization_id = v_org_id AND status = 'active') THEN
    RAISE EXCEPTION 'Close the active cycle before starting another';
  END IF;
  INSERT INTO public.vsla_cycles (organization_id, name, starts_on)
  VALUES (v_org_id, nullif(trim(p_name), ''), p_starts_on) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.vsla_finalize_shareout(p_cycle_id uuid, p_fund_total numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_cycle public.vsla_cycles%ROWTYPE;
  v_total_shares numeric;
  v_value_per_share numeric;
  v_payouts jsonb;
  v_shareout_id uuid;
BEGIN
  SELECT * INTO v_cycle FROM public.vsla_cycles WHERE id = p_cycle_id FOR UPDATE;
  IF v_cycle.id IS NULL OR v_cycle.status <> 'active' THEN RAISE EXCEPTION 'Active cycle not found'; END IF;
  IF NOT (public.is_platform_admin() OR v_cycle.organization_id = public.auth_staff_org_id()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_fund_total <= 0 THEN RAISE EXCEPTION 'Fund total must be positive'; END IF;
  IF EXISTS (SELECT 1 FROM public.vsla_loans WHERE cycle_id = p_cycle_id AND status = 'disbursed' AND outstanding_balance > 0) THEN
    RAISE EXCEPTION 'Resolve outstanding loans before finalizing share-out';
  END IF;

  SELECT COALESCE(sum(shares_bought), 0) INTO v_total_shares
  FROM public.vsla_share_transactions WHERE cycle_id = p_cycle_id;
  IF v_total_shares <= 0 THEN RAISE EXCEPTION 'The cycle has no shares to distribute'; END IF;
  v_value_per_share := p_fund_total / v_total_shares;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'member_id', member_id, 'shares', shares, 'payout_amount', shares * v_value_per_share
  ) ORDER BY member_id), '[]'::jsonb) INTO v_payouts
  FROM (
    SELECT member_id, sum(shares_bought)::numeric AS shares
    FROM public.vsla_share_transactions WHERE cycle_id = p_cycle_id GROUP BY member_id
  ) totals;

  INSERT INTO public.vsla_cycle_shareout
    (organization_id, cycle_id, fund_total, total_shares, value_per_share, payout_sheet, finalized)
  VALUES
    (v_cycle.organization_id, p_cycle_id, p_fund_total, v_total_shares, v_value_per_share, v_payouts, true)
  RETURNING id INTO v_shareout_id;
  UPDATE public.vsla_cycles SET status = 'closed', ends_on = CURRENT_DATE, closed_at = now()
  WHERE id = p_cycle_id;
  RETURN v_shareout_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.vsla_start_cycle(text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vsla_finalize_shareout(uuid, numeric) TO authenticated;
