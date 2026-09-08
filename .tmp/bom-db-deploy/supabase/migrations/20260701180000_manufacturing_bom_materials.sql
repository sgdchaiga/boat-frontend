-- Bring the BOM schema in line with the BOM builder.

ALTER TABLE public.manufacturing_boms
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS materials jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.manufacturing_boms
  DROP CONSTRAINT IF EXISTS manufacturing_boms_materials_array_check;

ALTER TABLE public.manufacturing_boms
  ADD CONSTRAINT manufacturing_boms_materials_array_check
  CHECK (jsonb_typeof(materials) = 'array');

UPDATE public.manufacturing_boms bom
SET product_id = product.id
FROM public.products product
WHERE bom.product_id IS NULL
  AND product.organization_id = bom.organization_id
  AND lower(trim(product.name)) = lower(trim(bom.product_name));

UPDATE public.manufacturing_boms
SET materials_count = jsonb_array_length(materials);

CREATE INDEX IF NOT EXISTS idx_manufacturing_boms_org_product
  ON public.manufacturing_boms (organization_id, product_id, updated_at DESC);

COMMENT ON COLUMN public.manufacturing_boms.product_id IS 'Finished product defined by this bill of materials.';
COMMENT ON COLUMN public.manufacturing_boms.materials IS 'Raw-material and consumable rows used by the BOM builder.';
