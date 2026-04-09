-- Accounting engine: atomic journal posting RPC, idempotency index, org-scoped GL role settings

-- 1) Per-organization default GL accounts for automated posting (replaces browser-localStorage as source of truth)
CREATE TABLE IF NOT EXISTS public.journal_gl_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  revenue_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  cash_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  receivable_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  expense_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  payable_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_gl_settings_org ON public.journal_gl_settings(organization_id);

ALTER TABLE public.journal_gl_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_journal_gl_settings_select" ON public.journal_gl_settings;
DROP POLICY IF EXISTS "org_journal_gl_settings_write" ON public.journal_gl_settings;

CREATE POLICY "org_journal_gl_settings_select"
  ON public.journal_gl_settings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.organization_id = journal_gl_settings.organization_id
    )
  );

CREATE POLICY "org_journal_gl_settings_write"
  ON public.journal_gl_settings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.organization_id = journal_gl_settings.organization_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.organization_id = journal_gl_settings.organization_id
    )
  );

-- 2) Remove duplicate journal headers for the same source (keep oldest), so a unique index can be applied
DELETE FROM public.journal_entry_lines jel
WHERE jel.journal_entry_id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY reference_type, reference_id
             ORDER BY created_at ASC NULLS LAST, id ASC
           ) AS rn
    FROM public.journal_entries
    WHERE reference_id IS NOT NULL
  ) sub
  WHERE rn > 1
);

DELETE FROM public.journal_entries je
WHERE je.id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY reference_type, reference_id
             ORDER BY created_at ASC NULLS LAST, id ASC
           ) AS rn
    FROM public.journal_entries
    WHERE reference_id IS NOT NULL
  ) sub
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_reference_unique
  ON public.journal_entries (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- 3) Single transaction: insert journal header + lines; idempotent when reference_id is set
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
SECURITY INVOKER
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
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      gl_account_id,
      debit,
      credit,
      line_description,
      sort_order
    ) VALUES (
      v_id,
      v_gl,
      v_dr,
      v_cr,
      v_desc,
      v_idx
    );
    v_idx := v_idx + 1;
  END LOOP;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb) TO authenticated;
