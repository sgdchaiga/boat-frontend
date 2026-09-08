ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS manufacturing_raw_materials_gl_account_id uuid
    REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manufacturing_wages_payable_gl_account_id uuid
    REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manufacturing_overhead_gl_account_id uuid
    REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.journal_gl_settings.manufacturing_raw_materials_gl_account_id IS
  'Manufacturing flow: credit account when raw materials are issued into WIP.';

COMMENT ON COLUMN public.journal_gl_settings.manufacturing_wages_payable_gl_account_id IS
  'Manufacturing flow: credit account when direct labour is applied into WIP.';

COMMENT ON COLUMN public.journal_gl_settings.manufacturing_overhead_gl_account_id IS
  'Manufacturing flow: credit account when factory overhead is allocated into WIP.';

NOTIFY pgrst, 'reload schema';
