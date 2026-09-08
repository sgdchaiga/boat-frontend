BEGIN;
-- School bursars may prepare, approve and post payroll. Include the existing
-- custom Assistant Bursar role without changing its identity or staff assignments.
CREATE OR REPLACE FUNCTION public.seed_school_bursar_payroll_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role_key IN ('bursar', 'assistant_bursar', 'assistant_bursar_com')
     AND EXISTS (SELECT 1 FROM public.organizations WHERE id = NEW.organization_id AND business_type = 'school') THEN
    INSERT INTO public.organization_permissions (organization_id, role_key, permission_key, allowed)
    SELECT NEW.organization_id, NEW.role_key, p, true
    FROM unnest(ARRAY['payroll_prepare', 'payroll_approve', 'payroll_post']) AS p
    ON CONFLICT (organization_id, role_key, permission_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.seed_school_bursar_payroll_role() FROM PUBLIC;
CREATE TRIGGER trg_seed_school_bursar_payroll_role
AFTER INSERT ON public.organization_role_types
FOR EACH ROW EXECUTE FUNCTION public.seed_school_bursar_payroll_role();

CREATE OR REPLACE FUNCTION public.seed_school_bursar_roles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.business_type = 'school' THEN
    INSERT INTO public.organization_role_types
      (organization_id, role_key, display_name, sort_order, can_edit_pos_orders, can_edit_cash_receipts)
    VALUES (NEW.id, 'bursar', 'Bursar', 60, false, false),
           (NEW.id, 'assistant_bursar', 'Assistant Bursar', 65, false, false)
    ON CONFLICT (organization_id, role_key) DO NOTHING;
    INSERT INTO public.organization_permissions (organization_id, role_key, permission_key, allowed)
    SELECT NEW.id, r, p, true
    FROM unnest(ARRAY['bursar', 'assistant_bursar', 'assistant_bursar_com']) AS r
    CROSS JOIN unnest(ARRAY['payroll_prepare', 'payroll_approve', 'payroll_post']) AS p
    ON CONFLICT (organization_id, role_key, permission_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.seed_school_bursar_roles() FROM PUBLIC;
CREATE TRIGGER trg_seed_school_bursar_roles
AFTER INSERT OR UPDATE OF business_type ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.seed_school_bursar_roles();

INSERT INTO public.organization_role_types
  (organization_id, role_key, display_name, sort_order, can_edit_pos_orders, can_edit_cash_receipts)
SELECT o.id, r.key, r.label, r.sort_order, false, false
FROM public.organizations o
CROSS JOIN (VALUES ('bursar', 'Bursar', 60), ('assistant_bursar', 'Assistant Bursar', 65)) AS r(key,label,sort_order)
WHERE o.business_type = 'school'
ON CONFLICT (organization_id, role_key) DO NOTHING;

INSERT INTO public.organization_permissions (organization_id, role_key, permission_key, allowed)
SELECT o.id, r, p, true FROM public.organizations o
CROSS JOIN unnest(ARRAY['bursar', 'assistant_bursar', 'assistant_bursar_com']) AS r
CROSS JOIN unnest(ARRAY['payroll_prepare', 'payroll_approve', 'payroll_post']) AS p
WHERE o.business_type = 'school'
ON CONFLICT (organization_id, role_key, permission_key) DO UPDATE SET allowed = true;

-- Fulfil the requested access for existing bursar users, including any earlier
-- per-user payroll denials. Other page and action overrides remain unchanged.
UPDATE public.staff_permission_overrides p SET allowed = true
FROM public.staff s, public.organizations o
WHERE s.id = p.staff_id AND s.organization_id = p.organization_id
  AND o.id = p.organization_id AND o.business_type = 'school'
  AND s.role IN ('bursar', 'assistant_bursar', 'assistant_bursar_com')
  AND (p.permission_key IN ('payroll_prepare', 'payroll_approve', 'payroll_post')
       OR p.permission_key LIKE 'page:payroll\_%' ESCAPE '\')
  AND NOT p.allowed;

DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM organizations o CROSS JOIN unnest(ARRAY['bursar','assistant_bursar','assistant_bursar_com']) r CROSS JOIN unnest(ARRAY['payroll_prepare','payroll_approve','payroll_post']) p WHERE o.business_type='school' AND NOT EXISTS (SELECT 1 FROM organization_permissions x WHERE x.organization_id=o.id AND x.role_key=r AND x.permission_key=p AND x.allowed)) THEN RAISE EXCEPTION 'Missing school payroll grants'; END IF;
END;
$$;
ROLLBACK;
