ALTER TABLE public.practice_stock_take_items
  ADD COLUMN IF NOT EXISTS department text;
