-- Per-department POS sales revenue (bar / kitchen / room). Falls back to revenue_gl_account_id in app when null.

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS pos_revenue_bar_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_revenue_kitchen_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_revenue_room_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.journal_gl_settings.pos_revenue_bar_gl_account_id IS
  'Hotel POS: credit account for bar-department sales (defaults to revenue_gl_account_id when null).';
COMMENT ON COLUMN public.journal_gl_settings.pos_revenue_kitchen_gl_account_id IS
  'Hotel POS: credit account for kitchen/F&B sales (defaults to revenue_gl_account_id when null).';
COMMENT ON COLUMN public.journal_gl_settings.pos_revenue_room_gl_account_id IS
  'Hotel POS: credit account for room/minibar sales (defaults to revenue_gl_account_id when null).';
