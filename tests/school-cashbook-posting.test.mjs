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

test('school subvotes post atomically and survive corrections and reversals', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'boat-school-cashbook-'));
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
      CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
      CREATE TABLE organizations(id uuid PRIMARY KEY, business_type text);
      CREATE TABLE staff(id uuid PRIMARY KEY, organization_id uuid, role text);
      CREATE TABLE organization_permissions(organization_id uuid,role_key text,permission_key text,allowed boolean, UNIQUE(organization_id,role_key,permission_key));
      CREATE TABLE organization_role_types(organization_id uuid,role_key text);
      CREATE TABLE staff_permission_overrides(organization_id uuid,staff_id uuid,permission_key text,allowed boolean);
      CREATE TABLE gl_accounts(id uuid PRIMARY KEY,organization_id uuid,account_type text,account_name text,category text,is_active boolean DEFAULT true);
      CREATE TABLE journal_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entry_date date,description text,reference_type text,reference_id uuid,created_by uuid,organization_id uuid,is_posted boolean,is_deleted boolean);
      CREATE TABLE journal_entry_lines(id uuid DEFAULT gen_random_uuid(),journal_entry_id uuid,gl_account_id uuid,debit numeric,credit numeric,line_description text,sort_order integer);
      CREATE TABLE expenses(id uuid PRIMARY KEY,organization_id uuid);
      CREATE TABLE expense_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),expense_id uuid,expense_gl_account_id uuid);
      CREATE TABLE school_budget_votes(id uuid PRIMARY KEY,organization_id uuid,vote_code text,vote_name text,is_active boolean DEFAULT true);
      CREATE TABLE school_budget_subvotes(id uuid PRIMARY KEY,organization_id uuid,vote_id uuid,subvote_code text,subvote_name text,default_gl_account_id uuid,is_active boolean DEFAULT true);
    `);
    await db.query(migration('20260801130000_general_business_cashbook_entries'));
    await db.query('ALTER TABLE general_business_cashbook_entries ADD COLUMN comments text');
    await db.query(migration('20260802130000_general_microfinance_cashbook_controls'));
    await db.query(migration('20260912120000_school_cashbook_subvotes'));
    await db.query(migration('20260912130000_school_spend_money_subvotes'));
    const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
    const [org, outsider, staff, expense, cash, changed, vote, sub1, sub2, foreignVote, foreignSub] = Array.from({length:11},(_,i)=>uuid(i+1));
    await db.query(`INSERT INTO organizations VALUES ($1,'school'),($2,'school');`,[org,outsider]);
    await db.query(`INSERT INTO staff VALUES ($1,$2,'accountant')`,[staff,org]);
    await db.query(`SELECT set_config('test.uid',$1,false)`,[staff]);
    for (const id of [expense,cash,changed]) await db.query(`INSERT INTO gl_accounts(id,organization_id,account_type,account_name) VALUES ($1,$2,'asset','Cash')`,[id,org]);
    await db.query(`INSERT INTO school_budget_votes VALUES ($1,$2,'01','Feeding',true),($3,$4,'02','Other school',true)`,[vote,org,foreignVote,outsider]);
    for (const [id,v,o,name] of [[sub1,vote,org,'Firewood'],[sub2,vote,org,'Food'],[foreignSub,foreignVote,outsider,'Foreign']]) {
      await db.query(`INSERT INTO school_budget_subvotes VALUES ($1,$2,$3,'01.1',$4,$5,true)`,[id,o,v,name,expense]);
    }
    await db.query('INSERT INTO expenses VALUES ($1,$2)',[uuid(20),org]);
    await db.query('INSERT INTO expense_lines(expense_id,expense_gl_account_id,school_subvote_id) VALUES ($1,$2,$3)',[uuid(20),expense,sub1]);
    const savedExpenseLine = (await db.query('SELECT school_subvote_id FROM expense_lines')).rows[0];
    assert.equal(savedExpenseLine.school_subvote_id,sub1);
    await assert.rejects(db.query('INSERT INTO expense_lines(expense_id,expense_gl_account_id,school_subvote_id) VALUES ($1,$2,$3)',[uuid(20),expense,foreignSub]), /same school/);
    const post = async (sub, account=expense, amountIn=0, amountOut=100) => (await db.query(`SELECT post_school_cashbook_entry($1,current_date,'','cash','Test','','',$2,$3,$4,$5,'ref',$6) id`,[org,account,cash,amountIn,amountOut,sub])).rows[0].id;
    const first = await post(sub1);
    const second = await post(sub2);
    const other = await post(null,changed,75,0);
    const read = async id => (await db.query('SELECT * FROM general_business_cashbook_entries WHERE id=$1',[id])).rows[0];
    assert.equal((await read(first)).school_subvote_id,sub1);
    assert.equal((await read(second)).school_subvote_id,sub2);
    assert.equal((await read(other)).school_subvote_id,null);
    assert.equal((await read(first)).school_vote_label,'01 — Feeding');
    const count = async () => Number((await db.query('SELECT count(*) n FROM journal_entries')).rows[0].n);
    const before = await count();
    await assert.rejects(post(foreignSub), /active subvote/);
    await assert.rejects(post(sub1,changed), /mapping/);
    await assert.rejects(post(sub1,expense,100,100), /either cash in or cash out/);
    assert.equal(await count(),before,'rejected posts must not leave journals');
    await assert.rejects(db.query('UPDATE general_business_cashbook_entries SET school_subvote_id=$1 WHERE id=$2',[sub2,first]), /immutable/);
    await db.query('UPDATE school_budget_subvotes SET default_gl_account_id=$1,subvote_name=$2,is_active=false WHERE id=$3',[changed,'Renamed',sub1]);
    const replacement = (await db.query(`SELECT correct_general_cashbook_entry($1,$2,'Fix wording','Corrected','new-ref') id`,[org,first])).rows[0].id;
    assert.equal((await read(first)).approval_status,'replaced');
    assert.equal((await read(replacement)).school_subvote_id,sub1);
    assert.equal((await read(replacement)).school_subvote_label,'01.1 — Firewood');
    assert.equal((await read(replacement)).counterpart_gl_account_id,expense);
    const reversal = (await db.query('SELECT * FROM general_business_cashbook_entries WHERE reversal_of_entry_id=$1',[first])).rows[0];
    assert.equal(reversal.school_subvote_id,sub1);
    assert.equal(Number(reversal.cash_in),100);
    const unbalanced = await db.query('SELECT journal_entry_id FROM journal_entry_lines GROUP BY journal_entry_id HAVING sum(debit)<>sum(credit)');
    assert.equal(unbalanced.rowCount,0);
    await db.query(`UPDATE staff SET role='viewer' WHERE id=$1`,[staff]);
    await assert.rejects(db.query(`SELECT void_general_cashbook_entry($1,$2,'Unauthorized')`,[org,second]), /permission/);
  } finally {
    await db.end();
    run('pg_ctl.exe',['-D',path.join(dir,'data'),'-m','immediate','-w','stop']);
  }
});
