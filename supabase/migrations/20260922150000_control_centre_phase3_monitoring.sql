-- BOAT Control Centre, phase 3: monitoring runs, risk intelligence, trends and branch benchmarking.

CREATE TABLE public.control_rule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.control_rules(id) ON DELETE SET NULL, run_key text NOT NULL, run_type text NOT NULL DEFAULT 'scheduled' CHECK(run_type IN ('scheduled','manual','backfill')),
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed')), started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  findings_count integer NOT NULL DEFAULT 0, exceptions_created integer NOT NULL DEFAULT 0, error_message text, UNIQUE(organization_id, run_key)
);
CREATE TABLE public.control_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_run_id uuid NOT NULL REFERENCES public.control_rule_runs(id) ON DELETE CASCADE, rule_id uuid REFERENCES public.control_rules(id) ON DELETE SET NULL,
  fingerprint text NOT NULL, severity text NOT NULL CHECK(severity IN ('critical','high','warning','low')), score numeric(8,2) NOT NULL DEFAULT 0,
  title text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb, exception_id uuid REFERENCES public.control_exceptions(id) ON DELETE SET NULL, detected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, rule_run_id, fingerprint)
);
CREATE TABLE public.control_risk_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', branch_type text NOT NULL DEFAULT 'organization', snapshot_date date NOT NULL, risk_score numeric(8,2) NOT NULL, open_exceptions integer NOT NULL, critical_exceptions integer NOT NULL,
  overdue_exceptions integer NOT NULL, value_at_risk numeric(14,2) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, branch_id, branch_type, snapshot_date)
);
CREATE TABLE public.control_benchmark_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', branch_type text NOT NULL DEFAULT 'organization', snapshot_date date NOT NULL, metric_key text NOT NULL, metric_value numeric(14,2) NOT NULL,
  organization_average numeric(14,2), deviation_from_average numeric(14,2), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, branch_id, branch_type, snapshot_date, metric_key)
);
CREATE INDEX control_rule_runs_org_started_idx ON public.control_rule_runs(organization_id, started_at DESC);
CREATE INDEX control_findings_org_detected_idx ON public.control_findings(organization_id, detected_at DESC);
CREATE INDEX control_risk_snapshots_org_date_idx ON public.control_risk_snapshots(organization_id, snapshot_date DESC);

CREATE OR REPLACE FUNCTION public.refresh_control_centre_metrics(p_organization_id uuid, p_snapshot_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_open integer; v_critical integer; v_overdue integer; v_value numeric; v_score numeric; v_branch_count integer; r record;
BEGIN
  SELECT count(*) FILTER(WHERE status <> 'resolved'), count(*) FILTER(WHERE status <> 'resolved' AND severity='critical'), count(*) FILTER(WHERE status <> 'resolved' AND due_date < now()), coalesce(sum(amount_at_risk) FILTER(WHERE status <> 'resolved'),0)
  INTO v_open,v_critical,v_overdue,v_value FROM public.control_exceptions WHERE organization_id=p_organization_id;
  SELECT GREATEST(count(DISTINCT (COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid)::text || ':' || COALESCE(branch_type,'organization'))),1) INTO v_branch_count FROM public.control_exceptions WHERE organization_id=p_organization_id;
  v_score := LEAST(100, v_critical*25 + GREATEST(v_open-v_critical,0)*6 + v_overdue*8 + CASE WHEN v_value > 0 THEN LEAST(20, ln(v_value+1)*2) ELSE 0 END);
  INSERT INTO public.control_risk_snapshots(organization_id,snapshot_date,risk_score,open_exceptions,critical_exceptions,overdue_exceptions,value_at_risk)
  VALUES(p_organization_id,p_snapshot_date,v_score,v_open,v_critical,v_overdue,v_value)
  ON CONFLICT(organization_id,branch_id,branch_type,snapshot_date) DO UPDATE SET risk_score=EXCLUDED.risk_score,open_exceptions=EXCLUDED.open_exceptions,critical_exceptions=EXCLUDED.critical_exceptions,overdue_exceptions=EXCLUDED.overdue_exceptions,value_at_risk=EXCLUDED.value_at_risk;
  FOR r IN SELECT COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid) branch_id,COALESCE(branch_type,'organization') branch_type,count(*) FILTER(WHERE status <> 'resolved') open_count,coalesce(sum(amount_at_risk) FILTER(WHERE status <> 'resolved'),0) risk_value FROM public.control_exceptions WHERE organization_id=p_organization_id GROUP BY 1,2 LOOP
    INSERT INTO public.control_benchmark_snapshots(organization_id,branch_id,branch_type,snapshot_date,metric_key,metric_value,organization_average,deviation_from_average)
    VALUES(p_organization_id,r.branch_id,r.branch_type,p_snapshot_date,'open_exceptions',r.open_count,v_open/v_branch_count::numeric, r.open_count-(v_open/v_branch_count::numeric))
    ON CONFLICT(organization_id,branch_id,branch_type,snapshot_date,metric_key) DO UPDATE SET metric_value=EXCLUDED.metric_value,organization_average=EXCLUDED.organization_average,deviation_from_average=EXCLUDED.deviation_from_average;
    INSERT INTO public.control_benchmark_snapshots(organization_id,branch_id,branch_type,snapshot_date,metric_key,metric_value,organization_average,deviation_from_average)
    VALUES(p_organization_id,r.branch_id,r.branch_type,p_snapshot_date,'value_at_risk',r.risk_value,v_value/v_branch_count::numeric, r.risk_value-(v_value/v_branch_count::numeric))
    ON CONFLICT(organization_id,branch_id,branch_type,snapshot_date,metric_key) DO UPDATE SET metric_value=EXCLUDED.metric_value,organization_average=EXCLUDED.organization_average,deviation_from_average=EXCLUDED.deviation_from_average;
  END LOOP;
  RETURN jsonb_build_object('risk_score',v_score,'open_exceptions',v_open,'critical_exceptions',v_critical,'overdue_exceptions',v_overdue,'value_at_risk',v_value);
END; $$;

CREATE OR REPLACE FUNCTION public.run_control_centre_monitoring(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; v_metrics jsonb; v_count integer := 0; v_escalations integer := 0;
BEGIN
  FOR r IN SELECT DISTINCT o.id FROM public.organizations o WHERE public.has_organization_feature(o.id,'control_centre') LIMIT GREATEST(1,p_limit) LOOP
    v_metrics := public.refresh_control_centre_metrics(r.id,CURRENT_DATE); v_count := v_count+1;
    INSERT INTO public.control_notifications(organization_id,exception_id,recipient_id,notification_type,payload)
    SELECT e.organization_id,e.id,e.assigned_to,'exception_overdue',jsonb_build_object('reference',e.exception_reference,'title',e.title)
    FROM public.control_exceptions e WHERE e.organization_id=r.id AND e.status <> 'resolved' AND e.due_date < now() AND e.assigned_to IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.control_notifications n WHERE n.exception_id=e.id AND n.notification_type='exception_overdue' AND n.status IN ('queued','sent') AND n.created_at > now()-interval '24 hours');
    GET DIAGNOSTICS v_escalations = ROW_COUNT;
  END LOOP;
  RETURN jsonb_build_object('organizations_processed',v_count,'overdue_notifications_queued',v_escalations);
END; $$;

ALTER TABLE public.control_rule_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE public.control_findings ENABLE ROW LEVEL SECURITY; ALTER TABLE public.control_risk_snapshots ENABLE ROW LEVEL SECURITY; ALTER TABLE public.control_benchmark_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY control_rule_runs_read ON public.control_rule_runs FOR SELECT TO authenticated USING(public.control_centre_can(organization_id,'view'));
CREATE POLICY control_findings_read ON public.control_findings FOR SELECT TO authenticated USING(public.control_centre_can(organization_id,'view'));
CREATE POLICY control_risk_snapshots_read ON public.control_risk_snapshots FOR SELECT TO authenticated USING(public.control_centre_can(organization_id,'view'));
CREATE POLICY control_benchmarks_read ON public.control_benchmark_snapshots FOR SELECT TO authenticated USING(public.control_centre_can(organization_id,'view'));
REVOKE INSERT,UPDATE,DELETE ON public.control_rule_runs,public.control_findings,public.control_risk_snapshots,public.control_benchmark_snapshots FROM anon,authenticated;
GRANT SELECT ON public.control_rule_runs,public.control_findings,public.control_risk_snapshots,public.control_benchmark_snapshots TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_control_centre_metrics(uuid,date) TO authenticated;

DO $cron$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.schedule('control-centre-monitoring','*/15 * * * *','SELECT public.run_control_centre_monitoring(100)');
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Control Centre cron schedule skipped: %', SQLERRM; END $cron$;
