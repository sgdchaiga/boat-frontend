-- Allocate school admission numbers per organization and calendar year.
-- The advisory lock serializes admissions for the same school/year, preventing duplicates.
CREATE OR REPLACE FUNCTION public.assign_school_admission_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_year text := to_char(current_date, 'YYYY');
  v_next integer;
BEGIN
  IF NULLIF(btrim(NEW.admission_number), '') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text || ':' || v_year, 0));

  SELECT COALESCE(MAX(substring(s.admission_number FROM 5 FOR 4)::integer), 0) + 1
    INTO v_next
  FROM public.students s
  WHERE s.organization_id = NEW.organization_id
    AND s.admission_number ~ ('^' || v_year || '[0-9]{4}$');

  IF v_next > 9999 THEN
    RAISE EXCEPTION 'Admission numbers for % have been exhausted', v_year;
  END IF;

  NEW.admission_number := v_year || lpad(v_next::text, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_assign_admission_number ON public.students;
CREATE TRIGGER students_assign_admission_number
BEFORE INSERT ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.assign_school_admission_number();
