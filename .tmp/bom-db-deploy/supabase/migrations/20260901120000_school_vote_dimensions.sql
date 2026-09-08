-- School vote budgeting dimensions: responsibility (department/cost centre),
-- authority (vote/sub-vote), financial reporting (GL) and optional fund/project.

ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS department_code text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_departments_org_code
  ON public.departments(organization_id, department_code) WHERE department_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.school_cost_centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  centre_code text NOT NULL,
  centre_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, centre_code)
);

CREATE TABLE IF NOT EXISTS public.school_budget_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vote_code text NOT NULL,
  vote_name text NOT NULL,
  budget_type text NOT NULL DEFAULT 'operating_expense'
    CHECK (budget_type IN ('income','operating_expense','staff_cost','capital_expenditure','financing','balance_sheet')),
  default_department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  default_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, vote_code)
);

CREATE TABLE IF NOT EXISTS public.school_budget_subvotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vote_id uuid NOT NULL REFERENCES public.school_budget_votes(id) ON DELETE CASCADE,
  subvote_code text NOT NULL,
  subvote_name text NOT NULL,
  default_cost_centre_id uuid REFERENCES public.school_cost_centres(id) ON DELETE SET NULL,
  default_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, subvote_code)
);

ALTER TABLE public.budget_lines
  ADD COLUMN IF NOT EXISTS vote_id uuid REFERENCES public.school_budget_votes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subvote_id uuid REFERENCES public.school_budget_subvotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_centre_id uuid REFERENCES public.school_cost_centres(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fund_code text NOT NULL DEFAULT 'SCHOOL_FUNDS',
  ADD COLUMN IF NOT EXISTS project_code text;

CREATE INDEX IF NOT EXISTS idx_budget_lines_dimensions
  ON public.budget_lines(budget_id,department_id,cost_centre_id,vote_id,subvote_id,gl_account_id);

ALTER TABLE public.school_expense_budget_requests
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_centre_id uuid REFERENCES public.school_cost_centres(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_code text;

CREATE OR REPLACE FUNCTION public.enrich_school_budget_request_dimensions()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE l public.budget_lines%ROWTYPE;
BEGIN
  SELECT * INTO l FROM public.budget_lines WHERE id=NEW.budget_line_id;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Budget line not found'; END IF;
  NEW.department_id:=COALESCE(NEW.department_id,l.department_id);
  NEW.cost_centre_id:=COALESCE(NEW.cost_centre_id,l.cost_centre_id);
  NEW.gl_account_id:=COALESCE(NEW.gl_account_id,l.gl_account_id);
  NEW.project_code:=COALESCE(NEW.project_code,l.project_code);
  IF NEW.gl_account_id IS NULL THEN RAISE EXCEPTION 'The selected vote must be linked to a GL account before spending'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_enrich_school_budget_request_dimensions ON public.school_expense_budget_requests;
CREATE TRIGGER trg_enrich_school_budget_request_dimensions BEFORE INSERT OR UPDATE OF budget_line_id
ON public.school_expense_budget_requests FOR EACH ROW EXECUTE FUNCTION public.enrich_school_budget_request_dimensions();

-- Organization isolation.
ALTER TABLE public.school_cost_centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_budget_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_budget_subvotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_cost_centres_org ON public.school_cost_centres FOR ALL TO authenticated
  USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()))
  WITH CHECK (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY school_budget_votes_org ON public.school_budget_votes FOR ALL TO authenticated
  USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()))
  WITH CHECK (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY school_budget_subvotes_org ON public.school_budget_subvotes FOR ALL TO authenticated
  USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()))
  WITH CHECK (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.school_cost_centres,public.school_budget_votes,public.school_budget_subvotes TO authenticated;

CREATE OR REPLACE FUNCTION public.seed_school_vote_structure(p_organization_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND p_organization_id IS DISTINCT FROM (SELECT organization_id FROM public.staff WHERE id=auth.uid())
     AND NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Organization access denied'; END IF;

  INSERT INTO public.departments(organization_id,name,department_code)
  SELECT p_organization_id,x.name,x.code FROM (VALUES
    ('D01','Academics'),('D02','Administration'),('D03','Kitchen'),('D04','Medical'),
    ('D05','Liturgy'),('D06','Estates'),('D07','Security')) x(code,name)
  WHERE NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.organization_id=p_organization_id AND lower(d.name)=lower(x.name));
  UPDATE public.departments d SET department_code=x.code FROM (VALUES
    ('D01','Academics'),('D02','Administration'),('D03','Kitchen'),('D04','Medical'),
    ('D05','Liturgy'),('D06','Estates'),('D07','Security')) x(code,name)
  WHERE d.organization_id=p_organization_id AND lower(d.name)=lower(x.name) AND d.department_code IS NULL;

  INSERT INTO public.school_cost_centres(organization_id,department_id,centre_code,centre_name)
  SELECT p_organization_id,d.id,x.code,x.centre FROM (VALUES
    ('D01','CC-A01','Teaching departments'),('D01','CC-A02','Examinations'),('D01','CC-A03','Library'),('D01','CC-A04','Co-curricular'),
    ('D02','CC-B01','Headteacher office'),('D02','CC-B02','Finance and accounts'),('D02','CC-B03','Human resources'),('D02','CC-B04','Procurement'),('D02','CC-B05','ICT'),
    ('D03','CC-K01','Main kitchen'),('D04','CC-M01','School clinic'),('D05','CC-L01','Chaplaincy'),
    ('D06','CC-E01','Maintenance'),('D06','CC-E02','Sanitation'),('D06','CC-E03','Transport'),('D06','CC-E04','Capital projects'),
    ('D07','CC-S01','School security')) x(dept,code,centre)
  JOIN public.departments d ON d.organization_id=p_organization_id AND d.department_code=x.dept
  ON CONFLICT(organization_id,centre_code) DO NOTHING;

  -- Financial-statement accounts. Existing accounts and history are preserved.
  INSERT INTO public.gl_accounts(organization_id,business_type,account_code,account_name,account_type,category,is_active)
  SELECT p_organization_id,'school',x.code,x.name,x.type,x.category,true FROM (VALUES
    ('4000','Tuition income','income','revenue'),('4110','Boarding and student service income','income','revenue'),
    ('4200','Examination and delegated income','income','revenue'),('4300','Uniform and other income','income','other'),
    ('4400','Government grants and subventions','income','revenue'),('5000','Academic and teaching costs','expense','expense'),
    ('5100','Employee costs','expense','expense'),('5200','Administration and governance','expense','expense'),
    ('5300','Student welfare and boarding','expense','expense'),('5400','ICT and communications','expense','expense'),
    ('5500','Premises, sanitation and utilities','expense','expense'),('5600','Transport costs','expense','expense'),
    ('5700','Co-curricular and public relations','expense','expense'),('5800','General operating expenses','expense','expense'),
    ('5900','Finance costs','expense','expense'),('1500','School property and equipment','asset','other'),
    ('1700','Capital work in progress','asset','other'),('2100','Trade and other payables','liability','payable'),
    ('2300','Loans payable','liability','payable')) x(code,name,type,category)
  ON CONFLICT DO NOTHING;

  -- Department inventory control accounts keep stores on the balance sheet;
  -- the paired issue/consumption accounts feed departmental income statements.
  INSERT INTO public.gl_accounts(organization_id,business_type,account_code,account_name,account_type,category,parent_id,is_active)
  SELECT p_organization_id,'school',x.code,x.name,x.type,x.category,parent.id,true
  FROM (VALUES
    ('1171','Academics Inventory','asset','inventory','1170'),
    ('1172','Administration Inventory','asset','inventory','1170'),
    ('1173','Kitchen Inventory','asset','inventory','1170'),
    ('1174','Medical Inventory','asset','inventory','1170'),
    ('1175','Liturgy Inventory','asset','inventory','1170'),
    ('1176','Estates Inventory','asset','inventory','1170'),
    ('1177','Security Inventory','asset','inventory','1170'),
    ('5111','Academics Inventory Consumption','expense','expense','5110'),
    ('6201','Administration Inventory Consumption','expense','expense','6200'),
    ('5171','Kitchen Inventory Consumption','expense','expense','5170'),
    ('5181','Medical Inventory Consumption','expense','expense','5180'),
    ('5191','Liturgy Inventory Consumption','expense','expense','5000'),
    ('6401','Estates Inventory Consumption','expense','expense','6400'),
    ('6341','Security Inventory Consumption','expense','expense','6340')) x(code,name,type,category,parent_code)
  LEFT JOIN public.gl_accounts parent ON parent.organization_id=p_organization_id AND parent.account_code=x.parent_code
  ON CONFLICT DO NOTHING;

  UPDATE public.gl_accounts account SET
    account_name=x.name,account_type=x.type,category=x.category,
    parent_id=COALESCE(parent.id,account.parent_id),business_type='school',is_active=true
  FROM (VALUES
    ('1171','Academics Inventory','asset','inventory','1170'),('1172','Administration Inventory','asset','inventory','1170'),
    ('1173','Kitchen Inventory','asset','inventory','1170'),('1174','Medical Inventory','asset','inventory','1170'),
    ('1175','Liturgy Inventory','asset','inventory','1170'),('1176','Estates Inventory','asset','inventory','1170'),
    ('1177','Security Inventory','asset','inventory','1170'),('5111','Academics Inventory Consumption','expense','expense','5110'),
    ('6201','Administration Inventory Consumption','expense','expense','6200'),('5171','Kitchen Inventory Consumption','expense','expense','5170'),
    ('5181','Medical Inventory Consumption','expense','expense','5180'),('5191','Liturgy Inventory Consumption','expense','expense','5000'),
    ('6401','Estates Inventory Consumption','expense','expense','6400'),('6341','Security Inventory Consumption','expense','expense','6340')) x(code,name,type,category,parent_code)
  LEFT JOIN public.gl_accounts parent ON parent.organization_id=p_organization_id AND parent.account_code=x.parent_code
  WHERE account.organization_id=p_organization_id AND account.account_code=x.code;

  INSERT INTO public.journal_gl_department_settings(
    organization_id,department_id,purchases_gl_account_id,stock_gl_account_id
  )
  SELECT p_organization_id,d.id,expense_account.id,inventory_account.id
  FROM (VALUES
    ('D01','1171','5111'),('D02','1172','6201'),('D03','1173','5171'),
    ('D04','1174','5181'),('D05','1175','5191'),('D06','1176','6401'),('D07','1177','6341')) x(dept,stock_code,expense_code)
  JOIN public.departments d ON d.organization_id=p_organization_id AND d.department_code=x.dept
  JOIN public.gl_accounts inventory_account ON inventory_account.organization_id=p_organization_id AND inventory_account.account_code=x.stock_code
  JOIN public.gl_accounts expense_account ON expense_account.organization_id=p_organization_id AND expense_account.account_code=x.expense_code
  ON CONFLICT(organization_id,department_id) DO UPDATE SET
    stock_gl_account_id=excluded.stock_gl_account_id,
    purchases_gl_account_id=excluded.purchases_gl_account_id;

  INSERT INTO public.school_budget_votes(organization_id,vote_code,vote_name,budget_type,default_department_id,default_gl_account_id)
  SELECT p_organization_id,x.code,x.name,x.kind,d.id,g.id FROM (VALUES
    ('01','Academic Programmes','operating_expense','D01','5000'),('02','Administrative Expenses','operating_expense','D02','5200'),
    ('03','Subscriptions & Digital Services','operating_expense','D02','5400'),('04','Governance Expenses','operating_expense','D02','5200'),
    ('05','Delegated Funds','operating_expense','D02','5000'),('06','Departmental Materials','operating_expense','D01','5000'),
    ('07','ICT','operating_expense','D02','5400'),('08','Salaries, Wages & Allowances','staff_cost','D02','5100'),
    ('09','Kitchen Expenses','operating_expense','D03','5300'),('10','General Expenses','operating_expense','D02','5800'),
    ('11','Library / Text Books','operating_expense','D01','5000'),('12','Liturgy & Religious Activities','operating_expense','D05','5300'),
    ('13','Medical & Health','operating_expense','D04','5300'),('14','NSSF — Other Staff Costs','staff_cost','D02','5100'),
    ('15','Plant Maintenance','operating_expense','D06','5500'),('16','Sanitation & Hygiene','operating_expense','D06','5500'),
    ('17','Security','operating_expense','D07','5500'),('18','Staff Welfare','operating_expense','D02','5100'),
    ('19','Stationery','operating_expense','D02','5800'),('20','Co-Curricular Activities','operating_expense','D01','5700'),
    ('21','Success Party / Scholarships','operating_expense','D01','5300'),('22','School Uniform','operating_expense','D02','5300'),
    ('23','Utilities','operating_expense','D06','5500'),('24','Vehicle Running Costs','operating_expense','D06','5600'),
    ('D1','Capital Development','capital_expenditure','D06','1700'),('D2','Squatter Compensation','capital_expenditure','D06','1700'),
    ('LR','Loan Repayment','financing','D02','2300'),('YC','Year-End Creditors','balance_sheet','D02','2100')) x(code,name,kind,dept,gl)
  JOIN public.departments d ON d.organization_id=p_organization_id AND d.department_code=x.dept
  JOIN public.gl_accounts g ON g.organization_id=p_organization_id AND g.account_code=x.gl
  ON CONFLICT(organization_id,vote_code) DO UPDATE SET vote_name=excluded.vote_name,budget_type=excluded.budget_type,
    default_department_id=excluded.default_department_id,default_gl_account_id=excluded.default_gl_account_id;

  INSERT INTO public.school_budget_subvotes(organization_id,vote_id,subvote_code,subvote_name,default_gl_account_id)
  SELECT p_organization_id,v.id,v.vote_code||'.'||lpad(x.seq::text,2,'0'),x.name,v.default_gl_account_id
  FROM (VALUES
    ('01',1,'Continuous Assessment'),('01',2,'Facilitator Fees'),('01',3,'Remedial Teaching & Supervision'),('01',4,'Internal Examinations'),('01',5,'External Examinations'),
    ('02',1,'Office Expenses'),('02',2,'Bank Charges'),('02',3,'Consultancy and Legal Fees'),('02',4,'Travel'),('02',5,'Entertainment'),
    ('03',1,'School Pay'),('03',2,'Magezi Solutions'),('03',3,'DSTV / MultiChoice'),
    ('04',1,'BoG Meetings'),('04',2,'PTA Meetings'),('04',3,'Staff Meetings'),
    ('05',1,'UNEB A Level / PUJAB'),('05',2,'UNEB O Level'),('05',3,'Associations and delegated contributions'),
    ('06',1,'Skilled-Based Subjects'),('06',2,'Career Development'),('06',3,'Science Equipment & Chemicals'),
    ('07',1,'Computers & Accessories'),('07',2,'Internet Connectivity'),('07',3,'Toner / Cartridge'),('07',4,'Computer Maintenance'),
    ('08',1,'Government Salaries'),('08',2,'School / BoG Salaries'),('09',1,'Utensils'),('09',2,'Fire Wood'),('09',3,'Student Food'),('09',4,'Staff Breakfast'),
    ('10',1,'Corporate Social Responsibility'),('10',2,'Seminars / Workshops'),('10',3,'Advertisement and Public Relations'),('10',4,'Staff Development'),
    ('11',1,'Library / Text Books'),('11',2,'Binding / Newspapers / Periodicals'),('12',1,'Liturgy & Religious Activities'),('13',1,'Medical & Health'),('14',1,'NSSF 10%'),
    ('15',1,'Plumbing / Repairs'),('15',2,'General Repairs & Renovation'),('15',3,'Fire Extinguisher'),('15',4,'Painting'),
    ('16',1,'Fumigation'),('16',2,'Detergents'),('16',3,'Compound Maintenance'),('16',4,'Garbage Collection'),('16',5,'Equipment'),
    ('17',1,'Guard Training'),('17',2,'Armed Security Personnel'),('17',3,'Uniforms'),('17',4,'Security Appliances'),
    ('18',1,'Food Basket'),('18',2,'Transport Refund'),('18',3,'Child Benefit'),('18',4,'Mileage'),('18',5,'House Rent'),('18',6,'Staff Meals'),
    ('19',1,'Stationery'),('20',1,'Clubs & Societies'),('20',2,'Games & Sports / P.E.'),('20',3,'Music, Dance & Drama'),
    ('21',1,'Student Excellence Awards'),('21',2,'End-of-Term Prizes'),('21',3,'Departmental Awards'),('21',4,'Staff Performance Incentives'),
    ('22',1,'A Level Uniforms'),('22',2,'O Level Uniforms'),('23',1,'Electricity / YAKA'),('23',2,'Telephone / Airtime'),('23',3,'Water / NWSC'),
    ('24',1,'Vehicle Maintenance'),('24',2,'Fuel'),('24',3,'Vehicle Insurance'),
    ('D1',1,'Furniture Purchase / Repairs'),('D1',2,'Heavy-Duty Printer'),('D1',3,'Dormitory Construction'),('D1',4,'Perimeter Wall Construction'),('D1',5,'Water Harvesting'),('D1',6,'Dining Shade Construction')) x(vote,seq,name)
  JOIN public.school_budget_votes v ON v.organization_id=p_organization_id AND v.vote_code=x.vote
  ON CONFLICT(organization_id,subvote_code) DO UPDATE SET subvote_name=excluded.subvote_name;
END $$;

-- Create a zero-value vote template in one operation; users fill term amounts.
CREATE OR REPLACE FUNCTION public.add_school_votes_to_budget(p_budget_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE oid uuid; inserted_count integer;
BEGIN
  SELECT organization_id INTO oid FROM public.budgets WHERE id=p_budget_id;
  IF oid IS NULL OR oid IS DISTINCT FROM (SELECT organization_id FROM public.staff WHERE id=auth.uid()) THEN RAISE EXCEPTION 'Budget not found'; END IF;
  IF NOT public.has_budget_permission('budget_prepare') THEN RAISE EXCEPTION 'Budget preparation permission required'; END IF;
  PERFORM public.seed_school_vote_structure(oid);
  INSERT INTO public.budget_lines(budget_id,vote_id,gl_account_id,department_id,line_label,budget_type,amount,sort_order,assumptions)
  SELECT p_budget_id,v.id,v.default_gl_account_id,v.default_department_id,v.vote_name,
    CASE WHEN v.budget_type IN('financing','balance_sheet') THEN 'capital_expenditure' ELSE v.budget_type END,
    0,row_number() over(order by v.vote_code),'Vote '||v.vote_code
  FROM public.school_budget_votes v WHERE v.organization_id=oid AND v.is_active
    AND NOT EXISTS(SELECT 1 FROM public.budget_lines l WHERE l.budget_id=p_budget_id AND l.vote_id=v.id);
  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  RETURN inserted_count;
END $$;

-- Exact actuals are obtained from journal dimensions. Legacy untagged lines remain
-- visible in the GL but are deliberately not guessed into a departmental vote.
CREATE OR REPLACE FUNCTION public.school_budget_actuals(p_budget_id uuid)
RETURNS TABLE(budget_line_id uuid,actual numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT bl.id,
    COALESCE(sum(CASE WHEN ga.account_type='income' THEN jel.credit-jel.debit ELSE jel.debit-jel.credit END),0)::numeric
  FROM public.budget_lines bl
  JOIN public.budgets b ON b.id=bl.budget_id
  LEFT JOIN public.journal_entries je ON je.organization_id=b.organization_id AND je.entry_date BETWEEN b.start_date AND b.end_date AND je.is_posted=true AND je.is_deleted=false
  LEFT JOIN public.journal_entry_lines jel ON jel.journal_entry_id=je.id AND jel.dimensions->>'budget_line_id'=bl.id::text
  LEFT JOIN public.gl_accounts ga ON ga.id=jel.gl_account_id
  WHERE bl.budget_id=p_budget_id AND b.organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())
  GROUP BY bl.id;
$$;

GRANT EXECUTE ON FUNCTION public.seed_school_vote_structure(uuid),public.add_school_votes_to_budget(uuid),public.school_budget_actuals(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.school_income_statement_by_department(p_from date,p_to date,p_department_id uuid DEFAULT NULL)
RETURNS TABLE(department_id uuid,department_name text,account_code text,account_name text,account_type text,amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT d.id,d.name,ga.account_code,ga.account_name,ga.account_type,
    sum(CASE WHEN ga.account_type='income' THEN jel.credit-jel.debit ELSE jel.debit-jel.credit END)::numeric
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id=jel.journal_entry_id AND je.is_posted=true AND je.is_deleted=false
  JOIN public.gl_accounts ga ON ga.id=jel.gl_account_id AND ga.account_type IN('income','expense')
  LEFT JOIN public.departments d ON d.id=NULLIF(jel.dimensions->>'department_id','')::uuid
  WHERE je.organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())
    AND je.entry_date BETWEEN p_from AND p_to
    AND (p_department_id IS NULL OR d.id=p_department_id)
  GROUP BY d.id,d.name,ga.account_code,ga.account_name,ga.account_type
  ORDER BY d.name NULLS LAST,ga.account_code;
$$;
GRANT EXECUTE ON FUNCTION public.school_income_statement_by_department(date,date,uuid) TO authenticated;

-- Preserve every coding dimension when an approved budget is revised.
CREATE OR REPLACE FUNCTION public.create_budget_revision(p_budget_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old_b public.budgets%ROWTYPE; new_id uuid; oid uuid; source_parent public.budget_lines%ROWTYPE; new_parent_id uuid;
BEGIN
  IF NOT public.has_budget_permission('budget_approve') THEN RAISE EXCEPTION 'You do not have permission to revise budgets'; END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A revision reason is required'; END IF;
  SELECT organization_id INTO oid FROM public.staff WHERE id=auth.uid();
  SELECT * INTO old_b FROM public.budgets WHERE id=p_budget_id AND organization_id=oid AND status IN('approved','active') FOR UPDATE;
  IF old_b.id IS NULL THEN RAISE EXCEPTION 'Only an approved or active budget can be revised'; END IF;
  INSERT INTO public.budgets(organization_id,name,period_label,start_date,end_date,notes,is_active,financial_year,period_mode,status,version_no,parent_budget_id,workflow_note)
  VALUES(old_b.organization_id,old_b.name,old_b.period_label,old_b.start_date,old_b.end_date,old_b.notes,false,old_b.financial_year,old_b.period_mode,'draft',old_b.version_no+1,old_b.id,trim(p_reason)) RETURNING id INTO new_id;
  FOR source_parent IN SELECT * FROM public.budget_lines WHERE budget_id=old_b.id AND parent_line_id IS NULL ORDER BY sort_order,id LOOP
    INSERT INTO public.budget_lines(budget_id,gl_account_id,line_label,amount,sort_order,notes,unit,frequency,quantity,unit_price,department_id,cost_centre_id,vote_id,subvote_id,fund_code,project_code,budget_type,term_1_amount,term_2_amount,term_3_amount,annual_other_amount,responsible_staff_id,assumptions)
    VALUES(new_id,source_parent.gl_account_id,source_parent.line_label,source_parent.amount,source_parent.sort_order,source_parent.notes,source_parent.unit,source_parent.frequency,source_parent.quantity,source_parent.unit_price,source_parent.department_id,source_parent.cost_centre_id,source_parent.vote_id,source_parent.subvote_id,source_parent.fund_code,source_parent.project_code,source_parent.budget_type,source_parent.term_1_amount,source_parent.term_2_amount,source_parent.term_3_amount,source_parent.annual_other_amount,source_parent.responsible_staff_id,source_parent.assumptions)
    RETURNING id INTO new_parent_id;
    INSERT INTO public.budget_lines(budget_id,parent_line_id,gl_account_id,line_label,amount,sort_order,notes,unit,frequency,quantity,unit_price,department_id,cost_centre_id,vote_id,subvote_id,fund_code,project_code,budget_type,term_1_amount,term_2_amount,term_3_amount,annual_other_amount,responsible_staff_id,assumptions)
    SELECT new_id,new_parent_id,gl_account_id,line_label,amount,sort_order,notes,unit,frequency,quantity,unit_price,department_id,cost_centre_id,vote_id,subvote_id,fund_code,project_code,budget_type,term_1_amount,term_2_amount,term_3_amount,annual_other_amount,responsible_staff_id,assumptions
    FROM public.budget_lines WHERE parent_line_id=source_parent.id ORDER BY sort_order,id;
  END LOOP;
  INSERT INTO public.budget_workflow_history(organization_id,budget_id,to_status,note,acted_by)
  VALUES(oid,new_id,'draft','Revision created: '||trim(p_reason),auth.uid());
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.create_budget_revision(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_budget_revision(uuid,text) TO authenticated;

-- Seed all current school organizations. Future setup can call the idempotent seed RPC.
DO $$ DECLARE o record; BEGIN
  FOR o IN SELECT id FROM public.organizations WHERE lower(COALESCE(business_type,''))='school' LOOP
    PERFORM public.seed_school_vote_structure(o.id);
  END LOOP;
END $$;
