import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Execute the production allocator with database reads replaced by fixtures.
const journal = await readFile(new URL("../src/lib/journal.ts", import.meta.url), "utf8");
const start = journal.indexOf("async function buildBillDebitLines(");
const end = journal.indexOf("/** Asset GL for vendor prepayment", start);
assert.ok(start >= 0 && end > start);
const compiled = ts.transpile(journal.slice(start, end), { target: ts.ScriptTarget.ES2022 });

function allocator(items, products = [], departmentSettings = new Map()) {
  const supabase = {
    from(table) {
      const result = { data: table === "purchase_order_items" ? items : products, error: null };
      return { select: () => ({ eq: async () => result, in: async () => result }) };
    },
  };
  return new Function("supabase", "roundMoney", "loadPosDepartmentGlMap",
    `${compiled}; return buildBillDebitLines;`)(supabase, n => Math.round(n * 100) / 100, async () => departmentSettings);
}

test("unlinked purchase lines cannot fall back to Salaries Admin", async () => {
  const build = allocator([{ product_id: null, description: "Steel", quantity: 1, cost_price: 20467000 }]);
  await assert.rejects(build(20467000, "From Purchase Order", "po", { expense: "salaries" }, "org"), /not linked to an item/);
});

test("mixed bills reject unlinked lines even when other items have inventory accounts", async () => {
  const build = allocator([
    { product_id: "steel", quantity: 1, cost_price: 100 },
    { product_id: null, description: "Unknown", quantity: 1, cost_price: 50 },
  ], [{ id: "steel", name: "Steel", stock_account: "inventory", department_id: null }]);
  await assert.rejects(build(150, null, "po", { expense: "salaries" }, "org"), /Unknown.*not linked/);
});

test("linked items retain inventory allocation and the full bill total", async () => {
  const build = allocator([
    { product_id: "steel", quantity: 1, cost_price: 100 },
    { product_id: "paint", quantity: 1, cost_price: 200 },
  ], [
    { id: "steel", name: "Steel", stock_account: "raw-materials", department_id: null },
    { id: "paint", name: "Paint", stock_account: null, department_id: "factory" },
  ], new Map([["factory", { stock: "factory-inventory" }]]));
  const lines = await build(301, null, "po", { expense: "salaries" }, "org");
  assert.deepEqual(lines.map(l => [l.glAccountId, l.amount]), [["raw-materials", 100.33], ["factory-inventory", 200.67]]);
  assert.equal(lines.reduce((sum, line) => sum + line.amount, 0), 301);
});
