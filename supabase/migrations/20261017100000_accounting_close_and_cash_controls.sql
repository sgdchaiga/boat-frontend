-- Month-end close controls for every organization using the accounting ledger.
-- The journal period lock remains the enforcement point; this migration makes
-- each close/reopen reviewable and prevents the lock from being a hidden setting.

CREATE TABLE IF NOT EXISTS public.accounting_period_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'closed' CHECK (status IN ('closed', 'reopened')),
  checklist_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciliation_note text,
  closed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  reopened_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounting_period_closes_month_range CHECK (
    period_start = date_trunc('month', period_start)::date
    AND period_end = (date_trunc('month', period_start) + interval '1 month - 1 day')::date
  ),
  UNIQUE (organization_id, period_end)
);

CREATE INDEX IF NOT EXISTS idx_accounting_period_closes_org_end
  ON public.accounting_period_closes (organization_id, period_end DESC);

ALTER TABLE public.accounting_period_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounting_period_closes_select_same_org ON public.accounting_period_closes;
CREATE POLICY accounting_period_closes_select_same_org
  ON public.accounting_period_closes FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid() AND s.organization_id = accounting_period_closes.organization_id
    )
  );

-- Close/reopen is intentionally available only through the RPCs below. This
-- keeps the audit record and the journal lock in one transaction.
REVOKE INSERT, UPDATE, DELETE ON public.accounting_period_closes FROM authenticated;
GRANT SELECT ON public.accounting_period_closes TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manage_accounting_close(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.organization_id = p_organization_id
        AND lower(coalesce(s.role::text, '')) IN ('admin', 'super_admin', 'manager', 'accountant')
    );
$$;

CREATE OR REPLACE FUNCTION public.close_accounting_period(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_reconciliation_note text DEFAULT NULL,
  p_checklist_snapshot jsonb DEFAULT '{}'::jsonb
)
RETURNS public.accounting_period_closes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debits numeric := 0;
  v_credits numeric := 0;
  v_posted_count integer := 0;
  v_existing_lock date;
  v_next_lock date;
  v_close public.accounting_period_closes;
BEGIN
  IF NOT public.can_manage_accounting_close(p_organization_id) THEN
    RAISE EXCEPTION 'Only an accounting manager, accountant, or administrator can close a period.' USING ERRCODE = '42501';
  END IF;

  IF p_period_start IS NULL OR p_period_end IS NULL
    OR p_period_start <> date_trunc('month', p_period_start)::date
    OR p_period_end <> (date_trunc('month', p_period_start) + interval '1 month - 1 day')::date THEN
    RAISE EXCEPTION 'A close must cover exactly one calendar month.' USING ERRCODE = '22007';
  END IF;

  IF p_period_end >= CURRENT_DATE THEN
    RAISE EXCEPTION 'Only a completed month can be closed.' USING ERRCODE = '22007';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.journal_entries je
    WHERE je.organization_id = p_organization_id
      AND je.entry_date BETWEEN p_period_start AND p_period_end
      AND COALESCE(je.is_deleted, false) = false
      AND COALESCE(je.is_posted, true) = false
  ) THEN
    RAISE EXCEPTION 'Post or remove all draft journal entries before closing this period.' USING ERRCODE = '55000';
  END IF;

  SELECT
    COALESCE(SUM(jel.debit), 0),
    COALESCE(SUM(jel.credit), 0),
    COUNT(DISTINCT je.id)
  INTO v_debits, v_credits, v_posted_count
  FROM public.journal_entries je
  JOIN public.journal_entry_lines jel ON jel.journal_entry_id = je.id
  WHERE je.organization_id = p_organization_id
    AND je.entry_date BETWEEN p_period_start AND p_period_end
    AND COALESCE(je.is_deleted, false) = false
    AND COALESCE(je.is_posted, true) = true;

  IF abs(v_debits - v_credits) > 0.005 THEN
    RAISE EXCEPTION 'The posted trial balance is out of balance by %.', abs(v_debits - v_credits) USING ERRCODE = '55000';
  END IF;

  v_next_lock := (p_period_end + 1);
  SELECT period_lock_before_date INTO v_existing_lock
  FROM public.journal_gl_settings
  WHERE organization_id = p_organization_id
  FOR UPDATE;

  IF v_existing_lock IS NOT NULL AND v_existing_lock > v_next_lock THEN
    RAISE EXCEPTION 'A later period is already locked. Reopen later periods first.' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.journal_gl_settings (organization_id, period_lock_before_date)
  VALUES (p_organization_id, v_next_lock)
  ON CONFLICT (organization_id) DO UPDATE
  SET period_lock_before_date = GREATEST(
    COALESCE(public.journal_gl_settings.period_lock_before_date, EXCLUDED.period_lock_before_date),
    EXCLUDED.period_lock_before_date
  ),
  updated_at = now();

  INSERT INTO public.accounting_period_closes (
    organization_id, period_start, period_end, status, checklist_snapshot,
    reconciliation_note, closed_by, closed_at, updated_at
  ) VALUES (
    p_organization_id, p_period_start, p_period_end, 'closed',
    COALESCE(p_checklist_snapshot, '{}'::jsonb) || jsonb_build_object(
      'posted_journals', v_posted_count,
      'total_debits', v_debits,
      'total_credits', v_credits,
      'locked_before', v_next_lock
    ),
    NULLIF(btrim(COALESCE(p_reconciliation_note, '')), ''), auth.uid(), now(), now()
  )
  ON CONFLICT (organization_id, period_end) DO UPDATE
  SET status = 'closed',
      checklist_snapshot = EXCLUDED.checklist_snapshot,
      reconciliation_note = EXCLUDED.reconciliation_note,
      closed_by = EXCLUDED.closed_by,
      closed_at = EXCLUDED.closed_at,
      reopened_by = NULL,
      reopened_at = NULL,
      reopen_reason = NULL,
      updated_at = now()
  RETURNING * INTO v_close;

  RETURN v_close;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_accounting_period(
  p_organization_id uuid,
  p_period_end date,
  p_reason text
)
RETURNS public.accounting_period_closes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_close public.accounting_period_closes;
  v_later_close_exists boolean;
  v_previous_period_end date;
BEGIN
  IF NOT public.can_manage_accounting_close(p_organization_id) THEN
    RAISE EXCEPTION 'Only an accounting manager, accountant, or administrator can reopen a period.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason before reopening a closed period.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_close
  FROM public.accounting_period_closes
  WHERE organization_id = p_organization_id
    AND period_end = p_period_end
    AND status = 'closed'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No closed period was found for this month.' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.accounting_period_closes
    WHERE organization_id = p_organization_id
      AND status = 'closed'
      AND period_end > p_period_end
  ) INTO v_later_close_exists;
  IF v_later_close_exists THEN
    RAISE EXCEPTION 'Reopen the most recently closed period first.' USING ERRCODE = '55000';
  END IF;

  SELECT max(period_end) INTO v_previous_period_end
  FROM public.accounting_period_closes
  WHERE organization_id = p_organization_id
    AND status = 'closed'
    AND period_end < p_period_end;

  UPDATE public.journal_gl_settings
  SET period_lock_before_date = CASE
        WHEN v_previous_period_end IS NULL THEN NULL
        ELSE v_previous_period_end + 1
      END,
      updated_at = now()
  WHERE organization_id = p_organization_id;

  UPDATE public.accounting_period_closes
  SET status = 'reopened',
      reopened_by = auth.uid(),
      reopened_at = now(),
      reopen_reason = btrim(p_reason),
      updated_at = now()
  WHERE id = v_close.id
  RETURNING * INTO v_close;

  RETURN v_close;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_accounting_close(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_accounting_period(uuid, date, date, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_accounting_period(uuid, date, text) TO authenticated;

COMMENT ON TABLE public.accounting_period_closes IS 'Audited accounting-month close and controlled reopen history.';
COMMENT ON FUNCTION public.close_accounting_period(uuid, date, date, text, jsonb) IS 'Balances, records, and locks a completed accounting month atomically.';
