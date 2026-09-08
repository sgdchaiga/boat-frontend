-- Allow repaired journals to replace soft-deleted entries while retaining audit history.

DROP INDEX IF EXISTS public.journal_entries_reference_unique;

CREATE UNIQUE INDEX journal_entries_reference_unique
  ON public.journal_entries (reference_type, reference_id)
  WHERE reference_id IS NOT NULL AND is_deleted = false;

CREATE OR REPLACE FUNCTION public.create_journal_entry_atomic(
  p_entry_date date,
  p_description text,
  p_reference_type text,
  p_reference_id uuid,
  p_created_by uuid,
  p_lines jsonb,
  p_organization_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $create_journal_entry_atomic$
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
      AND je.reference_id = p_reference_id
      AND je.is_deleted = false;
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
    INSERT INTO public.journal_entries (
      entry_date, description, reference_type, reference_id, created_by, organization_id
    )
    VALUES (
      p_entry_date, p_description, p_reference_type, p_reference_id, p_created_by, p_organization_id
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT je.id INTO v_id
      FROM public.journal_entries je
      WHERE p_reference_id IS NOT NULL
        AND je.reference_type IS NOT DISTINCT FROM p_reference_type
        AND je.reference_id = p_reference_id
        AND je.is_deleted = false;
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
      journal_entry_id, gl_account_id, debit, credit, line_description, sort_order, dimensions
    )
    VALUES (v_id, v_gl, v_dr, v_cr, v_desc, v_idx, v_dims);
    v_idx := v_idx + 1;
  END LOOP;

  RETURN v_id;
END;
$create_journal_entry_atomic$;

REVOKE ALL ON FUNCTION public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb, uuid) TO service_role;

COMMENT ON FUNCTION public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb, uuid) IS
  'Atomic journal header + lines; idempotent only against active journals so soft-deleted entries can be repaired.';
