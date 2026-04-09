/**
 * Script to show POS transactions (kitchen_orders) for the last 2 days.
 * Run from project root: node scripts/show-pos-transactions.mjs
 * Requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Load .env if present
const envPath = resolve(root, '.env');
if (existsSync(envPath)) {
  const env = readFileSync(envPath, 'utf8');
  env.split('\n').forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const supabase = createClient(url, key);

const from = new Date();
from.setDate(from.getDate() - 2);
from.setHours(0, 0, 0, 0);
const to = new Date();
to.setTime(to.getTime() + 2 * 60 * 1000);

const fromStr = from.toISOString();
const toStr = to.toISOString();

console.log('\n--- POS Transactions (Last 2 Days) ---');
console.log('From:', fromStr, '| To:', toStr);
console.log('');

const { data: orders, error } = await supabase
  .from('kitchen_orders')
  .select(`
    id,
    customer_name,
    table_number,
    order_status,
    created_at,
    kitchen_order_items(
      quantity,
      notes,
      products(name, sales_price)
    )
  `)
  .gte('created_at', fromStr)
  .lt('created_at', toStr)
  .order('created_at', { ascending: true });

if (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

if (!orders || orders.length === 0) {
  console.log('No POS transactions in the last 2 days.');
  process.exit(0);
}

let total = 0;
orders.forEach((o) => {
  const items = o.kitchen_order_items || [];
  const orderTotal = items.reduce(
    (sum, it) => sum + (it.quantity || 0) * Number(it.products?.sales_price ?? 0),
    0
  );
  total += orderTotal;
  console.log(`Order ${o.id.slice(0, 8)} | ${o.created_at}`);
  console.log(`  Customer: ${o.customer_name || 'Walk-in'} | Table: ${o.table_number || 'POS'} | Status: ${o.order_status}`);
  items.forEach((it) => {
    const price = it.products?.sales_price ?? 0;
    const lineTotal = (it.quantity || 0) * Number(price);
    console.log(`  - ${it.quantity}x ${it.products?.name || 'Item'} ${it.notes ? `(${it.notes})` : ''} = $${lineTotal.toFixed(2)}`);
  });
  console.log(`  Order total: $${orderTotal.toFixed(2)}`);
  console.log('');
});

console.log('---');
console.log(`Total orders: ${orders.length} | Total amount: $${total.toFixed(2)}`);
