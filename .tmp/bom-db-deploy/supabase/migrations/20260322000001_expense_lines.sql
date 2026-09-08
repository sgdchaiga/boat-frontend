-- Line items for expenses: per-row expense GL, source of funds (cash) GL, VAT, bank charges, comment

CREATE TABLE IF NOT EXISTS public.expense_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  expense_gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  source_cash_gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  amount numeric(15, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  bank_charges numeric(15, 2) NOT NULL DEFAULT 0 CHECK (bank_charges >= 0),
  vat_amount numeric(15, 2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  vat_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  bank_charges_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  comment text,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_expense_lines_expense ON public.expense_lines(expense_id);

ALTER TABLE public.expense_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense_lines_select_same_org" ON public.expense_lines;
DROP POLICY IF EXISTS "expense_lines_write_same_org" ON public.expense_lines;

CREATE POLICY "expense_lines_select_same_org"
  ON public.expense_lines FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      INNER JOIN public.staff s ON s.organization_id = e.organization_id AND s.id = auth.uid()
      WHERE e.id = expense_lines.expense_id
    )
  );

CREATE POLICY "expense_lines_write_same_org"
  ON public.expense_lines FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      INNER JOIN public.staff s ON s.organization_id = e.organization_id AND s.id = auth.uid()
      WHERE e.id = expense_lines.expense_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses e
      INNER JOIN public.staff s ON s.organization_id = e.organization_id AND s.id = auth.uid()
      WHERE e.id = expense_lines.expense_id
    )
  );
