-- POS journal: receipt accounts (bank / mobile money) + per-channel COGS / inventory.
-- Payments: allow mobile_money alongside cash / card / bank_transfer.

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS pos_bank_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_mobile_money_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_cogs_bar_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_inventory_bar_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_cogs_kitchen_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_inventory_kitchen_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_cogs_room_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_inventory_room_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;

ALTER TABLE public.payments ADD CONSTRAINT payments_payment_method_check
  CHECK (payment_method IN ('cash', 'card', 'bank_transfer', 'mobile_money'));
