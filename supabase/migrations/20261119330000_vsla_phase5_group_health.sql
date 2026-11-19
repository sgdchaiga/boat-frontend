-- Phase 5: transparent, cycle-scoped group-health indicators.
CREATE INDEX IF NOT EXISTS idx_vsla_v12_events_cycle_type_status ON public.vsla_financial_events(cycle_id,event_type,status);
CREATE INDEX IF NOT EXISTS idx_vsla_v12_loans_cycle_status ON public.vsla_v12_loans(cycle_id,status);
CREATE INDEX IF NOT EXISTS idx_vsla_v12_reconciliations_meeting_status ON public.vsla_v12_cash_reconciliations(meeting_id,status);

CREATE OR REPLACE FUNCTION public.vsla_v12_group_health(p_cycle_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.vsla_cycles%ROWTYPE; v_savings numeric:=0; v_previous_savings numeric:=0; v_meetings integer:=0; v_members integer:=0; v_attendance integer:=0; v_present integer:=0; v_reconciled integer:=0; v_participants integer:=0; v_loan_due numeric:=0; v_loan_paid numeric:=0; v_outstanding numeric:=0; v_par numeric:=0; v_fund numeric:=0; v_shareout_id uuid; v_shareout_due integer:=0; v_shareout_settled integer:=0; v_shareout_value numeric:=0; v_shareout_paid numeric:=0;
BEGIN
  SELECT * INTO c FROM public.vsla_cycles WHERE id=p_cycle_id;
  IF NOT FOUND OR c.organization_id<>public.auth_staff_org_id() THEN RAISE EXCEPTION 'VSLA cycle was not found'; END IF;
  SELECT coalesce(sum(amount),0) INTO v_savings FROM public.vsla_financial_events WHERE cycle_id=c.id AND event_type='savings_received' AND status='posted';
  SELECT coalesce(sum(e.amount),0) INTO v_previous_savings FROM public.vsla_financial_events e JOIN public.vsla_cycles pc ON pc.id=e.cycle_id WHERE pc.organization_id=c.organization_id AND pc.id<>c.id AND pc.starts_on<c.starts_on AND e.event_type='savings_received' AND e.status='posted';
  SELECT count(*) INTO v_meetings FROM public.vsla_meetings WHERE cycle_id=c.id;
  SELECT count(*) INTO v_members FROM public.vsla_members WHERE organization_id=c.organization_id AND status='active';
  SELECT count(*),count(*) FILTER(WHERE a.present) INTO v_attendance,v_present FROM public.vsla_meeting_attendance a JOIN public.vsla_meetings m ON m.id=a.meeting_id WHERE m.cycle_id=c.id;
  SELECT count(*) INTO v_reconciled FROM public.vsla_v12_cash_reconciliations r JOIN public.vsla_meetings m ON m.id=r.meeting_id WHERE m.cycle_id=c.id AND r.status='reconciled';
  SELECT count(DISTINCT member_id) INTO v_participants FROM public.vsla_financial_events WHERE cycle_id=c.id AND event_type='savings_received' AND status='posted' AND member_id IS NOT NULL;
  SELECT coalesce(sum(total_due),0),coalesce(sum(total_due-outstanding_balance),0),coalesce(sum(outstanding_balance) FILTER(WHERE status='disbursed'),0),coalesce(sum(outstanding_balance) FILTER(WHERE status='disbursed' AND outstanding_balance>0 AND disbursed_at<now()-(duration_meetings*interval '7 days')),0) INTO v_loan_due,v_loan_paid,v_outstanding,v_par FROM public.vsla_v12_loans WHERE cycle_id=c.id AND status IN ('disbursed','closed');
  SELECT coalesce(sum(amount) FILTER(WHERE event_type IN ('savings_received','loan_repayment','fine_received')),0)-coalesce(sum(amount) FILTER(WHERE event_type IN ('loan_disbursed','expense_paid','shareout_payment')),0) INTO v_fund FROM public.vsla_financial_events WHERE cycle_id=c.id AND status='posted';
  SELECT id INTO v_shareout_id FROM public.vsla_v12_shareouts WHERE cycle_id=c.id AND status='approved';
  IF v_shareout_id IS NOT NULL THEN
    SELECT count(*),coalesce(sum((entry->>'payout_amount')::numeric),0) INTO v_shareout_due,v_shareout_value FROM public.vsla_v12_shareouts s CROSS JOIN LATERAL jsonb_array_elements(s.payout_schedule) entry WHERE s.id=v_shareout_id;
    SELECT count(*),coalesce(sum(amount),0) INTO v_shareout_settled,v_shareout_paid FROM public.boat_pay_payment_intents WHERE shareout_id=v_shareout_id AND purpose='shareout_payout' AND status='settled';
  END IF;
  RETURN jsonb_build_object(
    'cycle_id',c.id,'cycle_name',c.name,
    'metrics',jsonb_build_object(
      'savings_growth',jsonb_build_object('value',CASE WHEN v_previous_savings>0 THEN round((v_savings-v_previous_savings)*100/v_previous_savings,2) ELSE NULL END,'current_savings',v_savings,'previous_savings',v_previous_savings,'formula','(current-cycle savings − previous-cycle savings) ÷ previous-cycle savings × 100'),
      'savings_consistency',jsonb_build_object('value',CASE WHEN v_members*v_meetings>0 THEN round(v_participants::numeric*100/v_members,2) ELSE NULL END,'participating_members',v_participants,'active_members',v_members,'formula','members with at least one savings receipt ÷ active members × 100'),
      'meeting_attendance',jsonb_build_object('value',CASE WHEN v_attendance>0 THEN round(v_present::numeric*100/v_attendance,2) ELSE NULL END,'present_records',v_present,'attendance_records',v_attendance,'formula','present attendance records ÷ all recorded attendance × 100'),
      'loan_repayment_performance',jsonb_build_object('value',CASE WHEN v_loan_due>0 THEN round(v_loan_paid*100/v_loan_due,2) ELSE NULL END,'repaid',v_loan_paid,'total_due',v_loan_due,'formula','total due less outstanding balance ÷ total due × 100'),
      'portfolio_at_risk',jsonb_build_object('value',CASE WHEN v_outstanding>0 THEN round(v_par*100/v_outstanding,2) ELSE NULL END,'at_risk_balance',v_par,'outstanding_balance',v_outstanding,'formula','outstanding balance of loans past their term proxy (term × 7 days) ÷ outstanding balance × 100'),
      'cash_reconciliation_compliance',jsonb_build_object('value',CASE WHEN v_meetings>0 THEN round(v_reconciled::numeric*100/v_meetings,2) ELSE NULL END,'reconciled_meetings',v_reconciled,'meetings',v_meetings,'formula','meetings with reconciled cash count ÷ cycle meetings × 100'),
      'loan_fund_utilization',jsonb_build_object('value',CASE WHEN v_fund>0 THEN round(v_outstanding*100/v_fund,2) ELSE NULL END,'outstanding_loans',v_outstanding,'available_fund',v_fund,'formula','outstanding loan balance ÷ calculated posted fund × 100'),
      'member_participation',jsonb_build_object('value',CASE WHEN v_members>0 THEN round(v_participants::numeric*100/v_members,2) ELSE NULL END,'participants',v_participants,'active_members',v_members,'formula','members with a posted savings receipt ÷ active members × 100'),
      'cycle_profitability',jsonb_build_object('value',NULL,'formula','Not calculated: current v1.2 repayment events do not yet separate realized interest from principal.'),
      'shareout_performance',jsonb_build_object('value',CASE WHEN v_shareout_due>0 THEN round(v_shareout_settled::numeric*100/v_shareout_due,2) ELSE NULL END,'settled_payouts',v_shareout_settled,'scheduled_payouts',v_shareout_due,'settled_amount',v_shareout_paid,'scheduled_amount',v_shareout_value,'formula','settled digital share-out payouts ÷ approved payout obligations × 100')
    )
  );
END $$;
REVOKE ALL ON FUNCTION public.vsla_v12_group_health(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_group_health(uuid) TO authenticated;
