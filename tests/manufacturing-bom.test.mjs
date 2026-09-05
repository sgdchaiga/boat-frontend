import test from "node:test";
import assert from "node:assert/strict";
import { preferredBom, hasUsableBom, validateBom, suggestedScrap } from "../src/lib/manufacturingBom.ts";

const bom = {
  id: "b1", product_id: "p1", product_name: "Nails", status: "Draft", version: "v1",
  output_qty: 2, output_unit: "bag", expected_scrap_qty: 0.5,
  materials: [{ item_id: "wire", item_name: "Wire", qty: 50, unit: "kg" }],
};
test("missing and archived-only products are distinguished from usable BOMs", () => {
  assert.equal(hasUsableBom([]), false);
  assert.equal(hasUsableBom([{ ...bom, status: "Archived" }]), false);
  assert.equal(hasUsableBom([bom]), true);
});
test("table chooses the same Active then latest Draft priority as production", () => {
  const active = { ...bom, id: "active", status: "Active", updated_at: "2026-01-01" };
  const draft = { ...bom, updated_at: "2026-09-05" };
  assert.equal(preferredBom([draft, active]).id, "active");
  assert.equal(preferredBom([bom, draft]).updated_at, "2026-09-05");
});
test("BOM saving rejects incomplete and invalid material recipes", () => {
  assert.equal(validateBom(bom), null);
  for (const invalid of [
    { output_qty: 0 }, { output_qty: NaN }, { expected_scrap_qty: -1 },
    { materials: [] }, { materials: [{ ...bom.materials[0], item_id: "" }] },
    { materials: [{ ...bom.materials[0], qty: -5 }] },
    { materials: [bom.materials[0], bom.materials[0]] },
  ]) assert.ok(validateBom({ ...bom, ...invalid }));
});
test("expected scrap scales per batch, including fractions and legacy BOMs", () => {
  assert.equal(suggestedScrap(bom, 6), "1.5");
  assert.equal(suggestedScrap(bom, 1), "0.25");
  assert.equal(suggestedScrap({ output_qty: 1 }, 3), "0");
  assert.equal(suggestedScrap(undefined, 3), "");
  assert.equal(suggestedScrap(bom, 0), "");
});
