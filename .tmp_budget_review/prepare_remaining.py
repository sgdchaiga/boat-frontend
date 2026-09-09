import json,re
from pathlib import Path
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

doc=Document(r'C:\Users\LUBS\Documents\Boat\Spensa\Work Budget_2026.docx')
votes={}; current=None
for e in doc.element.body:
    if e.tag.endswith('}p'):
        text=Paragraph(e,doc).text.strip()
        match=re.match(r'Vote (\d+)\s+.*?UGX ([\d,]+)',text)
        if match:
            current=match[1].zfill(2)
            votes[current]={'vote':current,'total':int(match[2].replace(',','')),'rows':[]}
        elif text.startswith('5.3'): current=None
    elif e.tag.endswith('}tbl') and current:
        table=[[c.text for c in r.cells] for r in Table(e,doc).rows]
        if table[0]==['Code','Item','Amount','Note']:
            for i,(code,name,amount,note) in enumerate(table[1:],1):
                if '(NEW)' in name: note='NEW. '+note; name=name.replace(' (NEW)','')
                value=int(re.sub(r'[^\d]','',amount) or 0)
                if value==0 and 'Moved' in note: continue
                votes[current]['rows'].append({'seq':i,'code':code,'name':name,'amount':value,'note':note})
selected=[v for k,v in votes.items() if k!='02' and v['rows']]
selected.append({'vote':'D1','total':35000000,'rows':[{'seq':1,'code':'i','name':'Perimeter Wall Construction','amount':35000000,'note':'Along _____ Road and between school and primary. Only funded capital development item in the 2026 source; other items deferred or proposed without funding.'}]})
for v in selected:
    assert sum(r['amount'] for r in v['rows'])==v['total'],v
Path('.tmp_budget_review/remaining_votes.json').write_text(json.dumps(selected,ensure_ascii=False),encoding='utf8')
print(json.dumps({'votes':[(v['vote'],len(v['rows']),v['total']) for v in selected],'line_count':sum(len(v['rows']) for v in selected),'without_breakdown':[k for k,v in votes.items() if not v['rows']]}))

sql='''-- Open remaining explicitly costed expenditure sub-votes from Work Budget_2026.docx.
DO $$
DECLARE oid uuid; bid uuid; p public.budget_lines%ROWTYPE; item jsonb; r jsonb; sid uuid; before_total numeric; expected_count integer:=0;
BEGIN
 SELECT uao.organization_id INTO STRICT oid FROM auth.users u
 JOIN public.user_active_organization uao ON uao.user_id=u.id
 JOIN public.organization_members om ON om.user_id=u.id AND om.organization_id=uao.organization_id AND om.is_active
 WHERE lower(u.email)='george@spensa.com';
 SELECT id INTO STRICT bid FROM public.budgets WHERE organization_id=oid AND financial_year=2026 AND name='FY 2026 Work Budget' AND status='draft' FOR UPDATE;
 SELECT sum(amount) INTO before_total FROM public.budget_lines WHERE budget_id=bid AND parent_line_id IS NULL;
 FOR item IN SELECT value FROM jsonb_array_elements($data$DATA$data$::jsonb) LOOP
  SELECT l.* INTO STRICT p FROM public.budget_lines l JOIN public.school_budget_votes v ON v.id=l.vote_id
   WHERE l.budget_id=bid AND l.parent_line_id IS NULL AND v.organization_id=oid AND v.vote_code=item->>'vote' FOR UPDATE OF l;
  IF p.amount<>(item->>'total')::numeric OR EXISTS(SELECT 1 FROM public.budget_lines WHERE parent_line_id=p.id) THEN
   RAISE EXCEPTION 'Vote % changed or already has sub-lines; review required',item->>'vote';
  END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(item->'rows') LOOP
   sid:=NULL;
   IF (SELECT count(*) FROM public.school_budget_subvotes WHERE organization_id=oid AND vote_id=p.vote_id AND lower(subvote_name)=lower(r->>'name'))>1 THEN
    RAISE EXCEPTION 'Duplicate sub-vote name %',r->>'name';
   END IF;
   SELECT id INTO sid FROM public.school_budget_subvotes WHERE organization_id=oid AND vote_id=p.vote_id AND lower(subvote_name)=lower(r->>'name');
   IF sid IS NULL THEN
    INSERT INTO public.school_budget_subvotes(organization_id,vote_id,subvote_code,subvote_name,default_gl_account_id)
    VALUES(oid,p.vote_id,(item->>'vote')||'.'||(r->>'code'),r->>'name',p.gl_account_id) RETURNING id INTO sid;
   ELSE
    UPDATE public.school_budget_subvotes SET subvote_code=(item->>'vote')||'.'||(r->>'code'),is_active=true WHERE id=sid;
   END IF;
   INSERT INTO public.budget_lines(budget_id,parent_line_id,gl_account_id,department_id,cost_centre_id,vote_id,subvote_id,fund_code,line_label,budget_type,annual_other_amount,amount,sort_order,frequency,notes,assumptions)
   VALUES(bid,p.id,p.gl_account_id,p.department_id,p.cost_centre_id,p.vote_id,sid,p.fund_code,r->>'name',p.budget_type,(r->>'amount')::numeric,(r->>'amount')::numeric,(r->>'seq')::integer,'annual',r->>'note',r->>'note');
   expected_count:=expected_count+1;
  END LOOP;
  IF (SELECT amount FROM public.budget_lines WHERE id=p.id)<>(item->>'total')::numeric
    OR (SELECT count(*) FROM public.budget_lines WHERE parent_line_id=p.id)<>jsonb_array_length(item->'rows') THEN
   RAISE EXCEPTION 'Vote % reconciliation failed',item->>'vote';
  END IF;
 END LOOP;
 IF expected_count<>COUNT OR (SELECT sum(amount) FROM public.budget_lines WHERE budget_id=bid AND parent_line_id IS NULL)<>before_total THEN
  RAISE EXCEPTION 'Budget reconciliation failed';
 END IF;
END $$;
'''.replace('DATA',json.dumps(selected,ensure_ascii=False,indent=2)).replace('expected_count<>COUNT','expected_count<>'+str(sum(len(v['rows']) for v in selected)))
Path('supabase/migrations/20260909150000_spensa_remaining_budget_subvotes.sql').write_text(sql,encoding='utf8')
