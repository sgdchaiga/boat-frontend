ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS school_vote_id uuid REFERENCES public.school_budget_votes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS school_subvote_id uuid REFERENCES public.school_budget_subvotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_school_subvote
  ON public.products (organization_id, school_subvote_id)
  WHERE school_subvote_id IS NOT NULL;
