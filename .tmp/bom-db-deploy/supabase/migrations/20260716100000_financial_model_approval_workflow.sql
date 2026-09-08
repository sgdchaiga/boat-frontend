ALTER TABLE public.financial_models DROP CONSTRAINT IF EXISTS financial_models_status_check;
ALTER TABLE public.financial_models ADD CONSTRAINT financial_models_status_check
  CHECK (status IN ('draft', 'submitted', 'approved', 'changes_requested', 'archived'));

CREATE TABLE IF NOT EXISTS public.financial_model_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.financial_models(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  assigned_reviewer uuid NULL,
  decided_by uuid NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'changes_requested', 'cancelled')),
  request_note text NULL,
  decision_note text NULL,
  model_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS financial_model_reviews_model_idx ON public.financial_model_reviews(model_id, requested_at DESC);
ALTER TABLE public.financial_model_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_model_reviews_org_read ON public.financial_model_reviews;
CREATE POLICY financial_model_reviews_org_read ON public.financial_model_reviews FOR SELECT
  USING (public.is_platform_admin() OR public.user_is_member_of_org(organization_id));
GRANT SELECT ON public.financial_model_reviews TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_financial_model_review(p_model_id uuid, p_note text DEFAULT NULL)
RETURNS public.financial_model_reviews LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_model public.financial_models; v_review public.financial_model_reviews;
BEGIN
  SELECT * INTO v_model FROM public.financial_models WHERE id=p_model_id FOR UPDATE;
  IF v_model.id IS NULL THEN RAISE EXCEPTION 'Financial model not found'; END IF;
  IF NOT public.is_platform_admin() AND NOT public.user_is_member_of_org(v_model.organization_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF EXISTS (SELECT 1 FROM public.financial_model_reviews WHERE model_id=p_model_id AND status='pending') THEN RAISE EXCEPTION 'A review is already pending'; END IF;
  INSERT INTO public.financial_model_reviews(organization_id,model_id,requested_by,request_note,model_snapshot)
  VALUES(v_model.organization_id,p_model_id,auth.uid(),nullif(trim(p_note),''),v_model.model_data) RETURNING * INTO v_review;
  UPDATE public.financial_models SET status='submitted',updated_at=now() WHERE id=p_model_id;
  RETURN v_review;
END $$;

CREATE OR REPLACE FUNCTION public.decide_financial_model_review(p_review_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS public.financial_model_reviews LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_review public.financial_model_reviews;
BEGIN
  IF p_decision NOT IN ('approved','changes_requested') THEN RAISE EXCEPTION 'Invalid review decision'; END IF;
  SELECT * INTO v_review FROM public.financial_model_reviews WHERE id=p_review_id FOR UPDATE;
  IF v_review.id IS NULL OR v_review.status <> 'pending' THEN RAISE EXCEPTION 'Pending review not found'; END IF;
  IF NOT public.is_platform_admin() AND NOT public.user_is_member_of_org(v_review.organization_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF v_review.requested_by=auth.uid() THEN RAISE EXCEPTION 'The submitter cannot approve or review their own model'; END IF;
  UPDATE public.financial_model_reviews SET status=p_decision,decision_note=nullif(trim(p_note),''),decided_by=auth.uid(),decided_at=now() WHERE id=p_review_id RETURNING * INTO v_review;
  UPDATE public.financial_models SET status=p_decision,updated_at=now() WHERE id=v_review.model_id;
  RETURN v_review;
END $$;

REVOKE ALL ON FUNCTION public.submit_financial_model_review(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decide_financial_model_review(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_financial_model_review(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_financial_model_review(uuid,text,text) TO authenticated;
