-- Persist guided meeting progress and prevent incomplete meetings from closing.

ALTER TABLE public.vsla_meetings
  ADD COLUMN IF NOT EXISTS completed_steps text[] NOT NULL DEFAULT '{}'::text[];

CREATE OR REPLACE FUNCTION public.vsla_mark_meeting_step(p_meeting_id uuid, p_step text)
RETURNS text[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_meeting public.vsla_meetings%ROWTYPE; v_steps text[];
BEGIN
  IF p_step <> ALL (ARRAY['attendance','savings','loans','repayments','cash']) THEN
    RAISE EXCEPTION 'Unknown meeting workflow step';
  END IF;
  SELECT * INTO v_meeting FROM public.vsla_meetings WHERE id = p_meeting_id FOR UPDATE;
  IF v_meeting.id IS NULL THEN RAISE EXCEPTION 'Meeting not found'; END IF;
  IF NOT (public.is_platform_admin() OR v_meeting.organization_id = public.auth_staff_org_id()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_meeting.status <> 'open' THEN RAISE EXCEPTION 'Only an open meeting can be progressed'; END IF;
  IF p_step = 'attendance' AND (
    SELECT count(*) FROM public.vsla_meeting_attendance WHERE meeting_id = p_meeting_id
  ) < (
    SELECT count(*) FROM public.vsla_members WHERE organization_id = v_meeting.organization_id AND status = 'active'
  ) THEN RAISE EXCEPTION 'Mark every active member present or absent before completing attendance'; END IF;
  IF p_step = 'cash' AND NOT EXISTS (
    SELECT 1 FROM public.vsla_cashbox_snapshots WHERE meeting_id = p_meeting_id
  ) THEN RAISE EXCEPTION 'Save the cash reconciliation before completing the cash step'; END IF;
  UPDATE public.vsla_meetings
  SET completed_steps = array_append(completed_steps, p_step)
  WHERE id = p_meeting_id AND NOT (p_step = ANY(completed_steps))
  RETURNING completed_steps INTO v_steps;
  RETURN COALESCE(v_steps, v_meeting.completed_steps);
END;
$$;

CREATE OR REPLACE FUNCTION public.vsla_require_completed_workflow_on_close()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE required_step text;
BEGIN
  IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN
    FOREACH required_step IN ARRAY ARRAY['attendance','savings','loans','repayments','cash'] LOOP
      IF NOT (required_step = ANY(NEW.completed_steps)) THEN
        RAISE EXCEPTION 'Complete all meeting workflow steps before closing';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vsla_meeting_require_workflow ON public.vsla_meetings;
CREATE TRIGGER trg_vsla_meeting_require_workflow
BEFORE UPDATE OF status ON public.vsla_meetings
FOR EACH ROW EXECUTE FUNCTION public.vsla_require_completed_workflow_on_close();

GRANT EXECUTE ON FUNCTION public.vsla_mark_meeting_step(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.vsla_save_meeting_cash_reconciliation(
  p_meeting_id uuid,
  p_opening_cash numeric,
  p_inflow_savings numeric,
  p_inflow_repayments numeric,
  p_inflow_fines numeric,
  p_outflow_loans numeric,
  p_outflow_social_payouts numeric,
  p_physical_cash numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_meeting public.vsla_meetings%ROWTYPE; v_snapshot_id uuid;
BEGIN
  SELECT * INTO v_meeting FROM public.vsla_meetings WHERE id = p_meeting_id FOR UPDATE;
  IF v_meeting.id IS NULL OR v_meeting.status <> 'open' THEN RAISE EXCEPTION 'An open meeting is required'; END IF;
  IF NOT (public.is_platform_admin() OR v_meeting.organization_id = public.auth_staff_org_id()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_opening_cash < 0 OR p_physical_cash < 0 THEN RAISE EXCEPTION 'Cash amounts cannot be negative'; END IF;
  DELETE FROM public.vsla_cashbox_snapshots WHERE meeting_id = p_meeting_id;
  INSERT INTO public.vsla_cashbox_snapshots (
    organization_id, meeting_id, opening_cash, inflow_savings, inflow_repayments,
    inflow_fines, outflow_loans, outflow_social_payouts, physical_cash
  ) VALUES (
    v_meeting.organization_id, p_meeting_id, p_opening_cash, p_inflow_savings,
    p_inflow_repayments, p_inflow_fines, p_outflow_loans, p_outflow_social_payouts,
    p_physical_cash
  ) RETURNING id INTO v_snapshot_id;
  UPDATE public.vsla_meetings SET completed_steps = array_append(completed_steps, 'cash')
  WHERE id = p_meeting_id AND NOT ('cash' = ANY(completed_steps));
  RETURN v_snapshot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.vsla_save_meeting_cash_reconciliation(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric) TO authenticated;
