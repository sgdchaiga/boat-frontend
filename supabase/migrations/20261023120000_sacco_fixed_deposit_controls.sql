-- Fixed-deposit products, maker-checker requests, immutable audit records and member savings funding.
CREATE TABLE IF NOT EXISTS public.sacco_fixed_deposit_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL, term_months integer NOT NULL CHECK (term_months > 0), annual_rate numeric NOT NULL CHECK (annual_rate >= 0),
  minimum_amount numeric NOT NULL DEFAULT 10000 CHECK (minimum_amount > 0), withholding_tax_rate numeric NOT NULL DEFAULT 0 CHECK (withholding_tax_rate BETWEEN 0 AND 100),
  allow_auto_renew boolean NOT NULL DEFAULT true, requires_approval boolean NOT NULL DEFAULT true, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id, name)
);
CREATE TABLE IF NOT EXISTS public.sacco_fixed_deposit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sacco_member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE, source_savings_account_id uuid NOT NULL REFERENCES public.sacco_member_savings_accounts(id),
  product_id uuid NOT NULL REFERENCES public.sacco_fixed_deposit_products(id), amount numeric NOT NULL CHECK(amount > 0), auto_renew boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')), requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz, reviewed_by uuid, review_note text, fixed_deposit_id uuid REFERENCES public.sacco_fixed_deposits(id), UNIQUE(id, organization_id)
);
CREATE TABLE IF NOT EXISTS public.sacco_fixed_deposit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fixed_deposit_id uuid NOT NULL REFERENCES public.sacco_fixed_deposits(id) ON DELETE CASCADE, event_type text NOT NULL,
  amount numeric NOT NULL DEFAULT 0, note text, actor_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sacco_fixed_deposits ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.sacco_fixed_deposit_products(id);
ALTER TABLE public.sacco_fixed_deposits ADD COLUMN IF NOT EXISTS source_savings_account_id uuid REFERENCES public.sacco_member_savings_accounts(id);
ALTER TABLE public.sacco_fixed_deposits ADD COLUMN IF NOT EXISTS withholding_tax numeric NOT NULL DEFAULT 0;
ALTER TABLE public.sacco_fixed_deposits ADD COLUMN IF NOT EXISTS net_interest numeric NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS sacco_fd_requests_pending ON public.sacco_fixed_deposit_requests(organization_id, status, requested_at);

ALTER TABLE public.sacco_fixed_deposit_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_fixed_deposit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_fixed_deposit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sacco_fd_products_staff ON public.sacco_fixed_deposit_products;
DROP POLICY IF EXISTS sacco_fd_requests_staff ON public.sacco_fixed_deposit_requests;
DROP POLICY IF EXISTS sacco_fd_events_staff ON public.sacco_fixed_deposit_events;
DROP POLICY IF EXISTS sacco_fd_products_member ON public.sacco_fixed_deposit_products;
DROP POLICY IF EXISTS sacco_fd_requests_member ON public.sacco_fixed_deposit_requests;
CREATE POLICY sacco_fd_products_staff ON public.sacco_fixed_deposit_products FOR ALL TO authenticated USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())) WITH CHECK (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY sacco_fd_requests_staff ON public.sacco_fixed_deposit_requests FOR ALL TO authenticated USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())) WITH CHECK (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY sacco_fd_events_staff ON public.sacco_fixed_deposit_events FOR SELECT TO authenticated USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY sacco_fd_products_member ON public.sacco_fixed_deposit_products FOR SELECT TO authenticated USING (organization_id=public.current_sacco_member_org_id() AND is_active);
CREATE POLICY sacco_fd_requests_member ON public.sacco_fixed_deposit_requests FOR SELECT TO authenticated USING (sacco_member_id=public.current_sacco_member_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_fixed_deposit_products, public.sacco_fixed_deposit_requests TO authenticated;
GRANT SELECT ON public.sacco_fixed_deposit_events TO authenticated;

CREATE OR REPLACE FUNCTION public.request_sacco_fixed_deposit(p_product_id uuid, p_source_account_id uuid, p_amount numeric, p_auto_renew boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_member uuid:=current_sacco_member_id(); v_org uuid:=current_sacco_member_org_id(); v_product sacco_fixed_deposit_products%ROWTYPE; v_account sacco_member_savings_accounts%ROWTYPE; v_id uuid;
BEGIN
  IF v_member IS NULL OR v_org IS NULL THEN RAISE EXCEPTION 'Member login required'; END IF;
  SELECT * INTO v_product FROM sacco_fixed_deposit_products WHERE id=p_product_id AND organization_id=v_org AND is_active FOR SHARE;
  IF NOT FOUND OR p_amount < v_product.minimum_amount THEN RAISE EXCEPTION 'Product is unavailable or amount is below its minimum'; END IF;
  SELECT * INTO v_account FROM sacco_member_savings_accounts WHERE id=p_source_account_id AND organization_id=v_org AND sacco_member_id=v_member AND is_active FOR UPDATE;
  IF NOT FOUND OR upper(v_account.savings_product_code) IN ('SHA','SHARES','EQUITY') THEN RAISE EXCEPTION 'Choose an active ordinary savings account'; END IF;
  IF v_account.balance < p_amount THEN RAISE EXCEPTION 'Insufficient available savings balance'; END IF;
  INSERT INTO sacco_fixed_deposit_requests(organization_id,sacco_member_id,source_savings_account_id,product_id,amount,auto_renew)
  VALUES(v_org,v_member,p_source_account_id,p_product_id,p_amount,p_auto_renew) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.review_sacco_fixed_deposit_request(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_staff staff%ROWTYPE; v_req sacco_fixed_deposit_requests%ROWTYPE; v_product sacco_fixed_deposit_products%ROWTYPE; v_account sacco_member_savings_accounts%ROWTYPE; v_member sacco_members%ROWTYPE; v_fd uuid; v_interest numeric; v_tax numeric; v_previous numeric;
BEGIN
  SELECT * INTO v_staff FROM staff WHERE id=auth.uid(); IF NOT FOUND THEN RAISE EXCEPTION 'Staff authorization required'; END IF;
  SELECT * INTO v_req FROM sacco_fixed_deposit_requests WHERE id=p_request_id AND organization_id=v_staff.organization_id FOR UPDATE; IF NOT FOUND OR v_req.status <> 'pending' THEN RAISE EXCEPTION 'Request is not pending'; END IF;
  IF NOT p_approve THEN UPDATE sacco_fixed_deposit_requests SET status='rejected',reviewed_at=now(),reviewed_by=auth.uid(),review_note=nullif(trim(p_note),'') WHERE id=v_req.id; RETURN NULL; END IF;
  SELECT * INTO v_product FROM sacco_fixed_deposit_products WHERE id=v_req.product_id AND is_active FOR SHARE; SELECT * INTO v_account FROM sacco_member_savings_accounts WHERE id=v_req.source_savings_account_id FOR UPDATE; SELECT * INTO v_member FROM sacco_members WHERE id=v_req.sacco_member_id;
  IF v_account.balance < v_req.amount THEN RAISE EXCEPTION 'Member no longer has sufficient savings balance'; END IF;
  v_interest:=round(v_req.amount*v_product.annual_rate/100*v_product.term_months/12,2); v_tax:=round(v_interest*v_product.withholding_tax_rate/100,2);
  UPDATE sacco_member_savings_accounts SET balance=balance-v_req.amount WHERE id=v_account.id;
  INSERT INTO sacco_fixed_deposits(organization_id,sacco_member_id,member_name,amount,interest_rate,term_months,start_date,maturity_date,interest_earned,withholding_tax,net_interest,auto_renew,status,product_id,source_savings_account_id)
  VALUES(v_req.organization_id,v_req.sacco_member_id,v_member.name,v_req.amount,v_product.annual_rate,v_product.term_months,current_date,current_date+(v_product.term_months || ' months')::interval,v_interest,v_tax,v_interest-v_tax,v_req.auto_renew AND v_product.allow_auto_renew,'active',v_product.id,v_account.id) RETURNING id INTO v_fd;
  SELECT coalesce(balance,0) INTO v_previous FROM sacco_cashbook_entries WHERE organization_id=v_req.organization_id ORDER BY created_at DESC LIMIT 1;
  INSERT INTO sacco_cashbook_entries(organization_id,entry_date,description,reference,category,sacco_member_id,member_name,debit,credit,balance) VALUES(v_req.organization_id,current_date,'Fixed deposit funded from savings','FD-'||left(v_fd::text,8),'fixed_deposit',v_req.sacco_member_id,v_member.name,0,v_req.amount,coalesce(v_previous,0)-v_req.amount);
  INSERT INTO sacco_fixed_deposit_events(organization_id,fixed_deposit_id,event_type,amount,note,actor_id) VALUES(v_req.organization_id,v_fd,'opened',v_req.amount,'Approved from savings account',auth.uid());
  UPDATE sacco_fixed_deposit_requests SET status='approved',reviewed_at=now(),reviewed_by=auth.uid(),review_note=nullif(trim(p_note),''),fixed_deposit_id=v_fd WHERE id=v_req.id;
  RETURN v_fd;
END $$;
REVOKE ALL ON FUNCTION public.request_sacco_fixed_deposit(uuid,uuid,numeric,boolean), public.review_sacco_fixed_deposit_request(uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_sacco_fixed_deposit(uuid,uuid,numeric,boolean), public.review_sacco_fixed_deposit_request(uuid,boolean,text) TO authenticated;
