import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import test from 'node:test';
import pg from 'pg';

// Run against a disposable PostgreSQL cluster, never the application's database.
// PG_BIN can point to another local PostgreSQL installation.
const bin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/16/bin';
const run = (name, args) => {
  const result = spawnSync(path.join(bin, name), args, { encoding: 'utf8', windowsHide: true, ...(name === 'pg_ctl.exe' ? { stdio: 'ignore' } : {}) });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
};
const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');

test('Super Admin can complete own budget approvals while ordinary users retain maker/checker controls', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'boat-budget-approval-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  run('initdb.exe', ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
  run('pg_ctl.exe', ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  const db = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
  try {
    await db.connect();

    await db.query(`
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
      CREATE TABLE staff(id uuid PRIMARY KEY,organization_id uuid,role text);
      CREATE TABLE platform_admins(user_id uuid PRIMARY KEY);
      CREATE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM platform_admins WHERE user_id=auth.uid()) $$;
      CREATE TABLE organization_permissions(organization_id uuid,role_key text,permission_key text,allowed boolean);
      CREATE TABLE staff_permission_overrides(organization_id uuid,staff_id uuid,permission_key text,allowed boolean);
      CREATE TABLE budgets(id uuid PRIMARY KEY,organization_id uuid,status text,is_active boolean DEFAULT false,
        workflow_note text,submitted_by uuid,submitted_at timestamptz,reviewed_by uuid,reviewed_at timestamptz,
        approved_by uuid,approved_at timestamptz,activated_by uuid,activated_at timestamptz,closed_by uuid,closed_at timestamptz);
      CREATE TABLE budget_lines(budget_id uuid,amount numeric,term_1_amount numeric,term_2_amount numeric,term_3_amount numeric,annual_other_amount numeric);
      CREATE TABLE budget_workflow_history(organization_id uuid,budget_id uuid,from_status text,to_status text,note text,acted_by uuid);
    `);
    await db.query(migration('20260912140000_super_admin_budget_approval'));
    const uuid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
    const org=uuid(1), otherOrg=uuid(2), superAdmin=uuid(3), platformAdmin=uuid(4), admin=uuid(5), reviewer=uuid(6);
    for(const [id,role] of [[superAdmin,'super_admin'],[platformAdmin,'accountant'],[admin,'admin'],[reviewer,'manager']])
      await db.query('INSERT INTO staff VALUES ($1,$2,$3)',[id,org,role]);
    await db.query('INSERT INTO platform_admins VALUES ($1)',[platformAdmin]);
    await db.query(`INSERT INTO staff_permission_overrides VALUES ($1,$2,'budget_approve',false)`,[org,platformAdmin]);
    const login=actor=>db.query("SELECT set_config('test.uid',$1,false)",[actor]);
    const create=async(id,organization=org)=>{
      await db.query("INSERT INTO budgets(id,organization_id,status) VALUES ($1,$2,'draft')",[id,organization]);
      await db.query('INSERT INTO budget_lines VALUES ($1,100,0,0,0,100)',[id]);
    };
    const move=(id,status)=>db.query('SELECT change_budget_status($1,$2,$3)',[id,status,'Regression test']);
    for(const [id,actor] of [[uuid(10),superAdmin],[uuid(11),platformAdmin]]){
      await create(id); await login(actor);
      for(const status of ['submitted','reviewed','approved','active']) await move(id,status);
      const budget=(await db.query('SELECT * FROM budgets WHERE id=$1',[id])).rows[0];
      assert.equal(budget.status,'active'); assert.equal(budget.is_active,true);
      for(const field of ['submitted_by','reviewed_by','approved_by','activated_by']) assert.equal(budget[field],actor);
      const history=(await db.query('SELECT * FROM budget_workflow_history WHERE budget_id=$1',[id])).rows;
      assert.deepEqual(history.map(row=>row.to_status),['submitted','reviewed','approved','active']);
      assert.ok(history.every(row=>row.acted_by===actor));
    }
    const normal=uuid(12); await create(normal); await login(admin); await move(normal,'submitted');
    await assert.rejects(move(normal,'reviewed'),/cannot review or approve your own/);
    await login(reviewer); await move(normal,'reviewed');
    await login(admin); await assert.rejects(move(normal,'approved'),/cannot review or approve your own/);
    await login(reviewer); await move(normal,'approved'); await move(normal,'active');
    const foreign=uuid(13); await create(foreign,otherOrg); await login(superAdmin);
    await assert.rejects(move(foreign,'submitted'),/Budget not found/);
    const invalid=uuid(14); await create(invalid);
    await assert.rejects(move(invalid,'active'),/Transition/);
    await db.query('UPDATE budget_lines SET amount=101 WHERE budget_id=$1',[invalid]);
    await assert.rejects(move(invalid,'submitted'),/reconcile/);
  } finally {
    await db.end();
    run('pg_ctl.exe',['-D',path.join(dir,'data'),'-m','immediate','-w','stop']);
  }
});
