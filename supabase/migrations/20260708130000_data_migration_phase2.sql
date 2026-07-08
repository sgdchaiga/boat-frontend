-- Phase 2: self-service data migration.
-- Tracks CSV/Excel/Google Sheet imports and posts opening balances safely.

CREATE TABLE IF NOT EXISTS public.data_migration_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_type text NOT NULL CHECK (
    import_type IN (
      'customers',
      'suppliers',
      'products',
      'stock_opening',
      'opening_balances',
      'sacco_members',
      'sacco_savings',
      'custom'
    )
  ),
  source_type text NOT NULL DEFAULT 'csv' CHECK (source_type IN ('csv', 'excel', 'google_sheet', 'manual')),
  source_name text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'previewed', 'posted', 'failed', 'cancelled')),
  row_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  posted_journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_migration_batches_org_created
  ON public.data_migration_batches (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.data_migration_google_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_type text NOT NULL,
  name text NOT NULL,
  sheet_url text NOT NULL,
  csv_url text NOT NULL,
  last_synced_at timestamptz,
  last_status text,
  last_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, import_type, name)
);

CREATE INDEX IF NOT EXISTS idx_data_migration_google_sheets_org
  ON public.data_migration_google_sheets (organization_id, import_type, is_active);

CREATE TABLE IF NOT EXISTS public.opening_balance_import_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.data_migration_batches(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  account_code text,
  account_name text,
  debit numeric(15,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(15,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (debit = 0 OR credit = 0)
);

CREATE INDEX IF NOT EXISTS idx_opening_balance_import_lines_batch
  ON public.opening_balance_import_lines (batch_id, line_no);

ALTER TABLE public.data_migration_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_migration_google_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opening_balance_import_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS data_migration_batches_org_all ON public.data_migration_batches;
CREATE POLICY data_migration_batches_org_all
  ON public.data_migration_batches FOR ALL TO authenticated
  USING (public.is_platform_admin() OR public.user_is_member_of_org(organization_id))
  WITH CHECK (public.is_platform_admin() OR public.user_is_member_of_org(organization_id));

DROP POLICY IF EXISTS data_migration_google_sheets_org_all ON public.data_migration_google_sheets;
CREATE POLICY data_migration_google_sheets_org_all
  ON public.data_migration_google_sheets FOR ALL TO authenticated
  USING (public.is_platform_admin() OR public.user_is_member_of_org(organization_id))
  WITH CHECK (public.is_platform_admin() OR public.user_is_member_of_org(organization_id));

DROP POLICY IF EXISTS opening_balance_import_lines_org_all ON public.opening_balance_import_lines;
CREATE POLICY opening_balance_import_lines_org_all
  ON public.opening_balance_import_lines FOR ALL TO authenticated
  USING (public.is_platform_admin() OR public.user_is_member_of_org(organization_id))
  WITH CHECK (public.is_platform_admin() OR public.user_is_member_of_org(organization_id));

CREATE OR REPLACE FUNCTION public.post_opening_balance_import(
  p_organization_id uuid,
  p_as_of_date date,
  p_description text,
  p_lines jsonb,
  p_source_type text DEFAULT 'manual',
  p_source_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_batch_id uuid;
  v_journal_id uuid;
  v_line jsonb;
  v_line_no integer := 0;
  v_gl uuid;
  v_debit numeric(15,2);
  v_credit numeric(15,2);
  v_total_debit numeric(15,2) := 0;
  v_total_credit numeric(15,2) := 0;
  v_account record;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization id is required';
  END IF;

  IF NOT public.is_platform_admin() AND NOT public.user_is_member_of_org(p_organization_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization.';
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'Opening balance import requires at least two lines.';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_gl := NULLIF(v_line ->> 'gl_account_id', '')::uuid;
    v_debit := COALESCE(NULLIF(v_line ->> 'debit', '')::numeric, 0);
    v_credit := COALESCE(NULLIF(v_line ->> 'credit', '')::numeric, 0);

    IF v_gl IS NULL THEN
      RAISE EXCEPTION 'Line % is missing gl_account_id.', v_line_no + 1;
    END IF;
    IF v_debit < 0 OR v_credit < 0 THEN
      RAISE EXCEPTION 'Line % has a negative amount.', v_line_no + 1;
    END IF;
    IF v_debit > 0 AND v_credit > 0 THEN
      RAISE EXCEPTION 'Line % cannot have both debit and credit.', v_line_no + 1;
    END IF;
    IF v_debit = 0 AND v_credit = 0 THEN
      RAISE EXCEPTION 'Line % has no debit or credit.', v_line_no + 1;
    END IF;

    PERFORM 1
    FROM public.gl_accounts ga
    WHERE ga.id = v_gl
      AND ga.organization_id = p_organization_id
      AND COALESCE(ga.is_active, true) = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Line % references an account outside this organization or inactive account.', v_line_no + 1;
    END IF;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
    v_line_no := v_line_no + 1;
  END LOOP;

  IF ABS(v_total_debit - v_total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Opening balances are not balanced. Debit %, credit %.', v_total_debit, v_total_credit;
  END IF;

  INSERT INTO public.data_migration_batches (
    organization_id,
    import_type,
    source_type,
    source_name,
    status,
    row_count,
    summary,
    created_by
  )
  VALUES (
    p_organization_id,
    'opening_balances',
    COALESCE(NULLIF(trim(p_source_type), ''), 'manual'),
    NULLIF(trim(COALESCE(p_source_name, '')), ''),
    'previewed',
    jsonb_array_length(p_lines),
    jsonb_build_object('debit', v_total_debit, 'credit', v_total_credit, 'as_of_date', p_as_of_date),
    v_user_id
  )
  RETURNING id INTO v_batch_id;

  INSERT INTO public.journal_entries (
    entry_date,
    description,
    reference_type,
    reference_id,
    created_by,
    organization_id,
    is_posted,
    is_deleted
  )
  VALUES (
    COALESCE(p_as_of_date, CURRENT_DATE),
    COALESCE(NULLIF(trim(p_description), ''), 'Opening balances import'),
    'opening_balance_import',
    v_batch_id,
    v_user_id,
    p_organization_id,
    true,
    false
  )
  RETURNING id INTO v_journal_id;

  v_line_no := 0;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_no := v_line_no + 1;
    v_gl := NULLIF(v_line ->> 'gl_account_id', '')::uuid;
    v_debit := COALESCE(NULLIF(v_line ->> 'debit', '')::numeric, 0);
    v_credit := COALESCE(NULLIF(v_line ->> 'credit', '')::numeric, 0);

    SELECT ga.account_code, ga.account_name
      INTO v_account
    FROM public.gl_accounts ga
    WHERE ga.id = v_gl;

    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      gl_account_id,
      debit,
      credit,
      line_description,
      sort_order
    )
    VALUES (
      v_journal_id,
      v_gl,
      v_debit,
      v_credit,
      NULLIF(trim(COALESCE(v_line ->> 'memo', '')), ''),
      v_line_no
    );

    INSERT INTO public.opening_balance_import_lines (
      batch_id,
      organization_id,
      line_no,
      gl_account_id,
      account_code,
      account_name,
      debit,
      credit,
      memo
    )
    VALUES (
      v_batch_id,
      p_organization_id,
      v_line_no,
      v_gl,
      v_account.account_code,
      v_account.account_name,
      v_debit,
      v_credit,
      NULLIF(trim(COALESCE(v_line ->> 'memo', '')), '')
    );
  END LOOP;

  UPDATE public.data_migration_batches
  SET
    status = 'posted',
    posted_journal_entry_id = v_journal_id,
    posted_at = now(),
    updated_at = now()
  WHERE id = v_batch_id;

  UPDATE public.organization_onboarding_state
  SET completed_steps = (
      SELECT ARRAY(
        SELECT DISTINCT step
        FROM unnest(completed_steps || ARRAY['import_data', 'opening_balances']) AS step
      )
    ),
    updated_at = now()
  WHERE organization_id = p_organization_id;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'journal_entry_id', v_journal_id,
    'row_count', jsonb_array_length(p_lines),
    'debit', v_total_debit,
    'credit', v_total_credit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.post_opening_balance_import(uuid, date, text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_opening_balance_import(uuid, date, text, jsonb, text, text) TO authenticated;

COMMENT ON TABLE public.data_migration_batches IS
  'Phase 2 import audit trail for CSV, Excel, Google Sheets, stock counts, and opening balance migrations.';

COMMENT ON FUNCTION public.post_opening_balance_import(uuid, date, text, jsonb, text, text) IS
  'Validates and posts a balanced opening-balance journal, recording the import batch and source details.';
