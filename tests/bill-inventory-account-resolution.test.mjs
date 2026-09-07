import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/journal.ts", import.meta.url), "utf8");
const start = source.indexOf("async function buildBillDebitLines(");
const end = source.indexOf("/** Asset GL for vendor prepayment", start);
const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function build(products, departmentEntries = []) {
  const items = products.map(p => ({ product_id: p.id, quantity: 2, cost_price: 50, description: p.name }));
  const supabase = { from(table) {
    const query = {
      select(columns) {
        if (table === "products") assert.ok(columns.includes("stock_account"));
        return query;
      },
      eq() { return Promise.resolve({ data: items, error: null }); },
      in() { return Promise.resolve({ data: products, error: null }); },
    };
    return query;
  } };
  const fn = new Function("supabase", "loadPosDepartmentGlMap", "roundMoney", `${compiled}; return buildBillDebitLines;`)(
    supabase, async () => new Map(departmentEntries), n => Math.round(n * 100) / 100,
  );
  return fn(products.length * 100, "Purchase", "po", { expense: "expense", purchasesInventory: "generic-inventory" }, "org");
}

test("manufacturing raw material uses its assigned inventory account without a Production mapping", async () => {
  const lines = await build([{ id: "wire", name: "1.8 mm drawn wire", department_id: "production", stock_account: "raw-material-inventory" }]);
  assert.deepEqual(lines.map(l => [l.glAccountId, l.departmentId, l.amount]), [["raw-material-inventory", "production", 100]]);
});

test("item inventory overrides department mapping and preserves separate accounts in one department", async () => {
  const lines = await build([
    { id: "books", name: "Books", department_id: "school", stock_account: "books-inventory" },
    { id: "uniforms", name: "Uniforms", department_id: "school", stock_account: "uniform-inventory" },
  ], [["school", { stock: "department-stock" }]]);
  assert.deepEqual(lines.map(l => [l.glAccountId, l.amount]), [["books-inventory", 100], ["uniform-inventory", 100]]);
});

test("assigned item inventory works without a department", async () => {
  const lines = await build([{ id: "books", name: "Books", department_id: null, stock_account: "books-inventory" }]);
  assert.equal(lines[0].glAccountId, "books-inventory");
  assert.equal(lines[0].departmentId, null);
});

test("unassigned items retain department stock fallback", async () => {
  const lines = await build([{ id: "books", name: "Books", department_id: "school", stock_account: null }], [["school", { stock: "school-inventory" }]]);
  assert.equal(lines[0].glAccountId, "school-inventory");
});

test("missing both mappings stops posting instead of using generic inventory", async () => {
  await assert.rejects(build([{ id: "books", name: "Books", department_id: "school", stock_account: null }]), /Assign an inventory account to the item/);
});
