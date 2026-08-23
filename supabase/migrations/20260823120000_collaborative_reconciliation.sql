-- Collaborative, multi-source reconciliation sessions layered onto the existing engine.

CREATE TABLE IF NOT EXISTS public.reconciliation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  control_gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'bank',
  source_label text,
  period_start date NOT NULL,
  period_end date NOT NULL,
  work_mode text NOT NULL DEFAULT 'individual' CHECK (work_mode IN ('individual','collaborative')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','cashbook_ready','statement_verified','exceptions_resolved','ready_for_review','approved')),
  cashbook_ready boolean NOT NULL DEFAULT false,
  statement_verified boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approved_by uuid,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  UNIQUE (organization_id, control_gl_account_id, source_type, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS public.reconciliation_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.reconciliation_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('cashbook_owner','statement_owner','reviewer')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id, role)
);

CREATE TABLE IF NOT EXISTS public.reconciliation_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.reconciliation_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  statement_line_id uuid REFERENCES public.bank_statement_lines(id) ON DELETE CASCADE,
  journal_entry_line_id uuid REFERENCES public.journal_entry_lines(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','kept')),
  assigned_to uuid,
  resolution text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (statement_line_id IS NOT NULL OR journal_entry_line_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.reconciliation_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.reconciliation_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  exception_id uuid REFERENCES public.reconciliation_exceptions(id) ON DELETE CASCADE,
  statement_line_id uuid REFERENCES public.bank_statement_lines(id) ON DELETE CASCADE,
  journal_entry_line_id uuid REFERENCES public.journal_entry_lines(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(trim(body)) > 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reconciliation_activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.reconciliation_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_statement_lines ADD COLUMN IF NOT EXISTS reconciliation_session_id uuid REFERENCES public.reconciliation_sessions(id) ON DELETE SET NULL;
ALTER TABLE public.bank_statement_lines ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.bank_reconciliation_matches ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.reconciliation_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reconciliation_sessions_org_period ON public.reconciliation_sessions (organization_id, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_reconciliation_collaborators_session ON public.reconciliation_collaborators (session_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_exceptions_session ON public.reconciliation_exceptions (session_id, status);
CREATE INDEX IF NOT EXISTS idx_reconciliation_comments_session ON public.reconciliation_comments (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reconciliation_activity_session ON public.reconciliation_activity (session_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.save_reconciliation_session_state(
  p_session_id uuid, p_expected_version integer, p_cashbook_ready boolean,
  p_statement_verified boolean, p_status text
) RETURNS public.reconciliation_sessions
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_row public.reconciliation_sessions;
BEGIN
  UPDATE public.reconciliation_sessions
  SET cashbook_ready=p_cashbook_ready, statement_verified=p_statement_verified,
      status=p_status, version=version+1, updated_at=now(),
      approved_at=CASE WHEN p_status='approved' THEN now() ELSE approved_at END,
      approved_by=CASE WHEN p_status='approved' THEN auth.uid() ELSE approved_by END
  WHERE id=p_session_id AND version=p_expected_version
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'This reconciliation changed in another user session. Refresh and try again.' USING ERRCODE='40001'; END IF;
  INSERT INTO public.reconciliation_activity(session_id,organization_id,actor_id,action,entity_type,entity_id,new_value)
  VALUES(v_row.id,v_row.organization_id,auth.uid(),'session_state_changed','session',v_row.id::text,to_jsonb(v_row));
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.touch_reconciliation_exception() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.version=OLD.version+1; NEW.updated_at=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_touch_reconciliation_exception ON public.reconciliation_exceptions;
CREATE TRIGGER trg_touch_reconciliation_exception BEFORE UPDATE ON public.reconciliation_exceptions FOR EACH ROW EXECUTE FUNCTION public.touch_reconciliation_exception();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['reconciliation_sessions','reconciliation_collaborators','reconciliation_exceptions','reconciliation_comments','reconciliation_activity'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',t||'_same_org',t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_platform_admin() OR organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id=auth.uid() AND is_active=true)) WITH CHECK (public.is_platform_admin() OR organization_id IN (SELECT organization_id FROM public.organization_members WHERE user_id=auth.uid() AND is_active=true))',t||'_same_org',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated',t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.reconciliation_activity_id_seq TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_reconciliation_session_state(uuid,integer,boolean,boolean,text) TO authenticated;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.reconciliation_sessions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.reconciliation_exceptions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.reconciliation_comments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.reconciliation_activity;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE public.reconciliation_sessions IS 'One individual or collaborative reconciliation workspace per account, source and period.';
COMMENT ON COLUMN public.reconciliation_sessions.version IS 'Optimistic concurrency token; clients must update through save_reconciliation_session_state.';
