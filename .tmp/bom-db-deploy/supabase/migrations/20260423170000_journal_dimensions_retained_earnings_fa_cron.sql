-- Journal line dimensions (multi-branch / department tagging), retained earnings for revaluation recycling,
-- optional pg_cron hook to refresh fixed-asset depreciation alerts.

-- 1) Line-level dimensions (JSON for flexibility: branch, department_id, entity_code, …)
ALTER TABLE public.journal_entry_lines
  ADD COLUMN IF NOT EXISTS dimensions jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.journal_entry_lines.dimensions IS
  'Optional analytics dimensions, e.g. {"branch":"Main","department_id":"uuid"}. Not required to balance.';

CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_dimensions_gin
  ON public.journal_entry_lines USING gin (dimensions jsonb_path_ops);

-- 2) Retained earnings — revaluation reserve recycling on asset disposal (OCI → equity)
ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS retained_earnings_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.journal_gl_settings.retained_earnings_gl_account_id IS
  'Equity: retained earnings — used when recycling revaluation reserve on fixed asset disposal.';

-- 3) Depreciation due alerts (populated by refresh function; app or cron calls it)
CREATE TABLE IF NOT EXISTS public.fixed_asset_depreciation_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('monthly', 'yearly')),
  created_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  UNIQUE (organization_id, period_end, frequency)
);

CREATE INDEX IF NOT EXISTS idx_fa_dep_alerts_org ON public.fixed_asset_depreciation_alerts(organization_id);

ALTER TABLE public.fixed_asset_depreciation_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fa_dep_alerts_staff" ON public.fixed_asset_depreciation_alerts;
CREATE POLICY "fa_dep_alerts_staff"
  ON public.fixed_asset_depreciation_alerts FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (SELECT auth.uid()) AND s.organization_id = fixed_asset_depreciation_alerts.organization_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (SELECT auth.uid()) AND s.organization_id = fixed_asset_depreciation_alerts.organization_id
    )
  );

DROP POLICY IF EXISTS "fa_dep_alerts_platform" ON public.fixed_asset_depreciation_alerts;
CREATE POLICY "fa_dep_alerts_platform"
  ON public.fixed_asset_depreciation_alerts FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- 4) Atomic journal RPC: persist optional per-line dimensions
CREATE OR REPLACE FUNCTION public.create_journal_entry_atomic(
  p_entry_date date,
  p_description text,
  p_reference_type text,
  p_reference_id uuid,
  p_created_by uuid,
  p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_total_dr numeric(15,2) := 0;
  v_total_cr numeric(15,2) := 0;
  v_line jsonb;
  v_idx int := 0;
  v_gl uuid;
  v_dr numeric(15,2);
  v_cr numeric(15,2);
  v_desc text;
  v_dims jsonb;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'At least two journal lines are required';
  END IF;

  IF p_reference_id IS NOT NULL THEN
    SELECT je.id INTO v_id
    FROM public.journal_entries je
    WHERE je.reference_type IS NOT DISTINCT FROM p_reference_type
      AND je.reference_id = p_reference_id;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_dr := COALESCE((v_line->>'debit')::numeric, 0);
    v_cr := COALESCE((v_line->>'credit')::numeric, 0);
    IF v_dr < 0 OR v_cr < 0 THEN
      RAISE EXCEPTION 'Debit and credit must be non-negative';
    END IF;
    IF v_dr > 0 AND v_cr > 0 THEN
      RAISE EXCEPTION 'Each line must have either a debit or a credit, not both';
    END IF;
    IF v_dr = 0 AND v_cr = 0 THEN
      RAISE EXCEPTION 'Each line must have a non-zero debit or credit';
    END IF;
    v_total_dr := v_total_dr + v_dr;
    v_total_cr := v_total_cr + v_cr;
  END LOOP;

  IF ABS(v_total_dr - v_total_cr) > 0.01 THEN
    RAISE EXCEPTION 'Debits must equal credits';
  END IF;

  BEGIN
    INSERT INTO public.journal_entries (entry_date, description, reference_type, reference_id, created_by)
    VALUES (p_entry_date, p_description, p_reference_type, p_reference_id, p_created_by)
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT je.id INTO v_id
      FROM public.journal_entries je
      WHERE p_reference_id IS NOT NULL
        AND je.reference_type IS NOT DISTINCT FROM p_reference_type
        AND je.reference_id = p_reference_id;
      IF v_id IS NOT NULL THEN
        RETURN v_id;
      END IF;
      RAISE;
  END;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_gl := (v_line->>'gl_account_id')::uuid;
    v_dr := COALESCE((v_line->>'debit')::numeric, 0);
    v_cr := COALESCE((v_line->>'credit')::numeric, 0);
    v_desc := NULLIF(TRIM(COALESCE(v_line->>'line_description', '')), '');
    v_dims := COALESCE(v_line->'dimensions', '{}'::jsonb);
    IF jsonb_typeof(v_dims) IS DISTINCT FROM 'object' THEN
      v_dims := '{}'::jsonb;
    END IF;
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      gl_account_id,
      debit,
      credit,
      line_description,
      sort_order,
      dimensions
    ) VALUES (
      v_id,
      v_gl,
      v_dr,
      v_cr,
      v_desc,
      v_idx,
      v_dims
    );
    v_idx := v_idx + 1;
  END LOOP;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb) IS
  'Atomic journal header + lines; optional per-line "dimensions" jsonb object. SECURITY DEFINER.';

-- 5) Refresh alerts: orgs with FA module, auto schedule on, period due, no posted run yet
CREATE OR REPLACE FUNCTION public.refresh_fixed_asset_depreciation_alerts()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_row int;
  r record;
  v_last date;
  v_freq text;
  v_start date;
  v_end date;
  v_today date := (CURRENT_TIMESTAMP AT TIME ZONE 'utc')::date;
  v_has_posted boolean;
  v_has_assets boolean;
BEGIN
  FOR r IN
    SELECT o.id AS org_id, s.auto_depreciation_last_period_end, s.auto_depreciation_frequency
    FROM public.organizations o
    INNER JOIN public.fixed_asset_org_settings s ON s.organization_id = o.id
    WHERE o.enable_fixed_assets = true
      AND s.auto_depreciation_enabled = true
  LOOP
    v_last := r.auto_depreciation_last_period_end;
    v_freq := r.auto_depreciation_frequency;

    IF v_freq = 'monthly' THEN
      IF v_last IS NULL THEN
        v_start := date_trunc('month', v_today::timestamp)::date;
        v_end := (date_trunc('month', v_today::timestamp) + interval '1 month - 1 day')::date;
      ELSE
        v_start := (v_last + interval '1 day')::date;
        v_end := (date_trunc('month', v_start::timestamp) + interval '1 month - 1 day')::date;
      END IF;
    ELSE
      IF v_last IS NULL THEN
        v_start := make_date(EXTRACT(YEAR FROM v_today)::int, 1, 1);
        v_end := make_date(EXTRACT(YEAR FROM v_today)::int, 12, 31);
      ELSE
        v_start := (v_last + interval '1 day')::date;
        v_end := (v_start + interval '1 year' - interval '1 day')::date;
      END IF;
    END IF;

    IF v_today < v_end THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.fixed_asset_depreciation_runs j
      WHERE j.organization_id = r.org_id
        AND j.period_end = v_end
        AND j.frequency = v_freq
        AND j.status = 'posted'
    ) INTO v_has_posted;
    IF v_has_posted THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.fixed_assets fa
      WHERE fa.organization_id = r.org_id AND fa.status = 'capitalized'
    ) INTO v_has_assets;
    IF NOT v_has_assets THEN
      CONTINUE;
    END IF;

    INSERT INTO public.fixed_asset_depreciation_alerts (
      organization_id, period_start, period_end, frequency
    )
    VALUES (r.org_id, v_start, v_end, v_freq)
    ON CONFLICT (organization_id, period_end, frequency) DO NOTHING;
    GET DIAGNOSTICS v_row = ROW_COUNT;
    IF v_row > 0 THEN
      v_inserted := v_inserted + v_row;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.refresh_fixed_asset_depreciation_alerts() IS
  'Creates one row per due depreciation period (idempotent). Call from pg_cron daily or on app load.';

GRANT EXECUTE ON FUNCTION public.refresh_fixed_asset_depreciation_alerts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_fixed_asset_depreciation_alerts() TO service_role;

-- 6) Optional: daily refresh when pg_cron is available (Supabase: enable pg_cron in project settings first)
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'fixed_asset_dep_refresh',
      '30 5 * * *',
      'SELECT public.refresh_fixed_asset_depreciation_alerts()'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$cron$;

REVOKE ALL ON FUNCTION public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb) TO authenticated;
