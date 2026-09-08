-- Extend teller transaction types for vault ↔ till internal transfers (no member leg).
-- till_vault_in: cash from branch vault to teller till (increases working cash).
-- till_vault_out: cash from teller till back to vault (decreases working cash).

ALTER TABLE public.sacco_teller_transactions
  DROP CONSTRAINT IF EXISTS sacco_teller_transactions_txn_type_check;

ALTER TABLE public.sacco_teller_transactions
  ADD CONSTRAINT sacco_teller_transactions_txn_type_check
  CHECK (txn_type IN (
    'cash_deposit',
    'cash_withdrawal',
    'cheque_received',
    'cheque_paid',
    'cheque_clearing',
    'adjustment',
    'till_vault_in',
    'till_vault_out'
  ));
