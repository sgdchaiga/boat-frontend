import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("PO item journals capitalize stock and reserve COGS for stock reductions", async () => {
  const [journal, repairMigration] = await Promise.all([
    readFile(new URL("src/lib/journal.ts", root), "utf8"),
    readFile(new URL("supabase/migrations/20260814140000_capitalize_grn_inventory_and_repair_cogs.sql", root), "utf8"),
  ]);

  assert.match(journal, /select\("id, name, department_id"\)/);
  assert.match(journal, /departmentGl\.get\(product\.departmentId\)\?\.stock/);
  assert.match(journal, /has no department\. Assign a department and its stock account/);
  assert.match(journal, /belongs to a department with no stock account mapping/);
  assert.match(journal, /Item department inventory \(GRN\)/);
  assert.match(journal, /posting was stopped to prevent COGS or generic-account fallback/);
  assert.doesNotMatch(journal, /const isService = row\.product_id \? trackById\.get/);
  assert.match(repairMigration, /repair_po_bill_inventory_account_journals/);
  assert.match(repairMigration, /dgs\.stock_gl_account_id IS NULL/);
  assert.match(repairMigration, /department_name \|\| ' inventory \(GRN\)'/);
  assert.match(repairMigration, /reference_type = 'stock_adjustment'/);
});
