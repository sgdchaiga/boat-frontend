-- Structured, reviewable VSLA minutes with quorum and signatory controls.

ALTER TABLE public.vsla_meetings
  ADD COLUMN IF NOT EXISTS minutes_status text NOT NULL DEFAULT 'draft'
    CHECK (minutes_status IN ('draft','final')),
  ADD COLUMN IF NOT EXISTS minutes_agenda jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS minutes_resolutions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS minutes_signatories jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS quorum_required integer NOT NULL DEFAULT 1 CHECK (quorum_required > 0),
  ADD COLUMN IF NOT EXISTS quorum_present integer NOT NULL DEFAULT 0 CHECK (quorum_present >= 0),
  ADD COLUMN IF NOT EXISTS minutes_finalized_at timestamptz;

CREATE OR REPLACE FUNCTION public.vsla_save_structured_minutes(
  p_meeting_id uuid,
  p_minutes text,
  p_agenda jsonb,
  p_resolutions jsonb,
  p_signatories jsonb,
  p_quorum_required integer,
  p_quorum_present integer,
  p_finalize boolean DEFAULT false
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_meeting public.vsla_meetings%ROWTYPE; v_signed_count integer;
BEGIN
  SELECT * INTO v_meeting FROM public.vsla_meetings WHERE id = p_meeting_id FOR UPDATE;
  IF v_meeting.id IS NULL THEN RAISE EXCEPTION 'Meeting not found'; END IF;
  IF NOT (public.is_platform_admin() OR v_meeting.organization_id = public.auth_staff_org_id()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_meeting.status = 'closed' THEN RAISE EXCEPTION 'Minutes for a closed meeting are locked'; END IF;
  IF p_quorum_required <= 0 OR p_quorum_present < 0 THEN RAISE EXCEPTION 'Quorum values are invalid'; END IF;
  IF jsonb_typeof(COALESCE(p_agenda, '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(COALESCE(p_resolutions, '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(COALESCE(p_signatories, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Minutes sections must be valid lists';
  END IF;
  IF p_finalize THEN
    SELECT count(*) INTO v_signed_count FROM jsonb_array_elements(COALESCE(p_signatories, '[]'::jsonb)) s
    WHERE nullif(trim(s->>'name'), '') IS NOT NULL AND COALESCE((s->>'confirmed')::boolean, false);
    IF p_quorum_present < p_quorum_required THEN RAISE EXCEPTION 'Quorum has not been met'; END IF;
    IF nullif(trim(COALESCE(p_minutes, '')), '') IS NULL THEN RAISE EXCEPTION 'Discussion notes are required'; END IF;
    IF jsonb_array_length(COALESCE(p_agenda, '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'At least one agenda item is required'; END IF;
    IF v_signed_count < 2 THEN RAISE EXCEPTION 'Chairperson and secretary must confirm the minutes'; END IF;
  END IF;
  UPDATE public.vsla_meetings SET
    minutes = p_minutes,
    minutes_agenda = COALESCE(p_agenda, '[]'::jsonb),
    minutes_resolutions = COALESCE(p_resolutions, '[]'::jsonb),
    minutes_signatories = COALESCE(p_signatories, '[]'::jsonb),
    quorum_required = p_quorum_required,
    quorum_present = p_quorum_present,
    minutes_status = CASE WHEN p_finalize THEN 'final' ELSE 'draft' END,
    minutes_finalized_at = CASE WHEN p_finalize THEN now() ELSE NULL END
  WHERE id = p_meeting_id;
  RETURN CASE WHEN p_finalize THEN 'final' ELSE 'draft' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.vsla_lock_closed_meeting_governance()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'closed' AND (
    NEW.minutes IS DISTINCT FROM OLD.minutes OR
    NEW.minutes_agenda IS DISTINCT FROM OLD.minutes_agenda OR
    NEW.minutes_resolutions IS DISTINCT FROM OLD.minutes_resolutions OR
    NEW.minutes_signatories IS DISTINCT FROM OLD.minutes_signatories OR
    NEW.quorum_required IS DISTINCT FROM OLD.quorum_required OR
    NEW.quorum_present IS DISTINCT FROM OLD.quorum_present OR
    NEW.minutes_status IS DISTINCT FROM OLD.minutes_status OR
    NEW.minutes_attachment_path IS DISTINCT FROM OLD.minutes_attachment_path
  ) THEN RAISE EXCEPTION 'Minutes for a closed meeting are locked'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vsla_lock_closed_meeting_governance ON public.vsla_meetings;
CREATE TRIGGER trg_vsla_lock_closed_meeting_governance
BEFORE UPDATE ON public.vsla_meetings FOR EACH ROW
EXECUTE FUNCTION public.vsla_lock_closed_meeting_governance();

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
    IF NEW.minutes_status <> 'final' THEN RAISE EXCEPTION 'Finalize the meeting minutes before closing'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.vsla_save_structured_minutes(uuid, text, jsonb, jsonb, jsonb, integer, integer, boolean) TO authenticated;

-- Restrict private minutes attachments to the user's organization folder.
DROP POLICY IF EXISTS "vsla_meeting_minutes_authenticated_all" ON storage.objects;
DROP POLICY IF EXISTS "vsla_meeting_minutes_tenant_all" ON storage.objects;
CREATE POLICY "vsla_meeting_minutes_tenant_all"
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'vsla-meeting-minutes' AND
    (public.is_platform_admin() OR split_part(name, '/', 1) = public.auth_staff_org_id()::text)
  )
  WITH CHECK (
    bucket_id = 'vsla-meeting-minutes' AND
    (public.is_platform_admin() OR split_part(name, '/', 1) = public.auth_staff_org_id()::text)
  );
