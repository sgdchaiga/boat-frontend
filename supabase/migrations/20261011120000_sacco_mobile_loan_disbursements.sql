-- Mobile-loan disbursement control plane.
-- This deliberately extends sacco_loans rather than creating a second loan ledger.
-- A loan stays pending until the payment provider has confirmed the payout.

CREATE TABLE IF NOT EXISTS public.sacco_mobile_money_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'flutterwave' CHECK (provider IN ('flutterwave')),
  enabled boolean NOT NULL DEFAULT false,
  default_network text CHECK (default_network IN ('mtn', 'airtel')),
  mobile_money_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  loan_receivable_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sacco_loan_disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sacco_loan_id uuid NOT NULL REFERENCES public.sacco_loans(id) ON DELETE RESTRICT,
  sacco_member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'UGX' CHECK (currency = 'UGX'),
  phone_number text NOT NULL,
  network text NOT NULL CHECK (network IN ('mtn', 'airtel')),
  status text NOT NULL DEFAULT 'authorized' CHECK (status IN ('authorized', 'processing', 'paid', 'failed', 'cancelled')),
  provider text NOT NULL DEFAULT 'flutterwave',
  provider_reference text NOT NULL UNIQUE,
  provider_transaction_id text,
  authorized_by uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  paid_at timestamptz,
  failure_reason text,
  provider_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sacco_loan_id)
);
CREATE INDEX IF NOT EXISTS idx_sacco_loan_disbursements_org_status
  ON public.sacco_loan_disbursements (organization_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_sacco_loan_disbursements_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_sacco_loan_disbursements_touch ON public.sacco_loan_disbursements;
CREATE TRIGGER trg_sacco_loan_disbursements_touch BEFORE UPDATE ON public.sacco_loan_disbursements
FOR EACH ROW EXECUTE FUNCTION public.touch_sacco_loan_disbursements_updated_at();

ALTER TABLE public.sacco_mobile_money_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_loan_disbursements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sacco_mobile_money_settings_org" ON public.sacco_mobile_money_settings;
CREATE POLICY "sacco_mobile_money_settings_org" ON public.sacco_mobile_money_settings FOR ALL TO authenticated
USING (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()))
WITH CHECK (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()));
DROP POLICY IF EXISTS "sacco_loan_disbursements_org" ON public.sacco_loan_disbursements;
CREATE POLICY "sacco_loan_disbursements_org" ON public.sacco_loan_disbursements FOR SELECT TO authenticated
USING (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()));

GRANT SELECT, INSERT, UPDATE ON public.sacco_mobile_money_settings TO authenticated;
GRANT SELECT ON public.sacco_loan_disbursements TO authenticated;
GRANT ALL ON public.sacco_mobile_money_settings, public.sacco_loan_disbursements TO service_role;

-- The authorisation is atomic and always derives tenant, amount and recipient from
-- existing SACCO records. Clients cannot choose an organization or alter the amount.
CREATE OR REPLACE FUNCTION public.authorize_sacco_mobile_loan_disbursement(
  p_loan_id uuid, p_network text DEFAULT NULL, p_phone_number text DEFAULT NULL
) RETURNS public.sacco_loan_disbursements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_staff public.staff%ROWTYPE; v_loan public.sacco_loans%ROWTYPE; v_member public.sacco_members%ROWTYPE;
  v_settings public.sacco_mobile_money_settings%ROWTYPE; v_network text; v_phone text; v_out public.sacco_loan_disbursements%ROWTYPE;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Only SACCO staff may authorize loan disbursements'; END IF;
  SELECT * INTO v_loan FROM public.sacco_loans WHERE id = p_loan_id AND organization_id = v_staff.organization_id FOR UPDATE;
  IF NOT FOUND OR v_loan.status <> 'pending' OR v_loan.approval_stage < 2 THEN RAISE EXCEPTION 'Loan is not cleared for disbursement'; END IF;
  SELECT * INTO v_member FROM public.sacco_members WHERE id = v_loan.sacco_member_id AND organization_id = v_staff.organization_id;
  IF NOT FOUND OR NOT v_member.is_active THEN RAISE EXCEPTION 'Loan member is not active in this organization'; END IF;
  SELECT * INTO v_settings FROM public.sacco_mobile_money_settings WHERE organization_id = v_staff.organization_id;
  IF NOT FOUND OR NOT v_settings.enabled THEN RAISE EXCEPTION 'Mobile-money disbursement is not enabled for this SACCO'; END IF;
  IF v_settings.mobile_money_gl_account_id IS NULL OR v_settings.loan_receivable_gl_account_id IS NULL THEN
    RAISE EXCEPTION 'Configure the mobile-money asset and loan-receivable GL accounts before authorizing payouts';
  END IF;
  v_network := lower(coalesce(nullif(trim(p_network), ''), v_settings.default_network));
  IF v_network NOT IN ('mtn','airtel') THEN RAISE EXCEPTION 'Choose MTN or Airtel for this disbursement'; END IF;
  v_phone := regexp_replace(coalesce(nullif(trim(p_phone_number), ''), v_member.phone, ''), '\D', '', 'g');
  IF length(v_phone) = 10 AND left(v_phone,1) = '0' THEN v_phone := '256' || substr(v_phone,2); END IF;
  IF length(v_phone) < 9 OR length(v_phone) > 15 THEN RAISE EXCEPTION 'Member needs a valid mobile-money telephone number'; END IF;
  SELECT * INTO v_out FROM public.sacco_loan_disbursements WHERE organization_id=v_staff.organization_id AND sacco_loan_id=p_loan_id;
  IF FOUND THEN
    IF v_out.status IN ('authorized','processing','paid') THEN RETURN v_out; END IF;
    UPDATE public.sacco_loan_disbursements SET status='authorized', phone_number=v_phone, network=v_network, failure_reason=NULL,
      authorized_by=v_staff.id, authorized_at=now(), provider_reference='SACLOAN-' || replace(p_loan_id::text,'-','') || '-' || extract(epoch FROM clock_timestamp())::bigint
    WHERE id=v_out.id RETURNING * INTO v_out;
    RETURN v_out;
  END IF;
  INSERT INTO public.sacco_loan_disbursements (organization_id,sacco_loan_id,sacco_member_id,amount,phone_number,network,provider,provider_reference,authorized_by)
  VALUES (v_staff.organization_id,v_loan.id,v_member.id,v_loan.amount,v_phone,v_network,v_settings.provider,
    'SACLOAN-' || replace(v_loan.id::text,'-','') || '-' || extract(epoch FROM clock_timestamp())::bigint,v_staff.id)
  RETURNING * INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.authorize_sacco_mobile_loan_disbursement(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authorize_sacco_mobile_loan_disbursement(uuid,text,text) TO authenticated;

-- Called only by a trusted payment worker after provider verification. This is the
-- single point that changes the existing loan ledger to disbursed.
CREATE OR REPLACE FUNCTION public.finalize_sacco_mobile_loan_disbursement(
  p_provider_reference text, p_provider_transaction_id text, p_provider_response jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out public.sacco_loan_disbursements%ROWTYPE; v_settings public.sacco_mobile_money_settings%ROWTYPE; v_journal uuid;
BEGIN
  SELECT * INTO v_out FROM public.sacco_loan_disbursements WHERE provider_reference=p_provider_reference FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Disbursement was not found'; END IF;
  IF v_out.status = 'paid' THEN RETURN; END IF;
  IF v_out.status NOT IN ('authorized','processing') THEN RAISE EXCEPTION 'Disbursement cannot be finalized from %', v_out.status; END IF;
  SELECT * INTO v_settings FROM public.sacco_mobile_money_settings WHERE organization_id=v_out.organization_id;
  IF NOT FOUND OR v_settings.mobile_money_gl_account_id IS NULL OR v_settings.loan_receivable_gl_account_id IS NULL THEN
    RAISE EXCEPTION 'Disbursement accounting configuration is incomplete';
  END IF;
  INSERT INTO public.journal_entries (entry_date,description,reference_type,reference_id,created_by,organization_id,is_posted,is_deleted)
  VALUES (current_date,'Mobile-money loan disbursement ' || v_out.provider_reference,'sacco_loan_disbursement',v_out.id,v_out.authorized_by,v_out.organization_id,true,false)
  ON CONFLICT (reference_type,reference_id) WHERE (reference_id IS NOT NULL AND is_deleted=false) DO NOTHING RETURNING id INTO v_journal;
  IF v_journal IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id,gl_account_id,debit,credit,line_description)
    VALUES (v_journal,v_settings.loan_receivable_gl_account_id,v_out.amount,0,'Loan principal'),
           (v_journal,v_settings.mobile_money_gl_account_id,0,v_out.amount,'Mobile-money disbursement');
  END IF;
  UPDATE public.sacco_loan_disbursements SET status='paid', paid_at=now(), processed_at=coalesce(processed_at,now()),
    provider_transaction_id=p_provider_transaction_id, provider_response=p_provider_response, failure_reason=NULL WHERE id=v_out.id;
  UPDATE public.sacco_loans SET status='disbursed', balance=amount, paid_amount=0, disbursement_date=current_date
    WHERE id=v_out.sacco_loan_id AND organization_id=v_out.organization_id AND status='pending';
END $$;
REVOKE ALL ON FUNCTION public.finalize_sacco_mobile_loan_disbursement(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_sacco_mobile_loan_disbursement(text,text,jsonb) TO service_role;

COMMENT ON TABLE public.sacco_loan_disbursements IS 'Per-loan mobile-money payout control and provider audit trail. A provider confirmation finalizes sacco_loans.';
