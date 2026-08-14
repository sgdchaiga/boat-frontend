import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("PO item journals require the item's department purchase account", async () => {
  const [journal, repairMigration] = await Promise.all([
    readFile(new URL("src/lib/journal.ts", root), "utf8"),
    readFile(new URL("supabase/migrations/20260814130000_route_po_items_to_department_purchase_accounts.sql", root), "utf8"),
  ]);

  assert.match(journal, /select\("id, name, department_id"\)/);
  assert.match(journal, /departmentGl\.get\(product\.departmentId\)\?\.purchases/);
  assert.match(journal, /has no department\. Assign a department and its purchase account/);
  assert.match(journal, /belongs to a department with no purchase account mapping/);
  assert.doesNotMatch(journal, /const isService = row\.product_id \? trackById\.get/);
  assert.match(repairMigration, /repair_po_bill_purchase_account_journals/);
  assert.match(repairMigration, /department_name \|\| ' purchases \(GRN\)'/);
  assert.match(repairMigration, /WHEN 'jelly for sauna' THEN '5004'/);
});
