ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS manufacturing_finished_goods_gl_account_id uuid
    REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manufacturing_wip_gl_account_id uuid
    REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.journal_gl_settings.manufacturing_finished_goods_gl_account_id IS
  'Manufacturing costing capitalization debit account for finished goods inventory.';

COMMENT ON COLUMN public.journal_gl_settings.manufacturing_wip_gl_account_id IS
  'Manufacturing costing capitalization credit account for WIP or production clearing.';

NOTIFY pgrst, 'reload schema';
