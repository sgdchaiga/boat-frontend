-- Controlled BOAT Assistant automation rules and idempotent scheduled runs.
CREATE TABLE IF NOT EXISTS public.boat_assistant_automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 3 AND 120),
  action_type text NOT NULL CHECK (action_type IN ('create_action_item','prepare_transaction_draft')),
  instruction text NOT NULL CHECK (char_length(trim(instruction)) BETWEEN 3 AND 1000),
  target_page text,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  max_amount numeric(18,2) CHECK (max_amount IS NULL OR max_amount >= 0),
  requires_approval boolean NOT NULL DEFAULT true,
  assigned_role text NOT NULL DEFAULT 'admin' CHECK (assigned_role IN ('admin','manager','accountant')),
  schedule_kind text NOT NULL CHECK (schedule_kind IN ('daily','weekly','monthly')),
  run_time time NOT NULL DEFAULT '08:00',
  timezone text NOT NULL DEFAULT 'Africa/Kampala',
  weekday smallint CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
  day_of_month smallint CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 28),
  next_run_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((schedule_kind <> 'weekly') OR weekday IS NOT NULL),
  CHECK ((schedule_kind <> 'monthly') OR day_of_month IS NOT NULL),
  CHECK (action_type <> 'prepare_transaction_draft' OR requires_approval = true)
);

CREATE TABLE IF NOT EXISTS public.boat_assistant_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.boat_assistant_automation_rules(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','approval_required','failed','skipped')),
  suggestion_id uuid REFERENCES public.boat_assistant_suggestions(id) ON DELETE SET NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_boat_assistant_rules_due ON public.boat_assistant_automation_rules(active, next_run_at);
CREATE INDEX IF NOT EXISTS idx_boat_assistant_runs_org ON public.boat_assistant_automation_runs(organization_id, created_at DESC);

ALTER TABLE public.boat_assistant_automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boat_assistant_automation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "boat_assistant_rules_read" ON public.boat_assistant_automation_rules FOR SELECT TO authenticated
USING (public.is_platform_admin() OR EXISTS (SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.organization_id = boat_assistant_automation_rules.organization_id));
CREATE POLICY "boat_assistant_rules_manage" ON public.boat_assistant_automation_rules FOR ALL TO authenticated
USING (public.is_platform_admin() OR EXISTS (SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.organization_id = boat_assistant_automation_rules.organization_id AND s.role IN ('admin','manager')))
WITH CHECK (public.is_platform_admin() OR EXISTS (SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.organization_id = boat_assistant_automation_rules.organization_id AND s.role IN ('admin','manager')));
CREATE POLICY "boat_assistant_runs_read" ON public.boat_assistant_automation_runs FOR SELECT TO authenticated
USING (public.is_platform_admin() OR EXISTS (SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.organization_id = boat_assistant_automation_runs.organization_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.boat_assistant_automation_rules TO authenticated;
GRANT SELECT ON public.boat_assistant_automation_runs TO authenticated;

CREATE OR REPLACE FUNCTION public.next_boat_assistant_run(
  p_schedule_kind text, p_run_time time, p_timezone text, p_weekday smallint, p_day_of_month smallint, p_after timestamptz DEFAULT now()
) RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
DECLARE local_after timestamp; candidate date; wanted int;
BEGIN
  local_after := p_after AT TIME ZONE p_timezone;
  candidate := local_after::date;
  IF p_schedule_kind = 'daily' THEN
    IF candidate + p_run_time <= local_after THEN candidate := candidate + 1; END IF;
  ELSIF p_schedule_kind = 'weekly' THEN
    wanted := COALESCE(p_weekday, 1);
    candidate := candidate + ((wanted - extract(dow FROM candidate)::int + 7) % 7);
    IF candidate + p_run_time <= local_after THEN candidate := candidate + 7; END IF;
  ELSIF p_schedule_kind = 'monthly' THEN
    candidate := date_trunc('month', local_after)::date + (LEAST(COALESCE(p_day_of_month, 1), 28) - 1);
    IF candidate + p_run_time <= local_after THEN candidate := (date_trunc('month', local_after) + interval '1 month')::date + (LEAST(COALESCE(p_day_of_month, 1), 28) - 1); END IF;
  ELSE RAISE EXCEPTION 'Unsupported schedule kind';
  END IF;
  RETURN (candidate + p_run_time) AT TIME ZONE p_timezone;
END $$;

CREATE OR REPLACE FUNCTION public.run_due_boat_assistant_automations(p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; run_id uuid; suggestion_id uuid; processed int := 0; failed int := 0; run_status text;
BEGIN
  FOR r IN
    SELECT ar.* FROM public.boat_assistant_automation_rules ar
    JOIN public.organizations o ON o.id = ar.organization_id AND o.enable_assistant = true
    JOIN public.boat_assistant_policies p ON p.organization_id = ar.organization_id AND p.automatic_enabled = true
    WHERE ar.active = true AND ar.next_run_at <= now()
    ORDER BY ar.next_run_at FOR UPDATE OF ar SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),200)
  LOOP
    BEGIN
      INSERT INTO public.boat_assistant_automation_runs(organization_id,rule_id,scheduled_for,status,started_at)
      VALUES(r.organization_id,r.id,r.next_run_at,'running',now())
      ON CONFLICT(rule_id,scheduled_for) DO NOTHING RETURNING id INTO run_id;
      UPDATE public.boat_assistant_automation_rules SET next_run_at = public.next_boat_assistant_run(schedule_kind,run_time,timezone,weekday,day_of_month,now()), updated_at = now() WHERE id = r.id;
      IF run_id IS NULL THEN CONTINUE; END IF;

      run_status := CASE WHEN r.requires_approval THEN 'approval_required' ELSE 'completed' END;
      INSERT INTO public.boat_assistant_suggestions(organization_id,created_by,original_instruction,understood,recommended_treatment,draft,target_page,amount,currency,confidence,risk,status,approval_required,assigned_role)
      VALUES(r.organization_id,r.created_by,r.instruction,
        CASE WHEN r.action_type='create_action_item' THEN 'Scheduled action item: '||r.name ELSE 'Scheduled transaction draft: '||r.name END,
        CASE WHEN r.requires_approval THEN 'Review and approve before applying.' ELSE 'Complete this authorised recurring action.' END,
        r.draft,r.target_page,NULLIF(r.draft->>'amount','')::numeric,r.draft->>'currency','high',
        CASE WHEN r.action_type='prepare_transaction_draft' THEN 'medium' ELSE 'low' END,
        CASE WHEN r.requires_approval THEN 'approval_required' ELSE 'deferred' END,r.requires_approval,r.assigned_role)
      RETURNING id INTO suggestion_id;

      UPDATE public.boat_assistant_automation_runs SET status=run_status,suggestion_id=suggestion_id,result=jsonb_build_object('action_type',r.action_type,'suggestion_id',suggestion_id),completed_at=now() WHERE id=run_id;
      processed := processed + 1;
    EXCEPTION WHEN OTHERS THEN
      failed := failed + 1;
      IF run_id IS NOT NULL THEN UPDATE public.boat_assistant_automation_runs SET status='failed',error=left(SQLERRM,1000),completed_at=now() WHERE id=run_id; END IF;
    END;
    run_id := NULL; suggestion_id := NULL;
  END LOOP;
  RETURN jsonb_build_object('processed',processed,'failed',failed,'at',now());
END $$;
REVOKE ALL ON FUNCTION public.run_due_boat_assistant_automations(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_due_boat_assistant_automations(int) TO service_role;

DO $cron$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.schedule('boat-assistant-automation-worker','*/5 * * * *','SELECT public.run_due_boat_assistant_automations(100)');
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'BOAT Assistant cron schedule skipped: %', SQLERRM; END $cron$;
