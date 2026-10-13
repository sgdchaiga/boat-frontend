-- Explainable, tenant-scoped scoring for SACCO loans. This is decision support:
-- no score changes a loan's approval status or replaces an officer's decision.

CREATE TABLE IF NOT EXISTS public.sacco_credit_score_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  model_version text NOT NULL DEFAULT 'sacco-rules-v1',
  low_risk_min integer NOT NULL DEFAULT 80 CHECK (low_risk_min BETWEEN 0 AND 100),
  moderate_risk_min integer NOT NULL DEFAULT 60 CHECK (moderate_risk_min BETWEEN 0 AND 100),
  require_guarantor_below integer NOT NULL DEFAULT 60 CHECK (require_guarantor_below BETWEEN 0 AND 100),
  maximum_debt_to_savings numeric NOT NULL DEFAULT 3 CHECK (maximum_debt_to_savings >= 0),
  updated_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (low_risk_min >= moderate_risk_min)
);

CREATE TABLE IF NOT EXISTS public.sacco_credit_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sacco_loan_id uuid NOT NULL REFERENCES public.sacco_loans(id) ON DELETE RESTRICT,
  sacco_member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE RESTRICT,
  model_version text NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  risk_band text NOT NULL CHECK (risk_band IN ('low','moderate','high')),
  recommendation text NOT NULL CHECK (recommendation IN ('recommend_approval','refer_manual_appraisal','ineligible')),
  maximum_eligible_amount numeric NOT NULL CHECK (maximum_eligible_amount >= 0),
  recommended_term_months integer NOT NULL CHECK (recommended_term_months >= 0),
  estimated_installment numeric NOT NULL CHECK (estimated_installment >= 0),
  guarantors_required boolean NOT NULL DEFAULT false,
  mandatory_checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  factor_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_quality jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  calculated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  officer_decision text CHECK (officer_decision IN ('approved','rejected','referred')),
  officer_decided_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  officer_decided_at timestamptz,
  override_reason text,
  UNIQUE (organization_id, sacco_loan_id, model_version)
);
CREATE INDEX IF NOT EXISTS idx_sacco_credit_assessments_org_calculated ON public.sacco_credit_assessments(organization_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sacco_credit_assessments_loan ON public.sacco_credit_assessments(sacco_loan_id);

ALTER TABLE public.sacco_credit_score_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_credit_assessments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sacco_credit_score_settings_org" ON public.sacco_credit_score_settings;
CREATE POLICY "sacco_credit_score_settings_org" ON public.sacco_credit_score_settings FOR ALL TO authenticated
USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()))
WITH CHECK (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
DROP POLICY IF EXISTS "sacco_credit_assessments_staff" ON public.sacco_credit_assessments;
CREATE POLICY "sacco_credit_assessments_staff" ON public.sacco_credit_assessments FOR SELECT TO authenticated
USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
DROP POLICY IF EXISTS "sacco_credit_assessments_member" ON public.sacco_credit_assessments;
CREATE POLICY "sacco_credit_assessments_member" ON public.sacco_credit_assessments FOR SELECT TO authenticated
USING (sacco_member_id=public.current_sacco_member_id());
GRANT SELECT, INSERT, UPDATE ON public.sacco_credit_score_settings TO authenticated;
GRANT SELECT ON public.sacco_credit_assessments TO authenticated;
GRANT ALL ON public.sacco_credit_score_settings, public.sacco_credit_assessments TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_sacco_credit_assessment_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Credit assessments are immutable'; END IF;
  IF OLD.score IS DISTINCT FROM NEW.score OR OLD.risk_band IS DISTINCT FROM NEW.risk_band OR OLD.recommendation IS DISTINCT FROM NEW.recommendation
     OR OLD.factor_scores IS DISTINCT FROM NEW.factor_scores OR OLD.input_snapshot IS DISTINCT FROM NEW.input_snapshot THEN
    RAISE EXCEPTION 'Calculated credit-assessment evidence is immutable';
  END IF;
  IF NEW.officer_decision IS DISTINCT FROM OLD.officer_decision AND (NEW.officer_decided_by IS NULL OR NEW.officer_decided_at IS NULL) THEN
    RAISE EXCEPTION 'Officer decisions must retain actor and time';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sacco_credit_assessment_immutable ON public.sacco_credit_assessments;
CREATE TRIGGER trg_sacco_credit_assessment_immutable BEFORE UPDATE OR DELETE ON public.sacco_credit_assessments
FOR EACH ROW EXECUTE FUNCTION public.prevent_sacco_credit_assessment_change();

CREATE OR REPLACE FUNCTION public.calculate_sacco_credit_assessment(p_loan_id uuid)
RETURNS public.sacco_credit_assessments LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l public.sacco_loans%ROWTYPE; m public.sacco_members%ROWTYPE; p public.sacco_loan_products%ROWTYPE; cfg public.sacco_credit_score_settings%ROWTYPE;
  savings numeric:=0; shares numeric:=0; debt numeric:=0; prior_bad integer:=0; repayment_events integer:=0; activity_events integer:=0;
  membership_days integer:=0; score_repayment integer:=0; score_savings integer:=0; score_capacity integer:=0; score_membership integer:=0; score_debt integer:=0; score_activity integer:=0; total integer:=0;
  eligible boolean:=true; max_amount numeric:=0; band text; rec text; reasons jsonb:='[]'::jsonb; checks jsonb:='[]'::jsonb; quality jsonb:='{}'::jsonb; out_row public.sacco_credit_assessments%ROWTYPE;
BEGIN
  SELECT * INTO l FROM public.sacco_loans WHERE id=p_loan_id; IF NOT FOUND THEN RAISE EXCEPTION 'Loan not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff WHERE id=auth.uid() AND organization_id=l.organization_id)
     AND NOT (l.sacco_member_id=public.current_sacco_member_id() AND l.organization_id=public.current_sacco_member_org_id()) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT * INTO m FROM public.sacco_members WHERE id=l.sacco_member_id AND organization_id=l.organization_id;
  SELECT * INTO p FROM public.sacco_loan_products WHERE organization_id=l.organization_id AND name=l.loan_type;
  SELECT * INTO cfg FROM public.sacco_credit_score_settings WHERE organization_id=l.organization_id;
  IF NOT FOUND THEN INSERT INTO public.sacco_credit_score_settings(organization_id) VALUES(l.organization_id) RETURNING * INTO cfg; END IF;
  SELECT coalesce(sum(CASE WHEN upper(coalesce(savings_product_code,'')) LIKE '%SHARE%' OR upper(coalesce(savings_product_code,'')) LIKE 'SHR%' THEN 0 ELSE balance END),0),
         coalesce(sum(CASE WHEN upper(coalesce(savings_product_code,'')) LIKE '%SHARE%' OR upper(coalesce(savings_product_code,'')) LIKE 'SHR%' THEN balance ELSE 0 END),0)
  INTO savings,shares FROM public.sacco_member_savings_accounts WHERE organization_id=l.organization_id AND sacco_member_id=l.sacco_member_id;
  IF savings=0 THEN savings:=coalesce(m.savings_balance,0); END IF; IF shares=0 THEN shares:=coalesce(m.shares_balance,0); END IF;
  SELECT coalesce(sum(balance),0),count(*) FILTER (WHERE status IN ('defaulted','written_off')) INTO debt,prior_bad FROM public.sacco_loans WHERE organization_id=l.organization_id AND sacco_member_id=l.sacco_member_id AND id<>l.id AND status IN ('pending','approved','disbursed','defaulted','written_off');
  SELECT count(*) INTO repayment_events FROM public.sacco_cashbook_entries WHERE organization_id=l.organization_id AND sacco_member_id=l.sacco_member_id AND (lower(coalesce(category,'')) LIKE '%loan%' OR lower(coalesce(description,'')) ~ 'repay|loan payment');
  SELECT count(*) INTO activity_events FROM public.sacco_cashbook_entries WHERE organization_id=l.organization_id AND sacco_member_id=l.sacco_member_id AND entry_date >= current_date-90;
  membership_days:=greatest(0,current_date-coalesce(m.join_date,(m.created_at at time zone 'UTC')::date,current_date));
  checks:=checks || jsonb_build_array(jsonb_build_object('name','Active membership','passed',m.is_active),jsonb_build_object('name','Loan product available','passed',p.id IS NOT NULL),jsonb_build_object('name','No prior default or write-off','passed',prior_bad=0));
  IF NOT m.is_active OR p.id IS NULL OR prior_bad>0 THEN eligible:=false; reasons:=reasons||jsonb_build_array('Mandatory eligibility check failed.'); END IF;
  IF p.id IS NOT NULL AND (l.amount<p.min_amount OR l.amount>p.max_amount OR savings<l.amount*p.compulsory_savings_rate/100 OR shares<p.minimum_shares) THEN eligible:=false; reasons:=reasons||jsonb_build_array('Product amount, savings, or share requirement is not met.'); END IF;
  IF savings>0 AND debt > savings*cfg.maximum_debt_to_savings THEN eligible:=false; reasons:=reasons||jsonb_build_array('Existing debt exceeds the SACCO debt-to-savings limit.'); END IF;
  score_repayment:=CASE WHEN prior_bad>0 THEN 0 WHEN repayment_events>=6 THEN 30 WHEN repayment_events>0 THEN 20 ELSE 10 END;
  score_savings:=CASE WHEN savings>=l.amount*0.5 THEN 20 WHEN savings>=l.amount*0.25 THEN 14 WHEN savings>0 THEN 8 ELSE 0 END;
  score_capacity:=CASE WHEN debt=0 THEN 20 WHEN savings>0 AND debt<=savings THEN 14 WHEN savings>0 THEN 8 ELSE 0 END;
  score_membership:=CASE WHEN membership_days>=730 THEN 10 WHEN membership_days>=365 THEN 8 WHEN membership_days>=180 THEN 5 ELSE 2 END;
  score_debt:=CASE WHEN debt=0 THEN 10 WHEN savings>0 AND debt<=savings THEN 7 WHEN savings>0 THEN 3 ELSE 0 END;
  score_activity:=CASE WHEN activity_events>=12 THEN 10 WHEN activity_events>=4 THEN 7 WHEN activity_events>0 THEN 4 ELSE 0 END;
  total:=score_repayment+score_savings+score_capacity+score_membership+score_debt+score_activity;
  band:=CASE WHEN total>=cfg.low_risk_min THEN 'low' WHEN total>=cfg.moderate_risk_min THEN 'moderate' ELSE 'high' END;
  max_amount:=greatest(0,least(coalesce(p.max_amount,l.amount),savings*cfg.maximum_debt_to_savings-debt));
  rec:=CASE WHEN NOT eligible THEN 'ineligible' WHEN total>=cfg.moderate_risk_min THEN 'recommend_approval' ELSE 'refer_manual_appraisal' END;
  IF repayment_events=0 THEN quality:=quality||jsonb_build_object('repayment_history','insufficient: no linked historical repayment entries'); reasons:=reasons||jsonb_build_array('Repayment-history evidence is limited; manual appraisal is required.'); END IF;
  quality:=quality||jsonb_build_object('income_capacity','proxy only: BOAT has no verified income source in this SACCO workspace');
  INSERT INTO public.sacco_credit_assessments(organization_id,sacco_loan_id,sacco_member_id,model_version,score,risk_band,recommendation,maximum_eligible_amount,recommended_term_months,estimated_installment,guarantors_required,mandatory_checks,factor_scores,reasons,input_snapshot,data_quality,calculated_by)
  VALUES(l.organization_id,l.id,l.sacco_member_id,cfg.model_version,total,band,rec,max_amount,coalesce(p.max_term_months,l.term_months),l.monthly_payment,total<cfg.require_guarantor_below,checks,
    jsonb_build_object('repayment_performance',score_repayment,'savings_consistency',score_savings,'repayment_capacity',score_capacity,'membership_duration',score_membership,'existing_debt',score_debt,'account_activity',score_activity),reasons,
    jsonb_build_object('requested_amount',l.amount,'savings_balance',savings,'shares_balance',shares,'existing_debt',debt,'membership_days',membership_days,'repayment_events',repayment_events,'activity_events_90d',activity_events),quality,auth.uid())
  ON CONFLICT(organization_id,sacco_loan_id,model_version) DO NOTHING RETURNING * INTO out_row;
  IF out_row.id IS NULL THEN SELECT * INTO out_row FROM public.sacco_credit_assessments WHERE organization_id=l.organization_id AND sacco_loan_id=l.id AND model_version=cfg.model_version; END IF;
  RETURN out_row;
END $$;
REVOKE ALL ON FUNCTION public.calculate_sacco_credit_assessment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_sacco_credit_assessment(uuid) TO authenticated;
COMMENT ON TABLE public.sacco_credit_assessments IS 'Immutable explainable SACCO credit assessments. Recommendations require officer review.';
