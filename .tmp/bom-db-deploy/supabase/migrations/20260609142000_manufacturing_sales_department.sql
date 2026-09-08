INSERT INTO public.departments (organization_id, name)
SELECT o.id, 'Sales'
FROM public.organizations o
WHERE o.business_type = 'manufacturing'
  AND NOT EXISTS (
    SELECT 1
    FROM public.departments d
    WHERE d.organization_id = o.id
      AND lower(trim(d.name)) = 'sales'
  );

CREATE OR REPLACE FUNCTION public.seed_manufacturing_sales_department()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.business_type = 'manufacturing' THEN
    INSERT INTO public.departments (organization_id, name)
    SELECT NEW.id, 'Sales'
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.departments d
      WHERE d.organization_id = NEW.id
        AND lower(trim(d.name)) = 'sales'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_manufacturing_sales_department ON public.organizations;
CREATE TRIGGER trg_seed_manufacturing_sales_department
AFTER INSERT OR UPDATE OF business_type ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.seed_manufacturing_sales_department();
