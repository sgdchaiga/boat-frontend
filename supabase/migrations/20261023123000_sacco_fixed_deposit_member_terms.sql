-- Member acceptance is retained with the application, rather than inferred from UI state.
ALTER TABLE public.sacco_fixed_deposit_requests
  ADD COLUMN IF NOT EXISTS legal_terms_version text NOT NULL DEFAULT 'FD-MEMBER-TERMS-2026-10',
  ADD COLUMN IF NOT EXISTS legal_terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS legal_terms_accepted_ip text;

ALTER TABLE public.sacco_fixed_deposit_requests
  ADD CONSTRAINT sacco_fd_request_terms_required
  CHECK (status <> 'pending' OR legal_terms_accepted_at IS NOT NULL) NOT VALID;

DROP FUNCTION IF EXISTS public.request_sacco_fixed_deposit(uuid,uuid,numeric,boolean);
CREATE FUNCTION public.request_sacco_fixed_deposit(
  p_product_id uuid, p_source_account_id uuid, p_amount numeric, p_auto_renew boolean DEFAULT false,
  p_accept_terms boolean DEFAULT false, p_terms_version text DEFAULT 'FD-MEMBER-TERMS-2026-10'
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_member uuid:=current_sacco_member_id(); v_org uuid:=current_sacco_member_org_id(); v_product sacco_fixed_deposit_products%ROWTYPE; v_account sacco_member_savings_accounts%ROWTYPE; v_id uuid;
BEGIN
  IF p_accept_terms IS DISTINCT FROM true THEN RAISE EXCEPTION 'You must accept the fixed-deposit terms before submitting'; END IF;
  IF coalesce(trim(p_terms_version),'') <> 'FD-MEMBER-TERMS-2026-10' THEN RAISE EXCEPTION 'Please review the current fixed-deposit terms'; END IF;
  IF v_member IS NULL OR v_org IS NULL THEN RAISE EXCEPTION 'Member login required'; END IF;
  SELECT * INTO v_product FROM sacco_fixed_deposit_products WHERE id=p_product_id AND organization_id=v_org AND is_active FOR SHARE;
  IF NOT FOUND OR p_amount < v_product.minimum_amount THEN RAISE EXCEPTION 'Product is unavailable or amount is below its minimum'; END IF;
  SELECT * INTO v_account FROM sacco_member_savings_accounts WHERE id=p_source_account_id AND organization_id=v_org AND sacco_member_id=v_member AND is_active FOR UPDATE;
  IF NOT FOUND OR upper(v_account.savings_product_code) IN ('SHA','SHARES','EQUITY') THEN RAISE EXCEPTION 'Choose an active ordinary savings account'; END IF;
  IF v_account.balance < p_amount THEN RAISE EXCEPTION 'Insufficient available savings balance'; END IF;
  INSERT INTO sacco_fixed_deposit_requests(organization_id,sacco_member_id,source_savings_account_id,product_id,amount,auto_renew,legal_terms_version,legal_terms_accepted_at)
  VALUES(v_org,v_member,p_source_account_id,p_product_id,p_amount,p_auto_renew,p_terms_version,now()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.request_sacco_fixed_deposit(uuid,uuid,numeric,boolean,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_sacco_fixed_deposit(uuid,uuid,numeric,boolean,boolean,text) TO authenticated;
