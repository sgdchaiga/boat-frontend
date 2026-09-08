-- Enterprise-safe journal edit path:
-- - keep revision history before any edit
-- - perform update atomically in one RPC
-- - enforce tenant access at DB layer

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS revision_no integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.journal_entry_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  revision_no integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  header_snapshot jsonb NOT NULL,
  lines_snapshot jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_journal_entry_revisions_entry
  ON public.journal_entry_revisions (journal_entry_id, revision_no DESC);

CREATE INDEX IF NOT EXISTS idx_journal_entry_revisions_org
  ON public.journal_entry_revisions (organization_id, changed_at DESC);

ALTER TABLE public.journal_entry_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_journal_entry_revisions_select" ON public.journal_entry_revisions;
CREATE POLICY "org_journal_entry_revisions_select"
  ON public.journal_entry_revisions
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = (SELECT auth.uid())
        AND s.organization_id = journal_entry_revisions.organization_id
    )
  );

DROP POLICY IF EXISTS "org_journal_entry_revisions_write" ON public.journal_entry_revisions;
CREATE POLICY "org_journal_entry_revisions_write"
  ON public.journal_entry_revisions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = (SELECT auth.uid())
        AND s.organization_id = journal_entry_revisions.organization_id
    )
  );

CREATE OR REPLACE FUNCTION public.update_journal_entry_safe(
  p_entry_id uuid,
  p_entry_date date,
  p_description text,
  p_lines jsonb,
  p_updated_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.journal_entries%ROWTYPE;
  v_user_org uuid;
  v_actor uuid;
  v_lines jsonb;
  v_line jsonb;
  v_gl uuid;
  v_dr numeric(15,2);
  v_cr numeric(15,2);
  v_desc text;
  v_dims jsonb;
  v_total_dr numeric(15,2) := 0;
  v_total_cr numeric(15,2) := 0;
  v_idx int := 0;
BEGIN
  IF p_description IS NULL OR btrim(p_description) = '' THEN
    RAISE EXCEPTION 'Description is required';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'At least two journal lines are required';
  END IF;

  SELECT *
  INTO v_entry
  FROM public.journal_entries
  WHERE id = p_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found';
  END IF;

  IF NOT public.is_platform_admin() THEN
    SELECT s.organization_id
    INTO v_user_org
    FROM public.staff s
    WHERE s.id = (SELECT auth.uid());

    IF v_user_org IS NULL OR v_user_org IS DISTINCT FROM v_entry.organization_id THEN
      RAISE EXCEPTION 'Not allowed to edit this journal entry';
    END IF;
  END IF;

  v_actor := COALESCE(p_updated_by, (SELECT auth.uid()));

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', jel.id,
        'gl_account_id', jel.gl_account_id,
        'debit', jel.debit,
        'credit', jel.credit,
        'line_description', jel.line_description,
        'sort_order', jel.sort_order,
        'dimensions', COALESCE(jel.dimensions, '{}'::jsonb)
      )
      ORDER BY jel.sort_order, jel.id
    ),
    '[]'::jsonb
  )
  INTO v_lines
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = p_entry_id;

  INSERT INTO public.journal_entry_revisions (
    journal_entry_id,
    organization_id,
    revision_no,
    changed_by,
    header_snapshot,
    lines_snapshot
  )
  VALUES (
    p_entry_id,
    v_entry.organization_id,
    v_entry.revision_no,
    v_actor,
    to_jsonb(v_entry),
    v_lines
  );

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_gl := (v_line->>'gl_account_id')::uuid;
    v_dr := COALESCE((v_line->>'debit')::numeric, 0);
    v_cr := COALESCE((v_line->>'credit')::numeric, 0);

    IF v_gl IS NULL THEN
      RAISE EXCEPTION 'Each line must include gl_account_id';
    END IF;
    IF v_dr < 0 OR v_cr < 0 THEN
      RAISE EXCEPTION 'Debit and credit must be non-negative';
    END IF;
    IF v_dr > 0 AND v_cr > 0 THEN
      RAISE EXCEPTION 'Each line must have either debit or credit, not both';
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

  UPDATE public.journal_entries
  SET
    entry_date = p_entry_date,
    description = btrim(p_description),
    revision_no = v_entry.revision_no + 1
  WHERE id = p_entry_id;

  DELETE FROM public.journal_entry_lines
  WHERE journal_entry_id = p_entry_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_gl := (v_line->>'gl_account_id')::uuid;
    v_dr := COALESCE((v_line->>'debit')::numeric, 0);
    v_cr := COALESCE((v_line->>'credit')::numeric, 0);
    v_desc := NULLIF(btrim(COALESCE(v_line->>'line_description', '')), '');
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
    )
    VALUES (
      p_entry_id,
      v_gl,
      v_dr,
      v_cr,
      v_desc,
      v_idx,
      v_dims
    );
    v_idx := v_idx + 1;
  END LOOP;

  RETURN p_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_journal_entry_safe(uuid, date, text, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_journal_entry_safe(uuid, date, text, jsonb, uuid) TO authenticated;
