-- SACCO Clearing Engine schema — apply ONLY to your dedicated Clearing Supabase project.
-- Keeps ledger/settlement isolated from Retail/Hotel/School BOAT operational DB.
-- Run in Supabase SQL Editor (or `psql` against the clearing project).

-- Optional: Extensions
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── A. SACCOs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saccos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed', 'system')),
  shareholding jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.saccos ENABLE ROW LEVEL SECURITY;


-- ─── B. Settlement accounts (one row per SACCO) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.settlement_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_id uuid NOT NULL REFERENCES public.saccos (id) ON DELETE RESTRICT,
  balance numeric(20, 2) NOT NULL DEFAULT 0,
  minimum_required_balance numeric(20, 2) NOT NULL DEFAULT 0 CHECK (minimum_required_balance >= 0),
  last_updated timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_accounts_sacco_unique UNIQUE (sacco_id),
  CONSTRAINT settlement_balance_non_negative_members CHECK (
    sacco_id = '00000000-0000-4000-8000-000000000001'::uuid
    OR balance >= 0
  )
);

ALTER TABLE public.settlement_accounts ENABLE ROW LEVEL SECURITY;


-- ─── E. Shares (capital / governance tracking) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.sacco_shares (
  sacco_id uuid PRIMARY KEY REFERENCES public.saccos (id) ON DELETE CASCADE,
  shares numeric(20, 4) NOT NULL DEFAULT 100 CHECK (shares >= 0),
  capital_contribution numeric(20, 2) NOT NULL DEFAULT 0 CHECK (capital_contribution >= 0),
  transaction_volume_score numeric(24, 2) NOT NULL DEFAULT 0 CHECK (transaction_volume_score >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sacco_shares ENABLE ROW LEVEL SECURITY;


-- ─── C. Transactions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_sacco_id uuid REFERENCES public.saccos (id) ON DELETE RESTRICT,
  to_sacco_id uuid REFERENCES public.saccos (id) ON DELETE RESTRICT,
  amount numeric(20, 2) NOT NULL CHECK (amount > 0),
  type text NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  reference text NOT NULL,
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  suspicious_flag boolean NOT NULL DEFAULT false,
  suspicious_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transactions_parties_xor CHECK (
    (from_sacco_id IS NOT NULL OR to_sacco_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS transactions_reference_unique ON public.transactions (reference);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_idempotency_unique
  ON public.transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_from_created ON public.transactions (from_sacco_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_to_created ON public.transactions (to_sacco_id, created_at DESC);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;


-- ─── D. Ledger entries (append-only balances) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions (id) ON DELETE RESTRICT,
  sacco_id uuid NOT NULL REFERENCES public.saccos (id) ON DELETE RESTRICT,
  debit numeric(20, 2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(20, 2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  balance_after numeric(20, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_one_side_positive CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  )
);

CREATE INDEX IF NOT EXISTS ledger_entries_sacco_created ON public.ledger_entries (sacco_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_entries_txn ON public.ledger_entries (transaction_id);

ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;


-- Auto-create settlement row + shares when a non-system SACCO is inserted
CREATE OR REPLACE FUNCTION public.clearing_after_sacco_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'system' THEN
    INSERT INTO public.settlement_accounts (sacco_id, balance, minimum_required_balance)
    VALUES (NEW.id, 0, 0)
    ON CONFLICT (sacco_id) DO NOTHING;

    INSERT INTO public.sacco_shares (sacco_id, shares, capital_contribution, transaction_volume_score)
    VALUES (NEW.id, 100, 0, 0)
    ON CONFLICT (sacco_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clearing_after_sacco_insert ON public.saccos;
CREATE TRIGGER trg_clearing_after_sacco_insert
  AFTER INSERT ON public.saccos
  FOR EACH ROW EXECUTE FUNCTION public.clearing_after_sacco_insert();


-- Pool SACCO settlement row (mirror balance for double-entry completeness)
CREATE OR REPLACE FUNCTION public.clearing_bootstrap_network_pool_accounts()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  pool_id uuid := '00000000-0000-4000-8000-000000000001'::uuid;
BEGIN
  INSERT INTO public.settlement_accounts (sacco_id, balance, minimum_required_balance)
  VALUES (pool_id, 0, 0)
  ON CONFLICT (sacco_id) DO NOTHING;

  INSERT INTO public.sacco_shares (sacco_id, shares)
  VALUES (pool_id, 0)
  ON CONFLICT (sacco_id) DO NOTHING;
END;
$$;

-- Well-known SACCO: double-entry counterpart for pooled cash / top-ups (seed after tables + trigger exist).
INSERT INTO public.saccos (id, name, status, shareholding)
VALUES (
  '00000000-0000-4000-8000-000000000001'::uuid,
  'BOAT Clearing Network Pool',
  'system',
  '{"kind":"network_pool"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

SELECT public.clearing_bootstrap_network_pool_accounts();

-- ─── Compliance / KYC stubs (immutable log pointers) ────────────────────────
CREATE TABLE IF NOT EXISTS public.member_kyc_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_member_ref text NOT NULL,
  sacco_id uuid NOT NULL REFERENCES public.saccos (id) ON DELETE CASCADE,
  kyc_level text NOT NULL DEFAULT 'pending',
  kyc_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_member_ref, sacco_id)
);

ALTER TABLE public.member_kyc_profiles ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS compliance_txn_audit ON public.transactions (created_at DESC);


-- ─── RPC: inter-SACCO transfer (atomic liquidity + ledger) ──────────────────
CREATE OR REPLACE FUNCTION public.clearing_execute_inter_sacco_transfer(
  p_from_sacco uuid,
  p_to_sacco uuid,
  p_amount numeric,
  p_type text,
  p_reference text,
  p_idempotency_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pool uuid := '00000000-0000-4000-8000-000000000001'::uuid;
  v_existing uuid;
  v_txn uuid;
  v_bal_from_before numeric(20, 2);
  v_bal_from_after numeric(20, 2);
  v_bal_to_before numeric(20, 2);
  v_bal_to_after numeric(20, 2);
  v_min_from numeric(20, 2);
BEGIN
  IF p_from_sacco IS NULL OR p_to_sacco IS NULL THEN
    RAISE EXCEPTION 'from_sacco and to_sacco are required for transfers';
  END IF;
  IF p_from_sacco = p_to_sacco THEN
    RAISE EXCEPTION 'from_sacco and to_sacco must differ';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;
  IF p_type IS NULL OR btrim(p_type) = '' THEN
    RAISE EXCEPTION 'type is required';
  END IF;
  IF p_reference IS NULL OR btrim(p_reference) = '' THEN
    RAISE EXCEPTION 'reference is required';
  END IF;

  IF p_from_sacco = v_pool OR p_to_sacco = v_pool THEN
    RAISE EXCEPTION 'use clearing_credit / clearing_network_* RPCs for pool movements';
  END IF;

  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
    SELECT id INTO v_existing FROM public.transactions WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('duplicate', true, 'transaction_id', v_existing);
    END IF;
  END IF;

  SELECT id INTO v_existing FROM public.transactions WHERE reference = p_reference LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'reference already exists: %', p_reference;
  END IF;

  SELECT balance, minimum_required_balance
  INTO v_bal_from_before, v_min_from
  FROM public.settlement_accounts
  WHERE sacco_id = p_from_sacco
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement account not found for from_sacco %', p_from_sacco;
  END IF;

  SELECT balance INTO v_bal_to_before
  FROM public.settlement_accounts
  WHERE sacco_id = p_to_sacco
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement account not found for to_sacco %', p_to_sacco;
  END IF;

  IF v_bal_from_before - p_amount < v_min_from THEN
    RAISE EXCEPTION 'liquidity_blocked: insufficient balance respecting minimum_required_balance (balance=%, minimum=%, amount=%)',
      v_bal_from_before, v_min_from, p_amount;
  END IF;

  v_bal_from_after := v_bal_from_before - p_amount;
  v_bal_to_after := v_bal_to_before + p_amount;

  INSERT INTO public.transactions (
    from_sacco_id, to_sacco_id, amount, type, status, reference, idempotency_key, metadata
  )
  VALUES (
    p_from_sacco, p_to_sacco, p_amount, p_type, 'completed', p_reference, NULLIF(trim(p_idempotency_key), ''), COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_txn;

  INSERT INTO public.ledger_entries (transaction_id, sacco_id, debit, credit, balance_after)
  VALUES
    (v_txn, p_from_sacco, p_amount, 0, v_bal_from_after),
    (v_txn, p_to_sacco, 0, p_amount, v_bal_to_after);

  UPDATE public.settlement_accounts
  SET balance = v_bal_from_after, last_updated = now()
  WHERE sacco_id = p_from_sacco;

  UPDATE public.settlement_accounts
  SET balance = v_bal_to_after, last_updated = now()
  WHERE sacco_id = p_to_sacco;

  UPDATE public.sacco_shares
  SET transaction_volume_score = transaction_volume_score + p_amount, updated_at = now()
  WHERE sacco_id IN (p_from_sacco, p_to_sacco);

  RETURN jsonb_build_object(
    'duplicate', false,
    'transaction_id', v_txn,
    'from_balance_after', v_bal_from_after,
    'to_balance_after', v_bal_to_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.clearing_execute_inter_sacco_transfer(uuid, uuid, numeric, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clearing_execute_inter_sacco_transfer(uuid, uuid, numeric, text, text, text, jsonb) TO service_role;


-- Credit a SACCO from the network pool (bank / mobile-money / agent top-up bookkeeping)
CREATE OR REPLACE FUNCTION public.clearing_credit_from_pool(
  p_to_sacco uuid,
  p_amount numeric,
  p_type text,
  p_reference text,
  p_idempotency_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pool uuid := '00000000-0000-4000-8000-000000000001'::uuid;
  v_existing uuid;
  v_txn uuid;
  v_pool_before numeric(20, 2);
  v_pool_after numeric(20, 2);
  v_to_before numeric(20, 2);
  v_to_after numeric(20, 2);
BEGIN
  IF p_to_sacco IS NULL THEN
    RAISE EXCEPTION 'to_sacco required';
  END IF;
  IF p_to_sacco = v_pool THEN
    RAISE EXCEPTION 'cannot credit pool with this RPC';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
    SELECT id INTO v_existing FROM public.transactions WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('duplicate', true, 'transaction_id', v_existing);
    END IF;
  END IF;

  SELECT id INTO v_existing FROM public.transactions WHERE reference = p_reference LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'reference already exists: %', p_reference;
  END IF;

  SELECT balance INTO v_pool_before FROM public.settlement_accounts WHERE sacco_id = v_pool FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'network pool settlement row missing — run bootstrap';
  END IF;

  SELECT balance INTO v_to_before FROM public.settlement_accounts WHERE sacco_id = p_to_sacco FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement account not found for sacco %', p_to_sacco;
  END IF;

  -- Pool ledger can go negative: represents fiat held at partner bank not yet mirrored.
  -- Enforce optionally in app layer before calling.
  v_pool_after := v_pool_before - p_amount;
  v_to_after := v_to_before + p_amount;

  INSERT INTO public.transactions (
    from_sacco_id, to_sacco_id, amount, type, status, reference, idempotency_key, metadata
  )
  VALUES (
    v_pool, p_to_sacco, p_amount, p_type, 'completed', p_reference, NULLIF(trim(p_idempotency_key), ''), COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_txn;

  INSERT INTO public.ledger_entries (transaction_id, sacco_id, debit, credit, balance_after)
  VALUES
    (v_txn, v_pool, p_amount, 0, v_pool_after),
    (v_txn, p_to_sacco, 0, p_amount, v_to_after);

  UPDATE public.settlement_accounts SET balance = v_pool_after, last_updated = now() WHERE sacco_id = v_pool;
  UPDATE public.settlement_accounts SET balance = v_to_after, last_updated = now() WHERE sacco_id = p_to_sacco;

  UPDATE public.sacco_shares
  SET transaction_volume_score = transaction_volume_score + p_amount, updated_at = now()
  WHERE sacco_id = p_to_sacco;

  RETURN jsonb_build_object(
    'duplicate', false,
    'transaction_id', v_txn,
    'pool_balance_after', v_pool_after,
    'to_balance_after', v_to_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.clearing_credit_from_pool(uuid, numeric, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clearing_credit_from_pool(uuid, numeric, text, text, text, jsonb) TO service_role;


-- ─── RLS ───────────────────────────────────────────────────────────────────────
-- Anon/authenticated roles have no grants here; reads/writes flow through boat-server (service_role) or Edge functions.
-- The operational BOAT apps use a different Supabase project (VITE_*), so JWT "authenticated" on this DB is unused
-- unless you configure a IdP/custom JWT on the clearing project. Do not reuse the anon key in browsers for clearing.
