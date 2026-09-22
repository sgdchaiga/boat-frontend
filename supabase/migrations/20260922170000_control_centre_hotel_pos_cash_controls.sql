-- Phase 5: hotel POS void/refund and cash-reconciliation control signals.

INSERT INTO public.control_rules(organization_id,pack_code,rule_code,name,module_key,control_area,configuration,severity,active)
SELECT o.id,'hotel_pos_cash','approved_pos_void','Approved POS void or refund','hotel_pos','revenue',jsonb_build_object('review_window_days',30),'high',true FROM public.organizations o WHERE o.business_type IN ('hotel','mixed')
ON CONFLICT(organization_id,pack_code,rule_code) DO NOTHING;
INSERT INTO public.control_rules(organization_id,pack_code,rule_code,name,module_key,control_area,configuration,severity,active)
SELECT o.id,'hotel_pos_cash','stale_reconciliation','Stale reconciliation exception','treasury','cash_treasury',jsonb_build_object('age_days',7),'warning',true FROM public.organizations o WHERE o.business_type IN ('hotel','mixed')
ON CONFLICT(organization_id,pack_code,rule_code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.run_hotel_pos_cash_control_pack(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_run public.control_rule_runs; r record; v_exception uuid; v_found integer:=0; v_created integer:=0;
BEGIN
  INSERT INTO public.control_rule_runs(organization_id,run_key,run_type,status) VALUES(p_organization_id,'hotel-pos-cash-'||to_char(now(),'YYYYMMDDHH24'),'scheduled','running') ON CONFLICT(organization_id,run_key) DO UPDATE SET status='running',started_at=now() RETURNING * INTO v_run;
  FOR r IN
    SELECT 'approved_pos_void' rule_code,v.id::text source_id,'Approved POS void or refund' title,'Approved void/refund requires controller review.' description,'high' severity,COALESCE(p.amount,0) amount_at_risk,jsonb_build_object('reason',v.reason,'approved_at',v.approved_at,'payment_id',v.payment_id) details
    FROM public.pos_void_logs v LEFT JOIN public.payments p ON p.id=v.payment_id WHERE v.organization_id=p_organization_id AND v.status='approved' AND v.created_at > now()-interval '30 days'
    UNION ALL
    SELECT 'stale_reconciliation',e.id::text,'Stale reconciliation exception','An unresolved reconciliation exception has been open for more than seven days.','warning',0,jsonb_build_object('session_id',e.session_id,'created_at',e.created_at)
    FROM public.reconciliation_exceptions e WHERE e.organization_id=p_organization_id AND e.status='open' AND e.created_at < now()-interval '7 days'
  LOOP
    v_found:=v_found+1;
    SELECT id INTO v_exception FROM public.control_exceptions WHERE organization_id=p_organization_id AND source_fingerprint='hotel-pos-cash:'||r.rule_code||':'||r.source_id AND status <> 'resolved' LIMIT 1;
    IF v_exception IS NULL THEN
      INSERT INTO public.control_exceptions(organization_id,module_key,control_area,control_rule_code,source_kind,source_fingerprint,title,description,severity,amount_at_risk) VALUES(p_organization_id,CASE WHEN r.rule_code='approved_pos_void' THEN 'hotel_pos' ELSE 'treasury' END,CASE WHEN r.rule_code='approved_pos_void' THEN 'revenue' ELSE 'cash_treasury' END,r.rule_code,'automated','hotel-pos-cash:'||r.rule_code||':'||r.source_id,r.title,r.description,r.severity,r.amount_at_risk) RETURNING id INTO v_exception;
      INSERT INTO public.control_exception_sources(exception_id,organization_id,source_module,source_table,source_id,source_snapshot) VALUES(v_exception,p_organization_id,CASE WHEN r.rule_code='approved_pos_void' THEN 'hotel_pos' ELSE 'treasury' END,CASE WHEN r.rule_code='approved_pos_void' THEN 'pos_void_logs' ELSE 'reconciliation_exceptions' END,r.source_id,r.details); v_created:=v_created+1;
    END IF;
    INSERT INTO public.control_findings(organization_id,rule_run_id,fingerprint,severity,score,title,details,exception_id) VALUES(p_organization_id,v_run.id,r.rule_code||':'||r.source_id,r.severity,CASE WHEN r.severity='high' THEN 70 ELSE 40 END,r.title,r.details,v_exception) ON CONFLICT(organization_id,rule_run_id,fingerprint) DO UPDATE SET details=EXCLUDED.details,exception_id=EXCLUDED.exception_id;
  END LOOP;
  UPDATE public.control_rule_runs SET status='completed',completed_at=now(),findings_count=v_found,exceptions_created=v_created WHERE id=v_run.id;
  RETURN jsonb_build_object('findings',v_found,'exceptions_created',v_created);
END; $$;

CREATE OR REPLACE FUNCTION public.run_due_hotel_pos_cash_controls(p_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; v jsonb:='[]'::jsonb; BEGIN FOR r IN SELECT id FROM public.organizations WHERE business_type IN ('hotel','mixed') AND public.has_organization_feature(id,'control_centre') LIMIT GREATEST(1,p_limit) LOOP v:=v||jsonb_build_array(jsonb_build_object('organization_id',r.id,'result',public.run_hotel_pos_cash_control_pack(r.id))); END LOOP; RETURN v; END; $$;
GRANT EXECUTE ON FUNCTION public.run_hotel_pos_cash_control_pack(uuid),public.run_due_hotel_pos_cash_controls(integer) TO service_role;
