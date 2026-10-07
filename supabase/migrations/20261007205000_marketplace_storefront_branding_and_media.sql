-- Branded, image-led merchant storefronts. Media is intentionally public because it is
-- customer-facing catalogue content; only an authorised merchant can upload or replace it.
ALTER TABLE public.marketplace_merchant_profiles
  ADD COLUMN IF NOT EXISTS logo_path text,
  ADD COLUMN IF NOT EXISTS banner_path text,
  ADD COLUMN IF NOT EXISTS accent_color text NOT NULL DEFAULT '#4f46e5',
  ADD COLUMN IF NOT EXISTS storefront_headline text,
  ADD COLUMN IF NOT EXISTS storefront_policy text;

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS image_path text,
  ADD COLUMN IF NOT EXISTS compare_at_price numeric(15,2),
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;

ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_compare_at_price_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_compare_at_price_check
  CHECK (compare_at_price IS NULL OR compare_at_price >= price);

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_featured
  ON public.marketplace_listings (merchant_id, is_featured DESC, created_at DESC)
  WHERE is_published = true;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'marketplace-storefront-media',
  'marketplace-storefront-media',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS marketplace_storefront_media_merchant_write ON storage.objects;
CREATE POLICY marketplace_storefront_media_merchant_write
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'marketplace-storefront-media'
    AND public.marketplace_org_access((storage.foldername(name))[1]::uuid)
  )
  WITH CHECK (
    bucket_id = 'marketplace-storefront-media'
    AND public.marketplace_org_access((storage.foldername(name))[1]::uuid)
  );
