-- Phase 3: transparent operational drivers for school revenue and expenses.
CREATE TABLE IF NOT EXISTS public.budget_driver_assumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  budget_id uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  budget_line_id uuid NOT NULL REFERENCES public.budget_lines(id) ON DELETE CASCADE,
  driver_type text NOT NULL CHECK(driver_type IN('student_fees','feeding','staff_cost','vehicles','quantity_rate')),
  period_key text NOT NULL CHECK(period_key IN('term_1','term_2','term_3','annual_other')),
  quantity numeric(18,4) NOT NULL CHECK(quantity>=0), frequency numeric(18,4) NOT NULL DEFAULT 1 CHECK(frequency>=0),
  rate numeric(18,2) NOT NULL CHECK(rate>=0), collection_rate numeric(7,4) NOT NULL DEFAULT 100 CHECK(collection_rate>=0 AND collection_rate<=100),
  calculated_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK(calculated_amount>=0), notes text,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, updated_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(budget_line_id,driver_type,period_key)
);
ALTER TABLE public.budget_driver_assumptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY budget_driver_assumptions_org ON public.budget_driver_assumptions FOR SELECT TO authenticated
USING(organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT ON public.budget_driver_assumptions TO authenticated;

CREATE OR REPLACE FUNCTION public.save_budget_driver(p_budget_line_id uuid,p_driver_type text,p_period_key text,p_quantity numeric,p_frequency numeric,p_rate numeric,p_collection_rate numeric DEFAULT 100,p_notes text DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l public.budget_lines%ROWTYPE; b public.budgets%ROWTYPE; oid uuid; total numeric;
BEGIN
  IF NOT public.has_budget_permission('budget_prepare') THEN RAISE EXCEPTION 'You do not have permission to prepare budget assumptions'; END IF;
  IF p_driver_type NOT IN('student_fees','feeding','staff_cost','vehicles','quantity_rate') OR p_period_key NOT IN('term_1','term_2','term_3','annual_other') THEN RAISE EXCEPTION 'Invalid driver or period'; END IF;
  IF p_quantity<0 OR p_frequency<0 OR p_rate<0 OR p_collection_rate<0 OR p_collection_rate>100 THEN RAISE EXCEPTION 'Driver values must be valid and non-negative'; END IF;
  SELECT organization_id INTO oid FROM public.staff WHERE id=auth.uid();
  SELECT * INTO l FROM public.budget_lines WHERE id=p_budget_line_id;
  SELECT * INTO b FROM public.budgets WHERE id=l.budget_id AND organization_id=oid AND status IN('draft','submitted','reviewed');
  IF b.id IS NULL THEN RAISE EXCEPTION 'Drivers can be changed only while the budget is being prepared or reviewed'; END IF;
  total:=round(p_quantity*p_frequency*p_rate*(CASE WHEN p_driver_type='student_fees' THEN p_collection_rate/100 ELSE 1 END),2);
  INSERT INTO public.budget_driver_assumptions(organization_id,budget_id,budget_line_id,driver_type,period_key,quantity,frequency,rate,collection_rate,calculated_amount,notes,created_by,updated_by)
  VALUES(oid,b.id,l.id,p_driver_type,p_period_key,p_quantity,p_frequency,p_rate,p_collection_rate,total,p_notes,auth.uid(),auth.uid())
  ON CONFLICT(budget_line_id,driver_type,period_key) DO UPDATE SET quantity=excluded.quantity,frequency=excluded.frequency,rate=excluded.rate,collection_rate=excluded.collection_rate,calculated_amount=excluded.calculated_amount,notes=excluded.notes,updated_by=auth.uid(),updated_at=now();
  IF p_period_key='term_1' THEN UPDATE public.budget_lines SET term_1_amount=total WHERE id=l.id;
  ELSIF p_period_key='term_2' THEN UPDATE public.budget_lines SET term_2_amount=total WHERE id=l.id;
  ELSIF p_period_key='term_3' THEN UPDATE public.budget_lines SET term_3_amount=total WHERE id=l.id;
  ELSE UPDATE public.budget_lines SET annual_other_amount=total WHERE id=l.id; END IF;
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.save_budget_driver(uuid,text,text,numeric,numeric,numeric,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_budget_driver(uuid,text,text,numeric,numeric,numeric,numeric,text) TO authenticated;
