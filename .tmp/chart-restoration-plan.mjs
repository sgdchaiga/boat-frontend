import fs from 'node:fs';
const a=JSON.parse(fs.readFileSync('.tmp/chart-audit-api.json','utf8')).rows[0].audit;
const usage=JSON.parse(fs.readFileSync('.tmp/chart-usage.json','utf8')).rows[0].usage;
const cutoff='2026-07-09T09:01:31.177489+00:00';
const established=a.organizations.filter(o=>a.accounts.filter(g=>g.organization_id===o.id&&new Date(g.created_at)<new Date(cutoff)).length>10);
const ids=new Set(established.map(o=>o.id));
const candidates=a.accounts.filter(g=>ids.has(g.organization_id)&&g.created_at===cutoff);
const counts=[];
for(const o of established){const rows=candidates.filter(g=>g.organization_id===o.id);counts.push({name:o.name,original:a.accounts.filter(g=>g.organization_id===o.id&&new Date(g.created_at)<new Date(cutoff)).length,added:rows.length,activeAdded:rows.filter(g=>g.is_active).length,unreferenced:rows.filter(g=>!usage.some(u=>u.account_id===g.id)).length,posted:rows.filter(g=>usage.some(u=>u.account_id===g.id&&u.reference==='journal_entry_lines.gl_account_id')).length});}
console.log(JSON.stringify(counts,null,2));
fs.writeFileSync('.tmp/chart-restoration-candidates.json',JSON.stringify(candidates.map(g=>({...g,usage:usage.filter(u=>u.account_id===g.id)})),null,2));
