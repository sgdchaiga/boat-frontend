-- Accounting controls: bulk actions + immutable audit log snapshots.

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_posted boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_journal_entries_org_deleted_date
  ON public.journal_entries (organization_id, is_deleted, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_journal_entries_org_posted_deleted
  ON public.journal_entries (organization_id, is_posted, is_deleted);

CREATE TABLE IF NOT EXISTS public.journal_entry_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('edit', 'bulk_post', 'bulk_unpost', 'bulk_soft_delete')),
  old_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_entry_audit_log_entry_created
  ON public.journal_entry_audit_log (journal_entry_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_journal_entry_audit_log_org_created
  ON public.journal_entry_audit_log (organization_id, created_at DESC);

ALTER TABLE public.journal_entry_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_journal_entry_audit_log_select" ON public.journal_entry_audit_log;
CREATE POLICY "org_journal_entry_audit_log_select"
  ON public.journal_entry_audit_log
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = (SELECT auth.uid())
        AND s.organization_id = journal_entry_audit_log.organization_id
    )
  );

DROP POLICY IF EXISTS "org_journal_entry_audit_log_insert" ON public.journal_entry_audit_log;
CREATE POLICY "org_journal_entry_audit_log_insert"
  ON public.journal_entry_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = (SELECT auth.uid())
        AND s.organization_id = journal_entry_audit_log.organization_id
    )
  );

CREATE OR REPLACE FUNCTION public.update_journal_entry_safe_with_audit(
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
  v_before_header jsonb;
  v_before_lines jsonb;
  v_after_header jsonb;
  v_after_lines jsonb;
  v_org_id uuid;
  v_id uuid;
BEGIN
  SELECT to_jsonb(je), je.organization_id
  INTO v_before_header, v_org_id
  FROM public.journal_entries je
  WHERE je.id = p_entry_id;

  IF v_before_header IS NULL THEN
    RAISE EXCEPTION 'Journal entry not found';
  END IF;

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
  INTO v_before_lines
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = p_entry_id;

  v_id := public.update_journal_entry_safe(
    p_entry_id,
    p_entry_date,
    p_description,
    p_lines,
    p_updated_by
  );

  SELECT to_jsonb(je)
  INTO v_after_header
  FROM public.journal_entries je
  WHERE je.id = p_entry_id;

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
  INTO v_after_lines
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = p_entry_id;

  INSERT INTO public.journal_entry_audit_log (
    journal_entry_id, organization_id, user_id, action, old_values, new_values
  )
  VALUES (
    p_entry_id,
    v_org_id,
    COALESCE(p_updated_by, (SELECT auth.uid())),
    'edit',
    jsonb_build_object('header', v_before_header, 'lines', v_before_lines),
    jsonb_build_object('header', v_after_header, 'lines', v_after_lines)
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_journal_entry_safe_with_audit(uuid, date, text, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_journal_entry_safe_with_audit(uuid, date, text, jsonb, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bulk_set_journal_entries_posted(
  p_entry_ids uuid[],
  p_is_posted boolean,
  p_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_org uuid;
  v_period_lock_before date;
  v_count integer := 0;
BEGIN
  IF p_entry_ids IS NULL OR array_length(p_entry_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  IF NOT public.is_platform_admin() THEN
    SELECT s.organization_id
    INTO v_user_org
    FROM public.staff s
    WHERE s.id = (SELECT auth.uid());

    SELECT jgs.period_lock_before_date
    INTO v_period_lock_before
    FROM public.journal_gl_settings jgs
    WHERE jgs.organization_id = v_user_org;
  END IF;

  INSERT INTO public.journal_entry_audit_log (
    journal_entry_id, organization_id, user_id, action, old_values, new_values
  )
  SELECT
    je.id,
    je.organization_id,
    COALESCE(p_user_id, (SELECT auth.uid())),
    CASE WHEN p_is_posted THEN 'bulk_post' ELSE 'bulk_unpost' END,
    jsonb_build_object('is_posted', je.is_posted, 'is_deleted', je.is_deleted),
    jsonb_build_object('is_posted', p_is_posted, 'is_deleted', je.is_deleted)
  FROM public.journal_entries je
  WHERE je.id = ANY(p_entry_ids)
    AND je.is_deleted = false
    AND (public.is_platform_admin() OR je.organization_id = v_user_org);

  UPDATE public.journal_entries je
  SET is_posted = p_is_posted
  WHERE je.id = ANY(p_entry_ids)
    AND je.is_deleted = false
    AND (public.is_platform_admin() OR v_period_lock_before IS NULL OR je.entry_date >= v_period_lock_before)
    AND (public.is_platform_admin() OR je.organization_id = v_user_org);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_set_journal_entries_posted(uuid[], boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_set_journal_entries_posted(uuid[], boolean, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bulk_soft_delete_journal_entries(
  p_entry_ids uuid[],
  p_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_org uuid;
  v_period_lock_before date;
  v_count integer := 0;
BEGIN
  IF p_entry_ids IS NULL OR array_length(p_entry_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  IF NOT public.is_platform_admin() THEN
    SELECT s.organization_id
    INTO v_user_org
    FROM public.staff s
    WHERE s.id = (SELECT auth.uid());

    SELECT jgs.period_lock_before_date
    INTO v_period_lock_before
    FROM public.journal_gl_settings jgs
    WHERE jgs.organization_id = v_user_org;
  END IF;

  INSERT INTO public.journal_entry_audit_log (
    journal_entry_id, organization_id, user_id, action, old_values, new_values
  )
  SELECT
    je.id,
    je.organization_id,
    COALESCE(p_user_id, (SELECT auth.uid())),
    'bulk_soft_delete',
    jsonb_build_object('is_deleted', je.is_deleted, 'is_posted', je.is_posted),
    jsonb_build_object('is_deleted', true, 'is_posted', je.is_posted)
  FROM public.journal_entries je
  WHERE je.id = ANY(p_entry_ids)
    AND je.is_deleted = false
    AND (public.is_platform_admin() OR je.organization_id = v_user_org);

  UPDATE public.journal_entries je
  SET is_deleted = true
  WHERE je.id = ANY(p_entry_ids)
    AND je.is_deleted = false
    AND (public.is_platform_admin() OR v_period_lock_before IS NULL OR je.entry_date >= v_period_lock_before)
    AND (public.is_platform_admin() OR je.organization_id = v_user_org);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_soft_delete_journal_entries(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_soft_delete_journal_entries(uuid[], uuid) TO authenticated;
