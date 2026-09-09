-- User-authorized breakdown of the existing FY 2026 Vote 02 allocation.
DO $$
DECLARE
  oid uuid;
  parent public.budget_lines%ROWTYPE;
  sid uuid;
  rec record;
  total_before numeric;
BEGIN
  SELECT uao.organization_id INTO STRICT oid
  FROM auth.users u
  JOIN public.user_active_organization uao ON uao.user_id=u.id
  JOIN public.organization_members om ON om.user_id=u.id AND om.organization_id=uao.organization_id AND om.is_active
  WHERE lower(u.email)='george@spensa.com';

  SELECT l.* INTO STRICT parent FROM public.budget_lines l
  JOIN public.budgets b ON b.id=l.budget_id
  JOIN public.school_budget_votes v ON v.id=l.vote_id
  WHERE b.organization_id=oid AND b.financial_year=2026
    AND b.name='FY 2026 Work Budget' AND b.status='draft'
    AND v.organization_id=oid AND v.vote_code='02' AND l.parent_line_id IS NULL
  FOR UPDATE OF l;
  IF parent.amount<>250595134 OR EXISTS(SELECT 1 FROM public.budget_lines WHERE parent_line_id=parent.id) THEN
    RAISE EXCEPTION 'Vote 02 allocation changed or already has sub-lines; review before applying';
  END IF;
  SELECT sum(amount) INTO total_before FROM public.budget_lines WHERE budget_id=parent.budget_id AND parent_line_id IS NULL;

  FOR rec IN SELECT * FROM (VALUES
    (1,'i','Condolences',39950000::numeric,'Bereavement support to students, parents, staff, and BoG.'),
    (2,'ii','Entertainment',41850000::numeric,'DSTV, Women’s Day, staff parties, public address hire.'),
    (3,'iii','Air Time',5525000::numeric,'HT + 3 Dep. HTs + 2 DOS + Bursar monthly airtime × 12 months.'),
    (5,'v','Vehicle Hire & Tents',43065930::numeric,'Hired vehicles for trips; tents/chairs for orientations and celebrations.'),
    (6,'vi','Bank Charges',10854204::numeric,'Stanbic and Centenary Bank service charges.'),
    (7,'vii','Consultancy Fees',18700000::numeric,'External audit and professional advisory services.'),
    (8,'viii','Fines & Penalties',1700000::numeric,'Provision for regulatory fines.'),
    (9,'ix','Partner’s Visit',5950000::numeric,'Hosting institutional partners.'),
    (10,'x','Easter/X-Mas Package',36200000::numeric,'Seasonal packages for staff and students.'),
    (11,'xi','Legal Fees',12750000::numeric,'Legal counsel for land matters and institutional requirements.'),
    (12,'xii','Property Tax',700000::numeric,'NEW. Annual taxes on school rental lock-up units.'),
    (13,'xiii','Office Expenses',17100000::numeric,'NEW. Meetings and refreshments in the Headteacher’s office.'),
    (19,'xix','Travel',16250000::numeric,'Official meetings, study tours, and bench-marking visits.')
  ) x(seq,code,name,amount,note) LOOP
    sid:=NULL;
    IF (SELECT count(*) FROM public.school_budget_subvotes WHERE organization_id=oid AND vote_id=parent.vote_id AND lower(subvote_name)=lower(rec.name))>1 THEN
      RAISE EXCEPTION 'Multiple matching sub-votes for %',rec.name;
    END IF;
    SELECT id INTO sid FROM public.school_budget_subvotes
      WHERE organization_id=oid AND vote_id=parent.vote_id AND lower(subvote_name)=lower(rec.name);
    IF sid IS NULL THEN
      INSERT INTO public.school_budget_subvotes(organization_id,vote_id,subvote_code,subvote_name,default_gl_account_id)
      VALUES(oid,parent.vote_id,'02.'||rec.code,rec.name,parent.gl_account_id) RETURNING id INTO sid;
    ELSE
      UPDATE public.school_budget_subvotes SET subvote_code='02.'||rec.code,is_active=true WHERE id=sid;
    END IF;
    INSERT INTO public.budget_lines(budget_id,parent_line_id,gl_account_id,department_id,cost_centre_id,vote_id,subvote_id,
      fund_code,line_label,budget_type,annual_other_amount,amount,sort_order,frequency,notes,assumptions)
    VALUES(parent.budget_id,parent.id,parent.gl_account_id,parent.department_id,parent.cost_centre_id,parent.vote_id,sid,
      parent.fund_code,rec.name,parent.budget_type,rec.amount,rec.amount,rec.seq,'annual',rec.note,rec.note);
  END LOOP;
  IF (SELECT count(*) FROM public.budget_lines WHERE parent_line_id=parent.id)<>13
    OR (SELECT amount FROM public.budget_lines WHERE id=parent.id)<>250595134
    OR (SELECT sum(amount) FROM public.budget_lines WHERE budget_id=parent.budget_id AND parent_line_id IS NULL)<>total_before THEN
    RAISE EXCEPTION 'Vote 02 sub-vote reconciliation failed';
  END IF;
END $$;
