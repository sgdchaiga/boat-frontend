import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("reports use configured product units and never expose the ea code", async () => {
  const [report, formatter] = await Promise.all([
    readFile(new URL("src/components/reports/DailyPurchasesSummaryPage.tsx", root), "utf8"),
    readFile(new URL("src/lib/unitOfMeasure.ts", root), "utf8"),
  ]);

  assert.match(report, /purchase_order_items\(product_id, description, quantity, cost_price\)/);
  assert.match(report, /select\("id,unit_of_measure"\)/);
  assert.match(report, /formatUnitOfMeasure\(product\.unit_of_measure\)/);
  assert.doesNotMatch(report, /unit:\s*"ea"/);
  assert.match(formatter, /ea:\s*"Each"/);
  assert.match(formatter, /pcs:\s*"Pieces"/);
});
