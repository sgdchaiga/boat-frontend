import fs from 'node:fs';
const a=JSON.parse(fs.readFileSync('.tmp/chart-audit-api.json','utf8')).rows[0].audit;
const cutoff=new Date('2026-07-09T09:01:31.177489Z');
for(const o of a.organizations){const old=a.accounts.filter(g=>g.organization_id===o.id&&new Date(g.created_at)<cutoff);if(old.length&&old.length<10)console.log(o.name,old.map(g=>[g.account_code,g.account_name,g.is_active]));}
const refs=JSON.parse(fs.readFileSync('.tmp/chart-audit-references.json','utf8')).rows[0].audit.references;
const q=s=>'"'+s.replaceAll('"','""')+'"';
const selects=refs.filter(r=>r.table_name!=='gl_accounts').map(r=>`select ${q(r.column_name)}::text as account_id, '${r.table_name}.${r.column_name}' as reference, count(*)::int as count from public.${q(r.table_name)} where ${q(r.column_name)} is not null group by ${q(r.column_name)}`);
for(const col of ['stock_account','income_account','purchases_account'])selects.push(`select ${q(col)}::text as account_id, 'products.${col}' as reference,count(*)::int as count from public.products where ${q(col)} is not null group by ${q(col)}`);
selects.push(`select x.value as account_id,'journal_gl_department_settings.'||x.key as reference,count(*)::int as count from public.journal_gl_department_settings s cross join lateral jsonb_each_text(to_jsonb(s)) x where x.key like '%gl_account_id' and x.value is not null group by x.key,x.value`);
fs.writeFileSync('.tmp/chart-usage.sql',`BEGIN READ ONLY; SELECT jsonb_agg(x) as usage FROM (${selects.join(' UNION ALL ')}) x; COMMIT;`);
