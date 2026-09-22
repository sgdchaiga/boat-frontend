-- First live Control Centre pack: hotel room billing and revenue assurance.

INSERT INTO public.control_rules(organization_id,pack_code,rule_code,name,module_key,control_area,configuration,severity,active)
SELECT o.id,'hotel_revenue_assurance','checked_out_balance','Checked-out stay with balance','hotel','revenue',jsonb_build_object('tolerance',0.01),'high',true FROM public.organizations o WHERE o.business_type IN ('hotel','mixed')
ON CONFLICT(organization_id,pack_code,rule_code) DO NOTHING;
INSERT INTO public.control_rules(organization_id,pack_code,rule_code,name,module_key,control_area,configuration,severity,active)
SELECT o.id,'hotel_revenue_assurance','occupied_without_room_charge','Occupied room without charge','hotel','revenue',jsonb_build_object('grace_hours',2),'critical',true FROM public.organizations o WHERE o.business_type IN ('hotel','mixed')
ON CONFLICT(organization_id,pack_code,rule_code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.run_hotel_revenue_assurance_control_pack(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_run public.control_rule_runs; r record; v_exception uuid; v_created integer:=0; v_found integer:=0;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_organization_id AND business_type IN ('hotel','mixed')) THEN RAISE EXCEPTION 'Hotel organization required'; END IF;
  INSERT INTO public.control_rule_runs(organization_id,run_key,run_type,status)
  VALUES(p_organization_id,'hotel-revenue-'||to_char(now(),'YYYYMMDDHH24'),'scheduled','running')
  ON CONFLICT(organization_id,run_key) DO UPDATE SET started_at=now(),status='running',error_message=NULL RETURNING * INTO v_run;
  FOR r IN
    WITH totals AS (
      SELECT s.id,s.organization_id,s.room_id,s.actual_check_in,s.actual_check_out,COALESCE(s.billing_mode,'automatic') billing_mode,
        COALESCE(sum(b.amount) FILTER(WHERE b.charge_type='room'),0) room_billed,COALESCE(sum(b.amount),0) billed,
        COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.stay_id=s.id AND p.organization_id=s.organization_id AND p.payment_status='completed'),0) paid
      FROM public.stays s LEFT JOIN public.billing b ON b.stay_id=s.id AND b.organization_id=s.organization_id
      WHERE s.organization_id=p_organization_id GROUP BY s.id
    )
    SELECT 'checked_out_balance' rule_code,id source_id,'Checked-out guest with outstanding balance' title,
      'The stay is checked out but completed payments are below folio billing.' description,'high' severity,GREATEST(billed-paid,0) amount_at_risk,
      jsonb_build_object('billed',billed,'paid',paid) details
    FROM totals WHERE actual_check_out IS NOT NULL AND billed-paid > .01
    UNION ALL
    SELECT 'occupied_without_room_charge',id,'Occupied room without active room charge',
      'The stay has been open longer than the configured two-hour grace period without a room charge.','critical',0,
      jsonb_build_object('checked_in_at',actual_check_in,'room_billed',room_billed)
    FROM totals WHERE actual_check_out IS NULL AND billing_mode <> 'cash_register' AND actual_check_in < now()-interval '2 hours' AND room_billed <= .01
  LOOP
    v_found:=v_found+1;
    SELECT id INTO v_exception FROM public.control_exceptions WHERE organization_id=p_organization_id AND source_fingerprint='hotel:'||r.rule_code||':'||r.source_id AND status <> 'resolved' LIMIT 1;
    IF v_exception IS NULL THEN
      INSERT INTO public.control_exceptions(organization_id,module_key,control_area,control_rule_code,source_kind,source_fingerprint,title,description,severity,amount_at_risk,created_by)
      VALUES(p_organization_id,'hotel','revenue',r.rule_code,'automated','hotel:'||r.rule_code||':'||r.source_id,r.title,r.description,r.severity,r.amount_at_risk,NULL) RETURNING id INTO v_exception;
      INSERT INTO public.control_exception_sources(exception_id,organization_id,source_module,source_table,source_id,source_reference,source_snapshot) VALUES(v_exception,p_organization_id,'hotel','stays',r.source_id,r.source_id,r.details);
      v_created:=v_created+1;
    END IF;
    INSERT INTO public.control_findings(organization_id,rule_run_id,fingerprint,severity,score,title,details,exception_id)
    VALUES(p_organization_id,v_run.id,r.rule_code||':'||r.source_id,r.severity,CASE WHEN r.severity='critical' THEN 90 WHEN r.severity='high' THEN 70 ELSE 40 END,r.title,r.details,v_exception)
    ON CONFLICT(organization_id,rule_run_id,fingerprint) DO UPDATE SET details=EXCLUDED.details,exception_id=EXCLUDED.exception_id;
  END LOOP;
  UPDATE public.control_rule_runs SET status='completed',completed_at=now(),findings_count=v_found,exceptions_created=v_created WHERE id=v_run.id;
  RETURN jsonb_build_object('run_id',v_run.id,'findings',v_found,'exceptions_created',v_created);
EXCEPTION WHEN OTHERS THEN
  UPDATE public.control_rule_runs SET status='failed',completed_at=now(),error_message=SQLERRM WHERE id=v_run.id; RAISE;
END; $$;

CREATE OR REPLACE FUNCTION public.run_due_hotel_revenue_assurance_controls(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; v_results jsonb:='[]'::jsonb;
BEGIN
  FOR r IN SELECT id FROM public.organizations WHERE business_type IN ('hotel','mixed') AND public.has_organization_feature(id,'control_centre') LIMIT GREATEST(1,p_limit) LOOP
    v_results:=v_results || jsonb_build_array(jsonb_build_object('organization_id',r.id,'result',public.run_hotel_revenue_assurance_control_pack(r.id)));
  END LOOP;
  RETURN v_results;
END; $$;
GRANT EXECUTE ON FUNCTION public.run_hotel_revenue_assurance_control_pack(uuid),public.run_due_hotel_revenue_assurance_controls(integer) TO service_role;
