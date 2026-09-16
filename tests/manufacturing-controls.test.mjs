import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const root = new URL('../', import.meta.url);
const sql = (path) => readFile(new URL(path, root), 'utf8');
const one = async (query, args = []) => (await db.query(query, args)).rows[0];

before(async () => {
  db = new PGlite();
  await db.exec(await sql('tests/fixtures/manufacturing-base.sql'));
  await db.exec(await sql('supabase/migrations/20260805170000_manufacturing_simple_processing.sql'));
  const files = (await readdir(new URL('supabase/migrations/', root))).filter((name) => /^20260915\d+_.*\.sql$/.test(name)).sort();
  for (const file of files) await db.exec(await sql('supabase/migrations/' + file));
});
after(async () => { await db?.close(); });

async function fixture() {
  const { id: org } = await one('INSERT INTO organizations DEFAULT VALUES RETURNING id');
  await db.query("SELECT set_config('test.organization_id', $1, false)", [org]);
  const { id: product } = await one("INSERT INTO products(organization_id,name,manufacturing_item_type) VALUES($1,'Output','finished_product') RETURNING id", [org]);
  const { id: material } = await one("INSERT INTO products(organization_id,name,cost_price) VALUES($1,'Input',5) RETURNING id", [org]);
  const { id: bom } = await one("INSERT INTO manufacturing_boms(organization_id,product_id,product_name,materials) VALUES($1,$2,'Output',$3) RETURNING id", [org, product, JSON.stringify([{ item_id: material, item_name: 'Input', qty: 2, unit: 'kg' }])]);
  const { id: order } = await one("INSERT INTO manufacturing_work_orders(organization_id,bom_id,product_name,planned_qty) VALUES($1,$2,'Output',10) RETURNING id", [org, bom]);
  await db.query("INSERT INTO product_stock_movements(organization_id,product_id,quantity_in,unit_cost,movement_date) VALUES($1,$2,100,5,'2020-01-01')", [org, material]);
  return { org, product, material, bom, order };
}
async function lot(f, number, status = 'available', expiry = '2030-12-31') {
  return (await one('INSERT INTO product_lots(organization_id,product_id,lot_number,status,expires_on) VALUES($1,$2,$3,$4,$5) RETURNING id', [f.org, f.product, number, status, expiry])).id;
}
async function receipt(f, lotId, qty, date = '2026-01-01') {
  await db.query('INSERT INTO product_stock_movements(organization_id,product_id,lot_id,quantity_in,movement_date) VALUES($1,$2,$3,$4,$5)', [f.org, f.product, lotId, qty, date]);
}
async function sale(f, qty, note = 'Sale') {
  await db.query("INSERT INTO product_stock_movements(organization_id,product_id,quantity_out,source_type,movement_date,note) VALUES($1,$2,$3,'sale','2026-09-15',$4)", [f.org, f.product, qty, note]);
}

test('order-linked production consumes its saved recipe; order-free production uses current BOM', async () => {
  const f = await fixture();
  await db.query('UPDATE manufacturing_boms SET materials=$1 WHERE id=$2', [JSON.stringify([{ item_id: f.material, item_name: 'Input', qty: 7, unit: 'kg' }]), f.bom]);
  const linked = await one("INSERT INTO manufacturing_production_entries(organization_id,work_order_id,product_id,product_name,produced_qty) VALUES($1,$2,$3,'Output',3) RETURNING id", [f.org, f.order, f.product]);
  assert.equal(Number((await one("SELECT quantity_out FROM product_stock_movements WHERE source_id=$1 AND source_type='manufacturing_consumption'", [linked.id])).quantity_out), 6);
  const direct = await one("INSERT INTO manufacturing_production_entries(organization_id,product_id,product_name,produced_qty) VALUES($1,$2,'Output',1) RETURNING id", [f.org, f.product]);
  assert.equal(Number((await one("SELECT quantity_out FROM product_stock_movements WHERE source_id=$1 AND source_type='manufacturing_consumption'", [direct.id])).quantity_out), 7);
  assert.equal(Number((await one('SELECT material_cost FROM manufacturing_costing_entries WHERE production_entry_id=$1', [linked.id])).material_cost), 30);
});

test('job transitions preserve the first start time, require block reasons and prevent reopening completion', async () => {
  const f = await fixture();
  await db.query("UPDATE manufacturing_work_orders SET status='In Progress' WHERE id=$1", [f.order]);
  const { id } = await one("INSERT INTO manufacturing_job_cards(organization_id,work_order_id,sequence_no,operation_name) VALUES($1,$2,1,'Mix') RETURNING id", [f.org, f.order]);
  await assert.rejects(db.query("UPDATE manufacturing_job_cards SET status='Completed' WHERE id=$1", [id]), /Invalid job status/);
  const started = await one("UPDATE manufacturing_job_cards SET status='In Progress' WHERE id=$1 RETURNING started_at", [id]);
  await assert.rejects(db.query("UPDATE manufacturing_job_cards SET status='Blocked' WHERE id=$1", [id]), /requires a reason/);
  await db.query("UPDATE manufacturing_job_cards SET status='Blocked',block_reason='Power interruption',actual_minutes=12 WHERE id=$1", [id]);
  const resumed = await one("UPDATE manufacturing_job_cards SET status='In Progress',started_at='2100-01-01' WHERE id=$1 RETURNING started_at", [id]);
  assert.equal(String(resumed.started_at), String(started.started_at));
  const completed = await one("UPDATE manufacturing_job_cards SET status='Completed',actual_minutes=25 WHERE id=$1 RETURNING completed_at", [id]);
  assert.ok(completed.completed_at);
  await assert.rejects(db.query("UPDATE manufacturing_job_cards SET status='In Progress' WHERE id=$1", [id]), /Completed job cards/);
});

test('sales consume earliest-expiring available lots and preserve an untracked remainder', async () => {
  const f = await fixture();
  const later = await lot(f, 'Later', 'available', '2027-01-01');
  const earlier = await lot(f, 'Earlier', 'available', '2026-10-01');
  await receipt(f, earlier, 2); await receipt(f, later, 3); await receipt(f, null, 4);
  await sale(f, 7);
  const movements = (await db.query("SELECT lot_id,quantity_out FROM product_stock_movements WHERE organization_id=$1 AND source_type='sale'", [f.org])).rows;
  assert.equal(movements.length, 3);
  assert.equal(Number(movements.find((row) => row.lot_id === earlier).quantity_out), 2);
  assert.equal(Number(movements.find((row) => row.lot_id === later).quantity_out), 3);
  assert.equal(Number(movements.find((row) => row.lot_id === null).quantity_out), 2);
  assert.equal(Number((await one('SELECT sum(quantity_in-quantity_out) AS balance FROM product_stock_movements WHERE product_id=$1', [f.product])).balance), 2);
});

test('held, expired and future stock cannot cover a sale, and failed allocations roll back', async () => {
  const f = await fixture();
  await receipt(f, await lot(f, 'Held', 'on_hold'), 10);
  await receipt(f, await lot(f, 'Expired', 'available', '2026-01-02'), 10);
  await receipt(f, await lot(f, 'Future'), 10, '2027-01-01');
  const available = await lot(f, 'Available'); await receipt(f, available, 1);
  await assert.rejects(sale(f, 2, '[LOT_ALLOCATED]'), /Insufficient eligible/);
  assert.equal(Number((await one("SELECT count(*) AS count FROM product_stock_movements WHERE organization_id=$1 AND source_type='sale'", [f.org])).count), 0);
  await sale(f, 1);
  assert.equal(Number((await one("SELECT quantity_out FROM product_stock_movements WHERE organization_id=$1 AND source_type='sale'", [f.org])).quantity_out), 1);
});

test('missing organization identity cannot invoke reservation, release or lot assignment', async () => {
  const f = await fixture(); const lotId = await lot(f, 'Assignment');
  await db.query("SELECT set_config('test.organization_id', '', false)");
  await assert.rejects(db.query('SELECT reserve_manufacturing_work_order_materials($1)', [f.order]), /Not permitted/);
  await assert.rejects(db.query('SELECT release_manufacturing_work_order($1)', [f.order]), /Not permitted/);
  await assert.rejects(db.query('SELECT assign_untracked_stock_to_lot($1,1)', [lotId]), /Not permitted/);
});

test('an explicitly selected held sales lot is rejected', async () => {
  const f = await fixture(); const lotId = await lot(f, 'Held direct', 'on_hold');
  await receipt(f, lotId, 10);
  await assert.rejects(db.query("INSERT INTO product_stock_movements(organization_id,product_id,lot_id,quantity_out,source_type,movement_date) VALUES($1,$2,$3,1,'sale','2026-09-15')", [f.org, f.product, lotId]), /held, rejected or expired/);
});

test('a small sale selects the earliest expiry even when the later lot was created first', async () => {
  const f = await fixture();
  const later = await lot(f, 'Later first', 'available', '2027-01-01');
  const earlier = await lot(f, 'Earlier second', 'available', '2026-10-01');
  await receipt(f, later, 10); await receipt(f, earlier, 10); await sale(f, 1);
  assert.equal((await one("SELECT lot_id FROM product_stock_movements WHERE organization_id=$1 AND source_type='sale'", [f.org])).lot_id, earlier);
});

test('release requires reserved materials and creates one job card per routing step', async () => {
  const f = await fixture();
  await db.query("INSERT INTO manufacturing_routing_operations(organization_id,bom_id,sequence_no,operation_name) VALUES($1,$2,1,'Mix'),($1,$2,2,'Pack')", [f.org, f.bom]);
  await assert.rejects(db.query('SELECT release_manufacturing_work_order($1)', [f.order]), /Reserve all/);
  await db.query('SELECT reserve_manufacturing_work_order_materials($1)', [f.order]);
  await db.query('SELECT release_manufacturing_work_order($1)', [f.order]);
  assert.equal(Number((await one('SELECT count(*) AS count FROM manufacturing_job_cards WHERE work_order_id=$1', [f.order])).count), 2);
  await assert.rejects(db.query('SELECT release_manufacturing_work_order($1)', [f.order]), /Only planned/);
});

test('an inspection without a lot cannot authorize rework for an unrelated lot', async () => {
  const f = await fixture(); const lotId = await lot(f, 'Unrelated');
  const inspection = await one("INSERT INTO manufacturing_quality_inspections(organization_id,inspection_type,status) VALUES($1,'finished_goods','failed') RETURNING id", [f.org]);
  await assert.rejects(db.query("INSERT INTO manufacturing_quality_rework(organization_id,inspection_id,lot_id,action,reason) VALUES($1,$2,$3,'rework','Check')", [f.org, inspection.id, lotId]), /same lot/);
});
