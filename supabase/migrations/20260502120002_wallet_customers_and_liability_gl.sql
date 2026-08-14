-- Wallets: link to business customers (hotel_customers / retail_customers) and post to wallet liability GL.

-- 1) Journal GL settings — wallet posting (per org)
ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS wallet_liability_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wallet_clearing_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.journal_gl_settings.wallet_liability_gl_account_id IS
  'Customer wallet balances — liability (credit when customer tops up).';
COMMENT ON COLUMN public.journal_gl_settings.wallet_clearing_gl_account_id IS
  'Contra account for wallet cash/bank movements (e.g. cash on hand, wallet clearing).';

-- 2) Wallet transactions — link to posted journal
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_journal_entry
  ON public.wallet_transactions(journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;

-- 3) Wallets — staff owner → customer (hotel or retail)
ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallets_org_owner_unique;
ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallets_owner_staff_id_fkey;

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS customer_kind text CHECK (customer_kind IN ('hotel', 'retail')),
  ADD COLUMN IF NOT EXISTS hotel_customer_id uuid REFERENCES public.hotel_customers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS retail_customer_id uuid REFERENCES public.retail_customers(id) ON DELETE CASCADE;

-- Remove legacy staff-linked rows (pre-release / dev); cannot map staff → customer.
DELETE FROM public.wallet_audit_logs;
DELETE FROM public.wallet_transactions;
DELETE FROM public.wallet_balances;
DELETE FROM public.wallet_limits;
DELETE FROM public.wallets;

ALTER TABLE public.wallets DROP COLUMN IF EXISTS owner_staff_id;

ALTER TABLE public.wallets
  ADD CONSTRAINT wallets_customer_check CHECK (
    (customer_kind = 'hotel' AND hotel_customer_id IS NOT NULL AND retail_customer_id IS NULL)
    OR (customer_kind = 'retail' AND retail_customer_id IS NOT NULL AND hotel_customer_id IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS wallets_org_hotel_unique
  ON public.wallets (organization_id, hotel_customer_id)
  WHERE hotel_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS wallets_org_retail_unique
  ON public.wallets (organization_id, retail_customer_id)
  WHERE retail_customer_id IS NOT NULL;

ALTER TABLE public.wallets ALTER COLUMN customer_kind SET NOT NULL;

-- 4) Replace wallet_post_transaction: balances + optional GL to liability + clearing
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
SET search_path = public
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
  v_clearing uuid;
  v_liability uuid;
  v_je uuid;
  v_lines jsonb;
  v_from_w record;
  v_to_w record;
  v_desc text;
  v_dim_from jsonb;
  v_dim_to jsonb;
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

  SELECT wallet_clearing_gl_account_id, wallet_liability_gl_account_id
  INTO v_clearing, v_liability
  FROM public.journal_gl_settings
  WHERE organization_id = v_org;

  SELECT * INTO v_from_w FROM public.wallets WHERE id = p_wallet_id;

  v_dim_from := jsonb_strip_nulls(jsonb_build_object(
    'wallet_id', v_from_w.id,
    'customer_kind', v_from_w.customer_kind,
    'hotel_customer_id', v_from_w.hotel_customer_id,
    'retail_customer_id', v_from_w.retail_customer_id
  ));

  v_desc := COALESCE(NULLIF(TRIM(p_narration), ''), p_txn_type || ' ' || p_amount::text);

  IF p_txn_type = 'transfer' AND p_counterparty_wallet_id IS NOT NULL AND v_liability IS NOT NULL THEN
    BEGIN
      SELECT * INTO v_to_w FROM public.wallets WHERE id = p_counterparty_wallet_id;
      v_dim_to := jsonb_strip_nulls(jsonb_build_object(
        'wallet_id', v_to_w.id,
        'customer_kind', v_to_w.customer_kind,
        'hotel_customer_id', v_to_w.hotel_customer_id,
        'retail_customer_id', v_to_w.retail_customer_id
      ));
      v_lines := jsonb_build_array(
        jsonb_build_object(
          'gl_account_id', v_liability,
          'debit', p_amount,
          'credit', 0,
          'line_description', v_desc,
          'dimensions', v_dim_from
        ),
        jsonb_build_object(
          'gl_account_id', v_liability,
          'debit', 0,
          'credit', p_amount,
          'line_description', v_desc,
          'dimensions', v_dim_to
        )
      );

      v_je := public.create_journal_entry_atomic(
        (CURRENT_TIMESTAMP AT TIME ZONE 'utc')::date,
        'Wallet transfer',
        'wallet_transaction',
        v_txn_id,
        p_created_by,
        v_lines
      );

      UPDATE public.wallet_transactions
      SET journal_entry_id = v_je,
          auto_post_status = 'posted'
      WHERE id = v_txn_id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.wallet_transactions
      SET auto_post_status = 'failed',
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('gl_error', SQLERRM)
      WHERE id = v_txn_id;
    END;
  ELSIF p_txn_type = 'transfer' AND p_counterparty_wallet_id IS NOT NULL AND v_liability IS NULL THEN
    UPDATE public.wallet_transactions
    SET auto_post_status = 'skipped',
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('gl_skip_reason', 'missing_wallet_liability_gl')
    WHERE id = v_txn_id;
  ELSIF v_clearing IS NOT NULL AND v_liability IS NOT NULL THEN
    BEGIN
      IF v_dir = 'in' THEN
        v_lines := jsonb_build_array(
          jsonb_build_object(
            'gl_account_id', v_clearing,
            'debit', p_amount,
            'credit', 0,
            'line_description', v_desc,
            'dimensions', '{}'::jsonb
          ),
          jsonb_build_object(
            'gl_account_id', v_liability,
            'debit', 0,
            'credit', p_amount,
            'line_description', v_desc,
            'dimensions', v_dim_from
          )
        );
      ELSE
        v_lines := jsonb_build_array(
          jsonb_build_object(
            'gl_account_id', v_liability,
            'debit', p_amount,
            'credit', 0,
            'line_description', v_desc,
            'dimensions', v_dim_from
          ),
          jsonb_build_object(
            'gl_account_id', v_clearing,
            'debit', 0,
            'credit', p_amount,
            'line_description', v_desc,
            'dimensions', '{}'::jsonb
          )
        );
      END IF;

      v_je := public.create_journal_entry_atomic(
        (CURRENT_TIMESTAMP AT TIME ZONE 'utc')::date,
        'Wallet ' || p_txn_type,
        'wallet_transaction',
        v_txn_id,
        p_created_by,
        v_lines
      );

      UPDATE public.wallet_transactions
      SET journal_entry_id = v_je,
          auto_post_status = 'posted'
      WHERE id = v_txn_id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.wallet_transactions
      SET auto_post_status = 'failed',
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('gl_error', SQLERRM)
      WHERE id = v_txn_id;
    END;
  ELSE
    UPDATE public.wallet_transactions
    SET auto_post_status = 'skipped',
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('gl_skip_reason', 'missing_wallet_gl_accounts')
    WHERE id = v_txn_id;
  END IF;

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
      jsonb_build_object('mirror_of', v_txn_id), p_created_by, 'skipped'
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

COMMENT ON FUNCTION public.wallet_post_transaction(uuid, text, numeric, uuid, text, text, uuid, text, jsonb) IS
  'Posts wallet movement; debits/credits wallet liability GL (+ clearing) or wallet-to-wallet liability transfer. Mirror transfer leg is not re-posted to GL.';
