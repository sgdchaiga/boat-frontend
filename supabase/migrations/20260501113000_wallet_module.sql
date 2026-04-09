-- Wallet module (all business types): wallets, balances, limits, transactions, audits

CREATE TABLE IF NOT EXISTS public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  wallet_number text NOT NULL,
  kyc_level text NOT NULL DEFAULT 'tier_1' CHECK (kyc_level IN ('tier_1','tier_2','tier_3')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallets_org_owner_unique UNIQUE (organization_id, owner_staff_id),
  CONSTRAINT wallets_org_number_unique UNIQUE (organization_id, wallet_number)
);

CREATE TABLE IF NOT EXISTS public.wallet_balances (
  wallet_id uuid PRIMARY KEY REFERENCES public.wallets(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  current_balance numeric(18,2) NOT NULL DEFAULT 0,
  available_balance numeric(18,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_limits (
  wallet_id uuid PRIMARY KEY REFERENCES public.wallets(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  max_balance numeric(18,2),
  max_txn_amount numeric(18,2),
  daily_limit numeric(18,2),
  monthly_limit numeric(18,2),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  counterparty_wallet_id uuid REFERENCES public.wallets(id) ON DELETE SET NULL,
  txn_type text NOT NULL CHECK (txn_type IN ('deposit','withdrawal','payment','transfer','adjustment')),
  direction text NOT NULL CHECK (direction IN ('in','out')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('pending','posted','reversed','failed')),
  reference text,
  narration text,
  idempotency_key text,
  auto_post_status text NOT NULL DEFAULT 'queued' CHECK (auto_post_status IN ('queued','posted','failed','skipped')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_tx_idempotency_unique UNIQUE (organization_id, wallet_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.wallet_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  wallet_id uuid REFERENCES public.wallets(id) ON DELETE SET NULL,
  wallet_transaction_id uuid REFERENCES public.wallet_transactions(id) ON DELETE SET NULL,
  action text NOT NULL,
  actor_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_time ON public.wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_org_time ON public.wallet_transactions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_audit_org_time ON public.wallet_audit_logs(organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_wallets_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_wallets_touch ON public.wallets;
CREATE TRIGGER trg_wallets_touch BEFORE UPDATE ON public.wallets
FOR EACH ROW EXECUTE FUNCTION public.touch_wallets_updated_at();

CREATE OR REPLACE FUNCTION public.ensure_wallet_defaults()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.wallet_balances(wallet_id, organization_id)
  VALUES (NEW.id, NEW.organization_id)
  ON CONFLICT (wallet_id) DO NOTHING;

  INSERT INTO public.wallet_limits(wallet_id, organization_id, max_balance, max_txn_amount, daily_limit, monthly_limit)
  VALUES (NEW.id, NEW.organization_id, 5000000, 1000000, 2000000, 20000000)
  ON CONFLICT (wallet_id) DO NOTHING;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_wallet_defaults ON public.wallets;
CREATE TRIGGER trg_wallet_defaults AFTER INSERT ON public.wallets
FOR EACH ROW EXECUTE FUNCTION public.ensure_wallet_defaults();

CREATE OR REPLACE FUNCTION public.wallet_post_transaction(
  p_wallet_id uuid,
  p_txn_type text,
  p_amount numeric,
  p_counterparty_wallet_id uuid DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_narration text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org uuid;
  v_dir text;
  v_txn_id uuid;
  v_curr numeric(18,2);
  v_daily_total numeric(18,2);
  v_month_total numeric(18,2);
  v_limit record;
  v_counter_org uuid;
  v_cp_txn uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.wallets WHERE id = p_wallet_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  IF p_txn_type IN ('deposit','adjustment') THEN v_dir := 'in';
  ELSIF p_txn_type IN ('withdrawal','payment','transfer') THEN v_dir := 'out';
  ELSE RAISE EXCEPTION 'Unsupported transaction type'; END IF;

  SELECT * INTO v_limit FROM public.wallet_limits WHERE wallet_id = p_wallet_id;
  IF v_limit.max_txn_amount IS NOT NULL AND p_amount > v_limit.max_txn_amount THEN
    RAISE EXCEPTION 'Exceeds max transaction limit';
  END IF;

  IF v_limit.daily_limit IS NOT NULL THEN
    SELECT COALESCE(SUM(amount),0) INTO v_daily_total
    FROM public.wallet_transactions
    WHERE wallet_id = p_wallet_id AND status = 'posted' AND created_at::date = now()::date;
    IF v_daily_total + p_amount > v_limit.daily_limit THEN
      RAISE EXCEPTION 'Exceeds daily limit';
    END IF;
  END IF;

  IF v_limit.monthly_limit IS NOT NULL THEN
    SELECT COALESCE(SUM(amount),0) INTO v_month_total
    FROM public.wallet_transactions
    WHERE wallet_id = p_wallet_id
      AND status = 'posted'
      AND date_trunc('month', created_at) = date_trunc('month', now());
    IF v_month_total + p_amount > v_limit.monthly_limit THEN
      RAISE EXCEPTION 'Exceeds monthly limit';
    END IF;
  END IF;

  SELECT current_balance INTO v_curr FROM public.wallet_balances WHERE wallet_id = p_wallet_id FOR UPDATE;
  IF v_dir = 'out' AND COALESCE(v_curr,0) < p_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  IF v_dir = 'out' THEN
    UPDATE public.wallet_balances
      SET current_balance = current_balance - p_amount,
          available_balance = available_balance - p_amount,
          updated_at = now()
    WHERE wallet_id = p_wallet_id;
  ELSE
    UPDATE public.wallet_balances
      SET current_balance = current_balance + p_amount,
          available_balance = available_balance + p_amount,
          updated_at = now()
    WHERE wallet_id = p_wallet_id;
  END IF;

  INSERT INTO public.wallet_transactions(
    organization_id, wallet_id, counterparty_wallet_id, txn_type, direction, amount, status, reference, narration,
    idempotency_key, metadata, created_by, auto_post_status
  ) VALUES (
    v_org, p_wallet_id, p_counterparty_wallet_id, p_txn_type, v_dir, p_amount, 'posted', p_reference, p_narration,
    p_idempotency_key, COALESCE(p_metadata, '{}'::jsonb), p_created_by, 'queued'
  )
  RETURNING id INTO v_txn_id;

  IF p_txn_type = 'transfer' AND p_counterparty_wallet_id IS NOT NULL THEN
    SELECT organization_id INTO v_counter_org FROM public.wallets WHERE id = p_counterparty_wallet_id;
    IF v_counter_org IS NULL OR v_counter_org <> v_org THEN
      RAISE EXCEPTION 'Counterparty wallet invalid';
    END IF;

    UPDATE public.wallet_balances
      SET current_balance = current_balance + p_amount,
          available_balance = available_balance + p_amount,
          updated_at = now()
    WHERE wallet_id = p_counterparty_wallet_id;

    INSERT INTO public.wallet_transactions(
      organization_id, wallet_id, counterparty_wallet_id, txn_type, direction, amount, status, reference, narration,
      metadata, created_by, auto_post_status
    ) VALUES (
      v_org, p_counterparty_wallet_id, p_wallet_id, 'transfer', 'in', p_amount, 'posted', p_reference, p_narration,
      jsonb_build_object('mirror_of', v_txn_id), p_created_by, 'queued'
    ) RETURNING id INTO v_cp_txn;
  END IF;

  INSERT INTO public.wallet_audit_logs(organization_id, wallet_id, wallet_transaction_id, action, actor_staff_id, details)
  VALUES (
    v_org, p_wallet_id, v_txn_id, 'wallet_transaction_posted', p_created_by,
    jsonb_build_object('txn_type', p_txn_type, 'amount', p_amount, 'direction', v_dir, 'counterparty_wallet_id', p_counterparty_wallet_id)
  );

  INSERT INTO public.wallet_audit_logs(organization_id, wallet_id, wallet_transaction_id, action, actor_staff_id, details)
  VALUES (
    v_org, p_wallet_id, v_txn_id, 'sms_alert_queued', p_created_by,
    jsonb_build_object('status', 'queued')
  );

  RETURN v_txn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_post_transaction(uuid, text, numeric, uuid, text, text, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_post_transaction(uuid, text, numeric, uuid, text, text, uuid, text, jsonb) TO authenticated;

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_audit_logs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wallets','wallet_balances','wallet_limits','wallet_transactions','wallet_audit_logs']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_same_org', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write_same_org', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (
        organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      )',
      t || '_select_same_org', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (
        organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      ) WITH CHECK (
        organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      )',
      t || '_write_same_org', t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_balances TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_limits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_audit_logs TO authenticated;
