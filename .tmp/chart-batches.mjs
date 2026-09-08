import fs from 'node:fs';
const a=JSON.parse(fs.readFileSync('.tmp/chart-audit-api.json','utf8')).rows[0].audit;
const cutoff='2026-07-09T09:01:31.177489+00:00';
const orgs=a.organizations.filter(o=>a.accounts.some(g=>g.organization_id===o.id&&new Date(g.created_at)<new Date(cutoff)));
for(const o of orgs){const rows=a.accounts.filter(g=>g.organization_id===o.id);const batches={};for(const g of rows.filter(g=>new Date(g.created_at)>=new Date(cutoff))) (batches[g.created_at]??=[]).push(g.account_code+': '+g.account_name);console.log(JSON.stringify({id:o.id,name:o.name,original:rows.filter(g=>new Date(g.created_at)<new Date(cutoff)).length,batches}));}
