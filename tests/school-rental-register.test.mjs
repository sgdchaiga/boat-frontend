// Isolated PostgreSQL integration test. Setup (no application dependency changes):
// npm install --prefix .tmp/rental-tests --no-package-lock --ignore-scripts @electric-sql/pglite
// node --test tests/school-rental-register.test.mjs
import { PGlite } from '../.tmp/rental-tests/node_modules/@electric-sql/pglite/dist/index.js';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

test('rental invoices are tenant scoped, atomic, idempotent and preserve history', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
      CREATE TABLE organizations(id uuid PRIMARY KEY);
      CREATE TABLE staff(id uuid PRIMARY KEY, organization_id uuid);
      CREATE TABLE retail_customers(id uuid PRIMARY KEY, organization_id uuid, name text, email text, address text);
      CREATE TABLE gl_accounts(id uuid PRIMARY KEY, organization_id uuid, account_type text, is_active boolean);
      CREATE TABLE journal_gl_settings(organization_id uuid, receivable_id uuid);
      CREATE TABLE retail_invoices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, invoice_number text,
        customer_id uuid, customer_name text, customer_email text, customer_address text, issue_date date, due_date date,
        status text, subtotal numeric, total numeric, tax_amount numeric DEFAULT 0, created_by uuid, notes text);
      CREATE TABLE retail_invoice_lines(invoice_id uuid, line_no integer, description text, quantity numeric, unit_price numeric, line_total numeric);
      CREATE TABLE test_journals(invoice_id uuid, lines jsonb);
      CREATE FUNCTION create_journal_entry_atomic(date,text,text,uuid,uuid,jsonb,uuid) RETURNS uuid LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('test.locked', true) = 'yes' THEN RAISE EXCEPTION 'Period locked'; END IF;
        INSERT INTO test_journals VALUES ($4, $6); RETURN $4;
      END; $$;
      INSERT INTO organizations VALUES ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002');
      INSERT INTO staff VALUES (auth.uid(), '10000000-0000-0000-0000-000000000001');
      INSERT INTO retail_customers VALUES
        ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','First tenant',NULL,NULL),
        ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Other school tenant',NULL,NULL);
      INSERT INTO gl_accounts VALUES
        ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','income',true),
        ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','asset',true);
      INSERT INTO journal_gl_settings VALUES ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002');
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20260905120000_school_rental_register.sql', import.meta.url), 'utf8'));
    const property = '40000000-0000-0000-0000-000000000001';
    await db.exec(`INSERT INTO school_rental_properties(id,organization_id,name,tenant_id,monthly_rent,revenue_account_id) VALUES
      ('${property}','10000000-0000-0000-0000-000000000001','Shop 1','20000000-0000-0000-0000-000000000001',500000,'30000000-0000-0000-0000-000000000001');`);
    const charge = (month, amount = 500000) => db.query('SELECT * FROM charge_school_rental_month($1,$2,$3)', [property, month, amount]);
    const first = (await charge('2026-09-01')).rows[0];
    assert.equal(Number(first.total), 500000);
    assert.equal(first.customer_name, 'First tenant');
    assert.equal((await charge('2026-09-01', 600000)).rows[0].id, first.id);
    assert.equal((await db.query('SELECT * FROM test_journals')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM retail_invoice_lines')).rows.length, 1);
    const journal = (await db.query('SELECT * FROM test_journals')).rows[0];
    assert.equal(journal.lines[0].debit, 500000);
    assert.equal(journal.lines[1].credit, 500000);
    await assert.rejects(charge('2026-09-02'), /valid rental month/);
    await assert.rejects(charge('2026-10-01', -1), /positive/);
    await assert.rejects(db.exec(`UPDATE school_rental_properties SET tenant_id='20000000-0000-0000-0000-000000000002'`), /Tenant must belong/);
    await assert.rejects(db.exec(`UPDATE retail_invoices SET total=1 WHERE id='${first.id}'`), /cannot be changed/);
    await assert.rejects(db.exec(`DELETE FROM retail_invoices WHERE id='${first.id}'`), /cannot be deleted/);
    await db.exec(`UPDATE retail_invoices SET status='paid' WHERE id='${first.id}'`);
    await db.exec(`SET test.locked = 'yes'`);
    await assert.rejects(charge('2026-10-01'), /Period locked/);
    assert.equal((await db.query('SELECT * FROM retail_invoices')).rows.length, 1, 'failed journal rolls back the invoice');
    await db.exec(`SET test.locked = 'no'; UPDATE school_rental_properties SET tenant_id=NULL`);
    await assert.rejects(charge('2026-10-01'), /with a tenant/);
    assert.equal((await charge('2026-09-01')).rows[0].customer_name, 'First tenant', 'historical invoice survives vacancy');
    await db.exec(`INSERT INTO retail_invoices(customer_name) VALUES ('Unrelated invoice'); DELETE FROM retail_invoices WHERE rental_property_id IS NULL`);
    assert.equal((await db.query('SELECT * FROM retail_invoices')).rows.length, 1, 'ordinary invoice deletion is unchanged');
    await db.exec(`GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT ON staff,retail_customers,gl_accounts TO authenticated; SET ROLE authenticated;`);
    assert.equal((await db.query('SELECT * FROM school_rental_properties')).rows.length, 1);
    await assert.rejects(db.exec(`INSERT INTO school_rental_properties(organization_id,name,monthly_rent,revenue_account_id)
      VALUES ('10000000-0000-0000-0000-000000000002','Forbidden',100,'30000000-0000-0000-0000-000000000001')`));
  } finally { await db.close(); }
});
