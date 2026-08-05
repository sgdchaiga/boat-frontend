-- Protected Professional Practice demonstration account and completion certificates.
ALTER TABLE public.practice_clients ADD COLUMN IF NOT EXISTS is_training boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS practice_one_training_client_per_org ON public.practice_clients(organization_id) WHERE is_training;

CREATE TABLE IF NOT EXISTS public.training_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  certificate_number text NOT NULL UNIQUE,
  completed_tasks integer NOT NULL,
  total_points integer NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,user_id,module_key)
);
ALTER TABLE public.training_certificates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS training_certificates_own ON public.training_certificates;
CREATE POLICY training_certificates_own ON public.training_certificates FOR SELECT TO authenticated
USING (user_id=auth.uid() OR public.is_platform_admin());
GRANT SELECT ON public.training_certificates TO authenticated;

CREATE OR REPLACE FUNCTION public.reset_practice_training_account(p_organization_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_client_id uuid; v_engagement_id uuid;
BEGIN
  IF NOT public.is_platform_admin() AND NOT EXISTS (
    SELECT 1 FROM public.staff s WHERE s.id=auth.uid() AND s.organization_id=p_organization_id
      AND s.role IN ('admin','manager','super_admin','owner')
  ) THEN RAISE EXCEPTION 'Only an administrator or manager can reset training data'; END IF;

  PERFORM set_config('boat.training_reset','on',true);
  DELETE FROM public.practice_clients WHERE organization_id=p_organization_id AND is_training;
  INSERT INTO public.practice_clients(organization_id,name,contact_name,email,phone,tax_id,status,is_training)
  VALUES(p_organization_id,'Kampala Traders Ltd - Training Account','Sarah Nakato','training@kampalatraders.example','+256 700 000 045','TRAINING-TIN-0045','active',true)
  RETURNING id INTO v_client_id;
  INSERT INTO public.practice_engagements(organization_id,client_id,title,service_type,period_start,period_end,status)
  VALUES(p_organization_id,v_client_id,'2026 Accounts and Tax - Training','Accounting and tax','2026-01-01','2026-12-31','in_progress') RETURNING id INTO v_engagement_id;
  INSERT INTO public.practice_tasks(organization_id,client_id,title,due_date,priority,status) VALUES
    (p_organization_id,v_client_id,'Identify the unmatched UGX 850,000 deposit',current_date+2,'high','open'),
    (p_organization_id,v_client_id,'Correct the deliberate utilities posting error',current_date+4,'normal','open'),
    (p_organization_id,v_client_id,'Prepare the bank reconciliation working paper',current_date+6,'normal','open');
  INSERT INTO public.practice_invoices(organization_id,client_id,description,invoice_date,due_date,amount,status) VALUES
    (p_organization_id,v_client_id,'INV-0045 - Accounting services',current_date-20,current_date+10,850000,'sent'),
    (p_organization_id,v_client_id,'INV-0046 - Tax compliance services',current_date-10,current_date+20,450000,'draft');
  INSERT INTO public.practice_reconciliation_lines(organization_id,client_id,side,line_date,description,reference,amount,source_file,imported_by) VALUES
    (p_organization_id,v_client_id,'statement',current_date-5,'Customer deposit awaiting match','BANK-DEP-850K',850000,'training-bank-statement.csv',auth.uid()),
    (p_organization_id,v_client_id,'cashbook',current_date-8,'Invoice INV-0045','INV-0045',850000,'training-cashbook.csv',auth.uid()),
    (p_organization_id,v_client_id,'statement',current_date-3,'Bank charge - deliberate unmatched item','BANK-CHARGE-01',-25000,'training-bank-statement.csv',auth.uid());
  RETURN v_client_id;
END $$;

CREATE OR REPLACE FUNCTION public.protect_practice_training_client()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF OLD.is_training AND current_setting('boat.training_reset',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Protected training account: use the Learning Centre reset action';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS protect_practice_training_client ON public.practice_clients;
CREATE TRIGGER protect_practice_training_client BEFORE UPDATE OR DELETE ON public.practice_clients
FOR EACH ROW EXECUTE FUNCTION public.protect_practice_training_client();

CREATE OR REPLACE FUNCTION public.issue_training_certificate(p_organization_id uuid,p_module_key text DEFAULT 'practice')
RETURNS public.training_certificates LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_total integer; v_completed integer; v_points integer; v_row public.training_certificates;
BEGIN
  IF NOT public.user_is_member_of_org(p_organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT count(*),coalesce(sum(points),0) INTO v_total,v_points FROM public.training_tasks
    WHERE is_active AND module_key=p_module_key AND (organization_id IS NULL OR organization_id=p_organization_id)
      AND (cardinality(role_keys)=0 OR role_keys @> ARRAY[(SELECT lower(role::text) FROM public.staff WHERE id=auth.uid())]);
  SELECT count(*) INTO v_completed FROM public.training_tasks t WHERE t.is_active AND t.module_key=p_module_key
    AND (t.organization_id IS NULL OR t.organization_id=p_organization_id)
    AND (cardinality(t.role_keys)=0 OR t.role_keys @> ARRAY[(SELECT lower(role::text) FROM public.staff WHERE id=auth.uid())])
    AND EXISTS (SELECT 1 FROM public.user_training_progress p WHERE p.organization_id=p_organization_id AND p.user_id=auth.uid() AND p.content_type='task' AND p.content_key=t.id::text AND p.status='completed');
  IF v_total=0 OR v_completed<v_total THEN RAISE EXCEPTION 'Complete all % training tasks before requesting a certificate',p_module_key; END IF;
  INSERT INTO public.training_certificates(organization_id,user_id,module_key,certificate_number,completed_tasks,total_points)
  VALUES(p_organization_id,auth.uid(),p_module_key,'BOAT-'||upper(left(p_module_key,4))||'-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(auth.uid()::text,'-',''),1,8)),v_completed,v_points)
  ON CONFLICT(organization_id,user_id,module_key) DO UPDATE SET completed_tasks=EXCLUDED.completed_tasks,total_points=EXCLUDED.total_points
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.reset_practice_training_account(uuid),public.issue_training_certificate(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_practice_training_account(uuid),public.issue_training_certificate(uuid,text) TO authenticated;
