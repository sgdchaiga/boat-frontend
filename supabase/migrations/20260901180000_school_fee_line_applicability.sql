-- Day/boarding-aware fee lines and immutable invoice charge snapshots.
ALTER TABLE public.student_invoices
  ADD COLUMN IF NOT EXISTS line_items jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.student_invoices.line_items IS
  'Snapshot of fee lines actually applied when the invoice was generated.';

CREATE OR REPLACE FUNCTION public.normalize_school_fee_line_items(p_lines jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_set(
      jsonb_set(elem.item,'{priority}',to_jsonb(GREATEST(1,CASE WHEN COALESCE(elem.item->>'priority','') ~ '^[0-9]+$' THEN (elem.item->>'priority')::integer ELSE elem.ord::integer END)),true),
      '{applies_to}',
      to_jsonb(CASE
        WHEN lower(COALESCE(elem.item->>'applies_to','')) IN ('all','day','boarding') THEN lower(elem.item->>'applies_to')
        WHEN upper(COALESCE(elem.item->>'code','')) IN ('BOARD','BOARDING') THEN 'boarding'
        ELSE 'all' END),true)
    ORDER BY elem.ord),'[]'::jsonb)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(COALESCE(p_lines,'[]'::jsonb))='array' THEN COALESCE(p_lines,'[]'::jsonb) ELSE '[]'::jsonb END)
    WITH ORDINALITY AS elem(item,ord);
$$;

UPDATE public.fee_structures SET line_items=public.normalize_school_fee_line_items(line_items);

CREATE OR REPLACE FUNCTION public.validate_student_invoice_line_items()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE line jsonb; calculated numeric:=0;
BEGIN
  IF jsonb_typeof(NEW.line_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invoice line_items must be an array'; END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(NEW.line_items) LOOP
    IF COALESCE((line->>'amount')::numeric,0)<0 THEN RAISE EXCEPTION 'Invoice line amounts cannot be negative'; END IF;
    calculated:=calculated+COALESCE((line->>'amount')::numeric,0);
  END LOOP;
  IF jsonb_array_length(NEW.line_items)>0 AND abs(calculated-NEW.subtotal)>0.01 THEN
    RAISE EXCEPTION 'Invoice subtotal must equal the applied fee lines';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_validate_student_invoice_line_items ON public.student_invoices;
CREATE TRIGGER trg_validate_student_invoice_line_items BEFORE INSERT OR UPDATE OF line_items,subtotal
ON public.student_invoices FOR EACH ROW EXECUTE FUNCTION public.validate_student_invoice_line_items();

