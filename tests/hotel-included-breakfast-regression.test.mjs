import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("in-house included-breakfast order remains package-covered through place, edit, remove and kitchen settlement", async () => {
  const [pos, kitchen, journal, breakfastSql] = await Promise.all([
    source("src/components/POSPage.tsx"),
    source("src/components/KitchenOrdersPage.tsx"),
    source("src/lib/journal.ts"),
    source("supabase/migrations/20260809190000_allow_included_breakfast_without_recipe.sql"),
  ]);

  // Place: consume the entitlement before releasing the draft ticket.
  assert.match(pos, /rpc\("serve_included_breakfast"/);
  assert.match(pos, /order_status: "draft"/);
  assert.match(pos, /update\(\{ order_status: "pending" \}\)/);
  assert.match(breakfastSql, /INSERT INTO hotel_breakfast_claims/);

  // Edit/remove: persist captured line prices and rebuild the ticket safely.
  assert.match(pos, /from\("kitchen_order_items"\)\.delete\(\)\.eq\("order_id", editingOrderId\)/);
  assert.match(kitchen, /item\.unit_price \?\? item\.products\?\.sales_price/);

  // Settle: a claimed breakfast is covered, and generic POS sync removes any
  // stale POS journal instead of creating restaurant revenue/receivable.
  assert.match(kitchen, /included_breakfast \? total : order\.payments_total/);
  assert.match(journal, /from\("hotel_breakfast_claims"\)[\s\S]*?eq\("kitchen_order_id", orderId\)/);
  assert.match(journal, /if \(breakfastClaim\) \{[\s\S]*?deleteJournalEntryByReference\("pos", orderId, organizationId\)/);
});

test("checkout re-bill and combined folio cash-in reconciliation stay linked to the same stay", async () => {
  const [checkoutSql, billing, reconciliation] = await Promise.all([
    source("supabase/migrations/20260809160000_hotel_automatic_daily_billing_and_checkout_rebill.sql"),
    source("src/components/BillingPage.tsx"),
    source("src/components/reports/RoomBillingReportPage.tsx"),
  ]);

  assert.match(checkoutSql, /correct_hotel_billing_after_checkout_change/);
  assert.match(checkoutSql, /stay_id=NEW\.id AND charge_type='room'/);
  assert.match(checkoutSql, /DELETE FROM billing WHERE id=x\.id/);
  assert.match(billing, /actual_check_out \? " · checked out"/);
  assert.match(reconciliation, /from\("payments"\)\.select\("stay_id,amount"\)\.eq\("payment_status", "completed"\)/);
  assert.match(reconciliation, /balance: billed - paid/);
  assert.match(reconciliation, /nightDifference !== 0 \|\| Math\.abs\(row\.balance\) > 0\.01/);
});
