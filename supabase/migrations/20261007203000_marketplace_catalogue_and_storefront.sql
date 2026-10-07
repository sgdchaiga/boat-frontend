-- A buyer may hide a catalogue item without changing the merchant's listing.
-- Preferences are account-specific so the choice remains after a new sign-in.
CREATE TABLE IF NOT EXISTS public.marketplace_customer_listing_preferences (
  customer_id uuid NOT NULL REFERENCES public.marketplace_customers(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_customer_listing_preferences_customer
  ON public.marketplace_customer_listing_preferences (customer_id, hidden_at DESC);

ALTER TABLE public.marketplace_customer_listing_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketplace_customer_listing_preferences_self
  ON public.marketplace_customer_listing_preferences
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.marketplace_customers customer
      WHERE customer.id = customer_id
        AND customer.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.marketplace_customers customer
      WHERE customer.id = customer_id
        AND customer.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_customer_listing_preferences TO authenticated;
