-- Preserve the selected subvote on Spend Money lines, independently of shared GLs.
ALTER TABLE public.expense_lines
  ADD COLUMN IF NOT EXISTS school_subvote_id uuid REFERENCES public.school_budget_subvotes(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS expense_lines_school_subvote ON public.expense_lines(school_subvote_id)
  WHERE school_subvote_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_expense_school_subvote() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.school_subvote_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.expenses e
      JOIN public.organizations o ON o.id=e.organization_id AND o.business_type='school'
      JOIN public.school_budget_subvotes s ON s.organization_id=e.organization_id
      JOIN public.school_budget_votes v ON v.id=s.vote_id AND v.organization_id=e.organization_id
      JOIN public.gl_accounts a ON a.id=NEW.expense_gl_account_id AND a.organization_id=e.organization_id
      WHERE e.id=NEW.expense_id AND s.id=NEW.school_subvote_id
    ) THEN RAISE EXCEPTION 'The expense, subvote, vote and GL account must belong to the same school'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_expense_school_subvote ON public.expense_lines;
CREATE TRIGGER validate_expense_school_subvote BEFORE INSERT OR UPDATE ON public.expense_lines
FOR EACH ROW EXECUTE FUNCTION public.validate_expense_school_subvote();
