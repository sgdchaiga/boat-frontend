-- School fee structures may be published as marketplace payment requests.
-- They deliberately remain separate from student-ledger allocation until school staff match the learner.
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_listing_school_fee_source
  ON public.marketplace_listings (organization_id, source_module, source_record_id)
  WHERE source_module = 'school_fee_structure';

CREATE OR REPLACE FUNCTION public.marketplace_fee_structure_total(p_line_items jsonb)
RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(SUM(GREATEST(0, CASE
    WHEN COALESCE(item->>'amount', '') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (item->>'amount')::numeric
    ELSE 0 END)), 0)
  FROM jsonb_array_elements(COALESCE(p_line_items, '[]'::jsonb)) item
$$;

CREATE OR REPLACE FUNCTION public.marketplace_school_fee_listing_title(
  p_class_name text, p_stream text, p_academic_year text, p_term_name text
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(concat_ws(' ', NULLIF(p_class_name, ''), NULLIF(p_stream, ''), 'school fees', '—', NULLIF(p_academic_year, ''), NULLIF(p_term_name, '')))
$$;

CREATE OR REPLACE FUNCTION public.marketplace_sync_school_fee_listing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.marketplace_listings
    SET is_published = false
    WHERE organization_id = OLD.organization_id AND source_module = 'school_fee_structure' AND source_record_id = OLD.id::text;
    RETURN OLD;
  END IF;

  UPDATE public.marketplace_listings
  SET title = public.marketplace_school_fee_listing_title(NEW.class_name, NEW.stream, NEW.academic_year, NEW.term_name),
      description = 'School fee payment request. Provide the student admission or SchoolPay number so the school can allocate the payment.',
      price = public.marketplace_fee_structure_total(NEW.line_items),
      currency = NEW.currency,
      is_published = CASE WHEN NEW.is_active THEN is_published ELSE false END
  WHERE organization_id = NEW.organization_id AND source_module = 'school_fee_structure' AND source_record_id = NEW.id::text;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_marketplace_sync_school_fee_listing ON public.fee_structures;
CREATE TRIGGER trg_marketplace_sync_school_fee_listing
  AFTER UPDATE OF class_name, stream, academic_year, term_name, currency, line_items, is_active OR DELETE ON public.fee_structures
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_sync_school_fee_listing();
