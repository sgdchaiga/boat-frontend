-- School fee revenue recognition preference + manufacturing costing GL anchors.

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS school_accounting_basis text NOT NULL DEFAULT 'accrual'
    CHECK (school_accounting_basis IN ('accrual', 'cash'));

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS manufacturing_finished_goods_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manufacturing_wip_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.journal_gl_settings.school_accounting_basis IS
  'school: accrual posts fee revenue when invoices are issued; cash posts revenue only when school_payments are recorded.';
COMMENT ON COLUMN public.journal_gl_settings.manufacturing_finished_goods_gl_account_id IS
  'Manufacturing costing capitalization — debit (finished goods inventory).';
COMMENT ON COLUMN public.journal_gl_settings.manufacturing_wip_gl_account_id IS
  'Manufacturing costing capitalization — credit (WIP / production clearing).';
