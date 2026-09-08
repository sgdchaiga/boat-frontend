import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const execFileAsync = promisify(execFile);
const { stdout, stderr } = await execFileAsync("cmd.exe", ["/d", "/s", "/c", "npx.cmd supabase@latest db dump --linked --dry-run"], { maxBuffer: 4 * 1024 * 1024 });
const dryRun = `${stdout}\n${stderr}`;
const urlMatch = dryRun.match(/postgres(?:ql)?:\/\/[^\s"']+/i);
const env = Object.fromEntries(Array.from(dryRun.matchAll(/(?:^|\s)(PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)=["']?([^\s"']+)/gm), (match) => [match[1], match[2]]));
const connection = urlMatch
  ? { connectionString: urlMatch[0] }
  : { host: env.PGHOST, port: Number(env.PGPORT || 5432), user: env.PGUSER, password: env.PGPASSWORD, database: env.PGDATABASE || "postgres" };
if (!(urlMatch || (env.PGHOST && env.PGUSER && env.PGPASSWORD))) throw new Error("Linked read-only credentials were unavailable.");
const client = new pg.Client({ ...connection, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const organizations = await client.query(`select o.id,o.name,o.business_type,o.created_at, count(g.id)::int as accounts, count(g.id) filter(where g.is_active)::int as active, min(g.created_at) as first_account from organizations o left join gl_accounts g on g.organization_id=o.id group by o.id order by o.created_at`);
  const accounts = await client.query('select * from gl_accounts order by organization_id,created_at,account_code');
  const batches = await client.query(`select organization_id,created_at,count(*)::int as count from gl_accounts group by organization_id,created_at having count(*)>5 order by created_at`);
  const functions = await client.query(`select proname,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (proname like '%chart%' or proname like '%standard_setup%' or proname='create_self_service_organization')`);
  const auditTables = await client.query(`select table_name from information_schema.tables where table_schema='public' and table_name like '%audit%'`);
  await fs.writeFile('.tmp/chart-audit.json',JSON.stringify({organizations:organizations.rows,accounts:accounts.rows,batches:batches.rows,functions:functions.rows,auditTables:auditTables.rows},null,2));
  console.log(JSON.stringify({organizations:organizations.rows,batches:batches.rows,auditTables:auditTables.rows}));
} finally { await client.end(); }
    `select id, name from public.organizations where lower(name) = lower($1) limit 1`,
    ["St Peter's S.S Nsambya"]
