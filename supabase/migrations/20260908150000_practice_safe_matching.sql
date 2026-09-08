-- Atomic, source-scoped practice matching. Invoker security preserves existing RLS.
ALTER TABLE public.practice_reconciliation_lines ADD COLUMN IF NOT EXISTS account_key text;
ALTER TABLE public.practice_reconciliation_lines ADD COLUMN IF NOT EXISTS currency text;
CREATE OR REPLACE FUNCTION public.practice_save_matches(
  p_client_id uuid, p_period_start date, p_period_end date,
  p_cashbook_source text, p_statement_source text, p_groups jsonb,
  p_snapshot jsonb, p_method text DEFAULT 'auto', p_notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_org uuid; v_run uuid; v_group jsonb; v_ids uuid[]; v_all uuid[];
  v_actual jsonb; v_count integer; v_cash integer; v_bank integer; v_difference numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_start > p_period_end
     OR p_method IS NULL OR p_method NOT IN ('auto','manual') OR coalesce(jsonb_array_length(p_groups),0) = 0 THEN
    RAISE EXCEPTION 'Invalid reconciliation request';
  END IF;
  SELECT organization_id INTO STRICT v_org FROM practice_clients WHERE id = p_client_id FOR UPDATE;
  SELECT array_agg(e.id::uuid) INTO v_all
    FROM jsonb_array_elements(p_groups) g(data) CROSS JOIN LATERAL jsonb_array_elements_text(g.data->'ids') e(id);
  IF cardinality(v_all) IS DISTINCT FROM (SELECT count(DISTINCT x) FROM unnest(v_all) x) THEN
    RAISE EXCEPTION 'A transaction cannot be used twice';
  END IF;
  PERFORM id FROM practice_reconciliation_lines WHERE id = ANY(v_all) ORDER BY id FOR UPDATE;
  SELECT jsonb_agg(jsonb_build_object('id',id,'side',side,'line_date',line_date,
    'amount',amount,'reference',reference,'description',description,'account_key',account_key,'currency',currency) ORDER BY id)
    INTO v_actual FROM practice_reconciliation_lines
    WHERE id = ANY(v_all) AND client_id = p_client_id AND organization_id = v_org
      AND match_group_id IS NULL AND reconciliation_run_id IS NULL
      AND line_date BETWEEN p_period_start AND p_period_end
      AND source_file = CASE side WHEN 'cashbook' THEN p_cashbook_source ELSE p_statement_source END;
  IF v_actual IS DISTINCT FROM (SELECT jsonb_agg(x ORDER BY x->>'id') FROM jsonb_array_elements(p_snapshot) x)
     OR jsonb_array_length(v_actual) IS DISTINCT FROM cardinality(v_all) THEN
    RAISE EXCEPTION 'Transactions changed or are outside the selected sources. Refresh and preview again.';
  END IF;
  IF EXISTS(SELECT 1 FROM practice_reconciliation_lines WHERE id=ANY(v_all)
      AND (coalesce(trim(account_key),'')='' OR currency IS NULL OR currency !~ '^[A-Z]{3}$'))
    OR (SELECT count(DISTINCT (account_key,currency)) FROM practice_reconciliation_lines WHERE id=ANY(v_all)) <> 1 THEN
    RAISE EXCEPTION 'All selected transactions must belong to the same confirmed account and currency';
  END IF;
  INSERT INTO practice_reconciliation_runs(organization_id,client_id,period_start,period_end,method,side_mode,notes,reconciled_by)
    VALUES(v_org,p_client_id,p_period_start,p_period_end,p_method,'both',concat_ws(' · ',p_cashbook_source,p_statement_source,p_notes),auth.uid()) RETURNING id INTO v_run;
  FOR v_group IN SELECT value FROM jsonb_array_elements(p_groups) LOOP
    SELECT array_agg(value::uuid) INTO v_ids FROM jsonb_array_elements_text(v_group->'ids');
    SELECT count(*), count(*) FILTER(WHERE side='cashbook'), count(*) FILTER(WHERE side='statement'),
      sum(CASE side WHEN 'cashbook' THEN amount ELSE -amount END)
      INTO v_count,v_cash,v_bank,v_difference FROM practice_reconciliation_lines WHERE id=ANY(v_ids);
    IF v_count <> cardinality(v_ids) OR v_cash=0 OR v_bank=0 OR v_difference <> 0 THEN
      RAISE EXCEPTION 'Each match requires both sides with exactly equal totals';
    END IF;
    -- One UUID for the whole group, rather than one per row.
    WITH match_id AS MATERIALIZED (SELECT gen_random_uuid() AS id)
    UPDATE practice_reconciliation_lines SET match_group_id=match_id.id, reconciliation_run_id=v_run
      FROM match_id WHERE practice_reconciliation_lines.id=ANY(v_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> cardinality(v_ids) THEN RAISE EXCEPTION 'Not all selected transactions could be saved'; END IF;
  END LOOP;
  DELETE FROM practice_reconciliation_drafts WHERE client_id=p_client_id AND saved_by=auth.uid();
  RETURN v_run;
END $$;
REVOKE ALL ON FUNCTION public.practice_save_matches(uuid,date,date,text,text,jsonb,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.practice_save_matches(uuid,date,date,text,text,jsonb,jsonb,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.practice_import_lines(p_client_id uuid, p_side text, p_source text, p_rows jsonb, p_account_key text, p_currency text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_org uuid; v_incoming jsonb; v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_side IS NULL OR p_side NOT IN ('cashbook','statement') OR coalesce(trim(p_source),'')='' OR coalesce(jsonb_array_length(p_rows),0)=0
    OR coalesce(trim(p_account_key),'')='' OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Invalid import';
  END IF;
  SELECT organization_id INTO STRICT v_org FROM practice_clients WHERE id=p_client_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM practice_reconciliation_lines WHERE client_id=p_client_id AND side=p_side AND source_file=p_source) THEN
    RAISE EXCEPTION 'This source name already exists. Review existing imports before importing again.';
  END IF;
  SELECT jsonb_agg(jsonb_build_array(r.line_date,r.amount,coalesce(r.reference,''),coalesce(r.description,''))
    ORDER BY r.line_date,r.amount,coalesce(r.reference,''),coalesce(r.description,'')) INTO v_incoming
    FROM jsonb_to_recordset(p_rows) AS r(line_date date,amount numeric,reference text,description text);
  IF EXISTS(SELECT 1 FROM practice_reconciliation_lines WHERE client_id=p_client_id AND side=p_side
    GROUP BY source_file HAVING jsonb_agg(jsonb_build_array(line_date,amount,coalesce(reference,''),coalesce(description,''))
      ORDER BY line_date,amount,coalesce(reference,''),coalesce(description,''))=v_incoming) THEN
    RAISE EXCEPTION 'These transactions were already imported under another filename.';
  END IF;
  INSERT INTO practice_reconciliation_lines(organization_id,client_id,side,line_date,description,reference,amount,source_file,imported_by,account_key,currency)
    SELECT v_org,p_client_id,p_side,r.line_date,coalesce(r.description,''),r.reference,r.amount,p_source,auth.uid(),trim(p_account_key),p_currency
    FROM jsonb_to_recordset(p_rows) AS r(line_date date,amount numeric,reference text,description text);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.practice_import_lines(uuid,text,text,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.practice_import_lines(uuid,text,text,jsonb,text,text) TO authenticated;

-- Explicitly label legacy imports; existing confirmed scopes cannot be silently overwritten.
CREATE OR REPLACE FUNCTION public.practice_label_sources(p_client_id uuid,p_cashbook_source text,p_statement_source text,p_account_key text,p_currency text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR coalesce(trim(p_account_key),'')='' OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Provide an account identifier and three-letter currency';
  END IF;
  PERFORM id FROM practice_clients WHERE id=p_client_id FOR UPDATE;
  PERFORM id FROM practice_reconciliation_lines WHERE client_id=p_client_id
    AND source_file=CASE side WHEN 'cashbook' THEN p_cashbook_source ELSE p_statement_source END ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM practice_reconciliation_lines WHERE client_id=p_client_id
    AND source_file=CASE side WHEN 'cashbook' THEN p_cashbook_source ELSE p_statement_source END
    AND ((account_key IS NOT NULL AND account_key<>trim(p_account_key)) OR (currency IS NOT NULL AND currency<>p_currency))) THEN
    RAISE EXCEPTION 'A selected source already belongs to a different account or currency';
  END IF;
  UPDATE practice_reconciliation_lines SET account_key=trim(p_account_key),currency=p_currency WHERE client_id=p_client_id
    AND source_file=CASE side WHEN 'cashbook' THEN p_cashbook_source ELSE p_statement_source END;
END $$;
REVOKE ALL ON FUNCTION public.practice_label_sources(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.practice_label_sources(uuid,text,text,text,text) TO authenticated;
