import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

// Run only against a disposable database. This suite creates its own minimal base schema.
test('practice reconciliation PostgreSQL controls', { skip: !process.env.PRACTICE_RECON_TEST_DATABASE_URL }, async t => {
  const db = new pg.Client({ connectionString: process.env.PRACTICE_RECON_TEST_DATABASE_URL });
  await db.connect();
  const clientId = '00000000-0000-0000-0000-000000000001';
  try {
    await db.query(`
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000002'::uuid $$;
      DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
      CREATE TABLE practice_clients(id uuid PRIMARY KEY, organization_id uuid NOT NULL);
      CREATE TABLE practice_reconciliation_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, client_id uuid, period_start date,period_end date,method text,side_mode text,notes text,reconciled_by uuid);
      CREATE TABLE practice_reconciliation_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,client_id uuid,side text,line_date date NOT NULL,amount numeric(18,2) NOT NULL CHECK(amount<>0),reference text,description text,source_file text,imported_by uuid,match_group_id uuid,reconciliation_run_id uuid REFERENCES practice_reconciliation_runs(id));
      CREATE TABLE practice_reconciliation_drafts(client_id uuid,saved_by uuid);
      INSERT INTO practice_clients VALUES('${clientId}','00000000-0000-0000-0000-000000000003');
    `);
    await db.query(readFileSync(new URL('../supabase/migrations/20260908150000_practice_safe_matching.sql', import.meta.url),'utf8'));
    const row = (amount, reference='BATCH42') => ({line_date:'2026-09-01',amount,reference,description:'Settlement'});
    const upload = (side, name, rows, currency='UGX') => db.query('SELECT practice_import_lines($1,$2,$3,$4,$5,$6)', [clientId,side,name,JSON.stringify(rows),'BANK-001',currency]);
    const snapshot = async names => (await db.query(`SELECT id,side,to_char(line_date,'YYYY-MM-DD') AS line_date,amount::float8,reference,description,account_key,currency FROM practice_reconciliation_lines WHERE source_file=ANY($1) ORDER BY id`,[names])).rows;
    const save = (groups, rows, cash='cash.csv', bank='bank.csv') => db.query('SELECT practice_save_matches($1,$2,$3,$4,$5,$6,$7)',[clientId,'2026-09-01','2026-09-30',cash,bank,JSON.stringify(groups),JSON.stringify(rows)]);
    await upload('cashbook','cash.csv',[row(100),row(200)]);
    await upload('statement','bank.csv',[row(300)]);
    await t.test('duplicate import is rejected even after renaming',async()=>{
      await assert.rejects(upload('cashbook','cash.csv',[row(100),row(200)]),/already exists/);
      await assert.rejects(upload('cashbook','renamed.csv',[row(200),row(100)]),/already imported/);
    });
    const rows=await snapshot(['cash.csv','bank.csv']);
    await t.test('invalid groups roll back the entire run',async()=>{
      await upload('cashbook','rollback-cash.csv',[row(10,'GOOD'),row(20,'BAD')]);
      await upload('statement','rollback-bank.csv',[row(10,'GOOD'),row(19,'BAD')]);
      const rollbackRows=await snapshot(['rollback-cash.csv','rollback-bank.csv']);
      await assert.rejects(save([
        {ids:rollbackRows.filter(r=>r.reference==='GOOD').map(r=>r.id)},
        {ids:rollbackRows.filter(r=>r.reference==='BAD').map(r=>r.id)},
      ],rollbackRows,'rollback-cash.csv','rollback-bank.csv'),/both sides/);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM practice_reconciliation_runs')).rows[0].n,0);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM practice_reconciliation_lines WHERE match_group_id IS NOT NULL')).rows[0].n,0);
    });
    await t.test('stale previews and reused IDs are rejected',async()=>{
      await assert.rejects(save([{ids:rows.map(r=>r.id)}],rows.map((r,i)=>i? r:{...r,amount:999})),/Transactions changed/);
      await assert.rejects(save([{ids:[rows[0].id,rows[0].id]}],[rows[0]]),/cannot be used twice/);
    });
    await t.test('grouped settlement shares one match ID and cannot be reused',async()=>{
      await save([{ids:rows.map(r=>r.id)}],rows);
      const result=await db.query('SELECT count(DISTINCT match_group_id)::int AS groups,count(*)::int AS lines FROM practice_reconciliation_lines WHERE match_group_id IS NOT NULL');
      assert.deepEqual(result.rows[0],{groups:1,lines:3});
      await assert.rejects(save([{ids:rows.map(r=>r.id)}],rows),/Transactions changed/);
    });
    await t.test('account currency mismatch is rejected by the database',async()=>{
      await upload('cashbook','other-cash.csv',[row(500,'OTHER')]);
      await upload('statement','other-bank.csv',[row(500,'OTHER')],'USD');
      const other=await snapshot(['other-cash.csv','other-bank.csv']);
      await assert.rejects(save([{ids:other.map(r=>r.id)}],other,'other-cash.csv','other-bank.csv'),/same confirmed account and currency/);
    });
    await t.test('confirmed source scope cannot be silently overwritten',async()=>{
      await assert.rejects(db.query('SELECT practice_label_sources($1,$2,$3,$4,$5)',[clientId,'cash.csv','bank.csv','WRONG-ACCOUNT','UGX']),/different account or currency/);
    });
  } finally { await db.end(); }
});
