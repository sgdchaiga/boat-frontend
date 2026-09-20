-- Controlled school vote/sub-vote and GL-account master data.

CREATE OR REPLACE FUNCTION public.caller_can_manage_school_finance(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid() AND s.organization_id = p_org_id
        AND lower(coalesce(s.role,'')) IN ('admin','owner','super_admin','manager','accountant')
    );
$$;

CREATE OR REPLACE FUNCTION public.validate_school_vote_dimensions()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE parent_org uuid; mapped_org uuid;
BEGIN
  IF TG_TABLE_NAME = 'school_budget_votes' THEN
    IF NEW.default_department_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM departments WHERE id=NEW.default_department_id AND organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Vote department must belong to this organization'; END IF;
    IF NEW.default_gl_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM gl_accounts WHERE id=NEW.default_gl_account_id AND organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Vote GL account must belong to this organization'; END IF;
  ELSIF TG_TABLE_NAME = 'school_budget_subvotes' THEN
    SELECT organization_id INTO parent_org FROM school_budget_votes WHERE id=NEW.vote_id;
    IF parent_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'Subvote must belong to a vote in the same organization'; END IF;
    IF NEW.default_cost_centre_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM school_cost_centres WHERE id=NEW.default_cost_centre_id AND organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Subvote cost centre must belong to this organization'; END IF;
    IF NEW.default_gl_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM gl_accounts WHERE id=NEW.default_gl_account_id AND organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Subvote GL account must belong to this organization'; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_school_budget_vote_dimensions ON public.school_budget_votes;
CREATE TRIGGER trg_validate_school_budget_vote_dimensions BEFORE INSERT OR UPDATE ON public.school_budget_votes FOR EACH ROW EXECUTE FUNCTION public.validate_school_vote_dimensions();
DROP TRIGGER IF EXISTS trg_validate_school_budget_subvote_dimensions ON public.school_budget_subvotes;
CREATE TRIGGER trg_validate_school_budget_subvote_dimensions BEFORE INSERT OR UPDATE ON public.school_budget_subvotes FOR EACH ROW EXECUTE FUNCTION public.validate_school_vote_dimensions();

CREATE OR REPLACE FUNCTION public.validate_gl_account_hierarchy()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE parent_row public.gl_accounts%ROWTYPE;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'An account cannot be its own parent'; END IF;
  SELECT * INTO parent_row FROM gl_accounts WHERE id=NEW.parent_id;
  IF NOT FOUND OR parent_row.organization_id IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'Parent account must belong to this organization'; END IF;
  IF NOT parent_row.is_active THEN RAISE EXCEPTION 'Parent account must be active'; END IF;
  IF parent_row.account_type IS DISTINCT FROM NEW.account_type THEN RAISE EXCEPTION 'Parent and child accounts must have the same account type'; END IF;
  IF EXISTS (WITH RECURSIVE descendants AS (SELECT id,parent_id FROM gl_accounts WHERE parent_id=NEW.id UNION ALL SELECT a.id,a.parent_id FROM gl_accounts a JOIN descendants d ON a.parent_id=d.id) SELECT 1 FROM descendants WHERE id=NEW.parent_id) THEN RAISE EXCEPTION 'Account hierarchy cannot contain a cycle'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_validate_gl_account_hierarchy ON public.gl_accounts;
CREATE TRIGGER trg_validate_gl_account_hierarchy BEFORE INSERT OR UPDATE OF parent_id,organization_id,account_type ON public.gl_accounts FOR EACH ROW EXECUTE FUNCTION public.validate_gl_account_hierarchy();

-- Master-data writes are intentionally restricted to school finance administrators.
DROP POLICY IF EXISTS "org_gl_accounts_write" ON public.gl_accounts;
CREATE POLICY "org_gl_accounts_write" ON public.gl_accounts FOR ALL TO authenticated
  USING (public.caller_can_manage_school_finance(organization_id))
  WITH CHECK (public.caller_can_manage_school_finance(organization_id));
DROP POLICY IF EXISTS school_budget_votes_org ON public.school_budget_votes;
CREATE POLICY school_budget_votes_org ON public.school_budget_votes FOR SELECT TO authenticated
  USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY school_budget_votes_write ON public.school_budget_votes FOR ALL TO authenticated
  USING (public.caller_can_manage_school_finance(organization_id))
  WITH CHECK (public.caller_can_manage_school_finance(organization_id));
DROP POLICY IF EXISTS school_budget_subvotes_org ON public.school_budget_subvotes;
CREATE POLICY school_budget_subvotes_org ON public.school_budget_subvotes FOR SELECT TO authenticated
  USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY school_budget_subvotes_write ON public.school_budget_subvotes FOR ALL TO authenticated
  USING (public.caller_can_manage_school_finance(organization_id))
  WITH CHECK (public.caller_can_manage_school_finance(organization_id));
