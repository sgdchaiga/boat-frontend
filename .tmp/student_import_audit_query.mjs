import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const execFileAsync = promisify(execFile);
const { stdout, stderr } = await execFileAsync("cmd.exe", ["/d", "/s", "/c", "npx.cmd supabase@latest db dump --linked --dry-run"], { maxBuffer: 4 * 1024 * 1024 });
const dryRun = `${stdout}\n${stderr}`;
const urlMatch = dryRun.match(/postgres(?:ql)?:\/\/[^\s"']+/i);
const env = Object.fromEntries(Array.from(dryRun.matchAll(/(?:^|\s)(PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)=([^\s"']+)/gm), (match) => [match[1], match[2]]));
const connection = urlMatch
  ? { connectionString: urlMatch[0] }
  : { host: env.PGHOST, port: Number(env.PGPORT || 5432), user: env.PGUSER, password: env.PGPASSWORD, database: env.PGDATABASE || "postgres" };
if (!(urlMatch || (env.PGHOST && env.PGUSER && env.PGPASSWORD))) throw new Error("Linked read-only credentials were unavailable.");
const client = new pg.Client({ ...connection, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const organization = await client.query(
    `select id, name from public.organizations where lower(name) = lower($1) limit 1`,
    ["St Peter's S.S Nsambya"]
  );
  if (!organization.rows[0]) throw new Error("Current organization was not found.");
  const organizationId = organization.rows[0].id;
  const students = await client.query(
    `select admission_number, school_pay_number, first_name, other_names, last_name,
            class_name, stream, gender, is_boarding, status, created_at, updated_at
       from public.students
      where organization_id = $1
        and (created_at >= $2::timestamptz or updated_at >= $2::timestamptz)
      order by updated_at asc, admission_number asc`,
    [organizationId, "2026-08-27T21:00:00Z"]
  );
  await fs.writeFile(
    ".tmp/student_import_rows.json",
    JSON.stringify({ organization: organization.rows[0], cutoff: "2026-08-28T00:00:00+03:00", rows: students.rows }, null, 2)
  );
  const overwritten = students.rows.filter((row) => new Date(row.updated_at).getTime() - new Date(row.created_at).getTime() > 1000).length;
  process.stdout.write(JSON.stringify({ organization: organization.rows[0].name, rows: students.rowCount, overwritten }));
} finally {
  await client.end();
}
