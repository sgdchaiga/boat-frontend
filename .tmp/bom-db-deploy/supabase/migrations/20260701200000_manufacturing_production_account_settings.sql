-- Route production-entry consumables to expense and scrap value to inventory.

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS manufacturing_consumables_expense_gl_account_id uuid
    REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manufacturing_scrap_inventory_gl_account_id uuid
    REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.journal_gl_settings.manufacturing_consumables_expense_gl_account_id IS
  'Expense account debited for BOM items classified as consumables when a production entry is posted.';

COMMENT ON COLUMN public.journal_gl_settings.manufacturing_scrap_inventory_gl_account_id IS
  'Inventory asset account debited for the value of scrap metal recorded on a production entry.';

NOTIFY pgrst, 'reload schema';
