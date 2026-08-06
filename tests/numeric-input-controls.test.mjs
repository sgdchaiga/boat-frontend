import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("numeric input normalization handles leading zeroes globally", async () => {
  const helper = await source("src/lib/numericInput.ts");
  assert.match(helper, /input\.type !== "number"/);
  assert.match(helper, /normalizeNumericInputValue/);
  assert.match(helper, /input\.select\(\)/);
  assert.doesNotMatch(helper, /addEventListener\("input"/);
  const main = await source("src/main.tsx");
  assert.match(main, /installNumericInputConvenience\(\)/);
});

test("Process Stock quantities start blank", async () => {
  const form = await source("src/components/manufacturing/ManufacturingProductionEntriesPage.tsx");
  assert.match(form, /const \[quantityIn, setQuantityIn\] = useState\(""\)/);
  assert.match(form, /const \[producedQty, setProducedQty\] = useState\(""\)/);
  assert.match(form, /const \[directProcessingCost, setDirectProcessingCost\] = useState\(""\)/);
});
