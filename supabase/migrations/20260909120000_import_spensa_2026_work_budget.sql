-- Import the board work budget supplied for FY 2026 into the draft budget of
-- the organization currently used by george@spensa.com. The source document's
-- opening balance is retained in the budget notes (it is a resource, not income).
DO $$
DECLARE
  oid uuid;
  bid uuid;
  rec record;
  dept_id uuid;
  vote_id uuid;
  gl_id uuid;
BEGIN
  SELECT om.organization_id INTO oid
  FROM auth.users u
  JOIN public.user_active_organization uao ON uao.user_id = u.id
  JOIN public.organization_members om
    ON om.user_id = u.id
   AND om.organization_id = uao.organization_id
   AND om.is_active = true
  WHERE lower(u.email) = 'george@spensa.com'
  LIMIT 1;

  IF oid IS NULL THEN
    RAISE EXCEPTION 'Active organization for george@spensa.com was not found';
  END IF;

  PERFORM public.seed_school_vote_structure(oid);

  SELECT id INTO bid
  FROM public.budgets
  WHERE organization_id = oid AND financial_year = 2026 AND status = 'draft'
  ORDER BY created_at DESC
  LIMIT 1;

  IF bid IS NULL THEN
    INSERT INTO public.budgets(
      organization_id,name,period_label,start_date,end_date,notes,is_active,
      financial_year,status,version_no,period_mode
    ) VALUES (
      oid,'FY 2026 Work Budget','FY 2026','2026-01-01','2026-12-31',
      'Imported from Work Budget_2026.docx. Opening cash/bank balance UGX 1,215,293,517 is disclosed as a financing resource, not income.',
      true,2026,'draft',1,'annual'
    ) RETURNING id INTO bid;
  ELSE
    UPDATE public.budgets SET
      name = 'FY 2026 Work Budget',
      period_label = 'FY 2026', start_date = '2026-01-01', end_date = '2026-12-31',
      notes = 'Imported from Work Budget_2026.docx. Operating income UGX 9,632,375,060 plus opening cash/bank balance UGX 1,215,293,517 funds expenditure of UGX 10,847,668,577. The source detailed development subtotal contained an arithmetic error; item-level figures and the balanced final summary were used.',
      period_mode = 'annual', updated_at = now()
    WHERE id = bid;
    DELETE FROM public.budget_lines WHERE budget_id = bid;
  END IF;

  -- Income statement revenue lines. Opening balance is intentionally excluded.
  FOR rec IN SELECT * FROM (VALUES
    (10,'Tuition - O Level',3147477600::numeric,'4000'),
    (20,'Tuition - A Level',1209534900::numeric,'4000'),
    (30,'Admission Fees',66500000::numeric,'4300'),
    (40,'Other Charges',825202000::numeric,'4110'),
    (50,'Boarding Fees',2415769200::numeric,'4110'),
    (60,'Examination / UNEB Fees',178835000::numeric,'4200'),
    (70,'Rent - Lock-ups',18000000::numeric,'4300'),
    (80,'Bus Hire Income',6000000::numeric,'4300'),
    (90,'School Uniform Income',299015000::numeric,'4300'),
    (100,'Government Salaries Subvention',1211317596::numeric,'4400'),
    (110,'School Fees Recovery / Debtors',254723764::numeric,'4000')
  ) x(sort_order,label,amount,gl_code)
  LOOP
    SELECT id INTO gl_id FROM public.gl_accounts
      WHERE organization_id=oid AND account_code=rec.gl_code LIMIT 1;
    INSERT INTO public.budget_lines(
      budget_id,gl_account_id,line_label,budget_type,annual_other_amount,
      amount,sort_order,frequency,notes,assumptions
    ) VALUES (
      bid,gl_id,rec.label,'income',rec.amount,rec.amount,rec.sort_order,'annual',
      '2026 estimate imported from Work Budget_2026.docx','Board work budget 2026'
    );
  END LOOP;

  -- Expenditure votes, assigned to the seven departmental dimensions and GLs.
  FOR rec IN SELECT * FROM (VALUES
    ('01','Academics',220434750::numeric),('02','Administration',250595134::numeric),
    ('03','Administration',16850000::numeric),('04','Administration',79874500::numeric),
    ('05','Administration',267335000::numeric),('06','Academics',141525000::numeric),
    ('07','Administration',86870000::numeric),('08','Administration',2816917596::numeric),
    ('09','Kitchen',2128989229::numeric),('10','Administration',244970000::numeric),
    ('11','Academics',51000000::numeric),('12','Liturgy',38250000::numeric),
    ('13','Medical',61200000::numeric),('14','Administration',34000000::numeric),
    ('15','Estates',189975000::numeric),('16','Estates',191470000::numeric),
    ('17','Security',59623250::numeric),('18','Administration',791627500::numeric),
    ('19','Administration',215050000::numeric),('20','Academics',99192800::numeric),
    ('21','Academics',79000000::numeric),('22','Administration',299015000::numeric),
    ('23','Estates',141349401::numeric),('24','Estates',73250000::numeric),
    ('D1','Estates',35000000::numeric),('D2','Estates',1451269517::numeric),
    ('LR','Administration',306000000::numeric),('YC','Administration',477034900::numeric)
  ) x(vote_code,department_name,amount)
  LOOP
    SELECT d.id INTO dept_id FROM public.departments d
      WHERE d.organization_id=oid AND lower(d.name)=lower(rec.department_name) LIMIT 1;
    SELECT v.id,v.default_gl_account_id INTO vote_id,gl_id
      FROM public.school_budget_votes v
      WHERE v.organization_id=oid AND v.vote_code=rec.vote_code LIMIT 1;
    INSERT INTO public.budget_lines(
      budget_id,gl_account_id,department_id,vote_id,line_label,budget_type,
      annual_other_amount,amount,sort_order,frequency,notes,assumptions
    )
    SELECT bid,gl_id,dept_id,vote_id,v.vote_name,
      CASE WHEN v.budget_type IN ('financing','balance_sheet') THEN 'capital_expenditure' ELSE v.budget_type END,
      rec.amount,rec.amount,200 + row_number() OVER (), 'annual',
      '2026 vote estimate imported from Work Budget_2026.docx','Board work budget 2026'
    FROM public.school_budget_votes v WHERE v.id=vote_id;
  END LOOP;
END $$;
