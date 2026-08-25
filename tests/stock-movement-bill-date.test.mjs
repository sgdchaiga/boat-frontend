import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/components/reports/StockMovementReportPage.tsx", import.meta.url),
  "utf8"
);

test("stock movement reports legacy bill receipts on the bill date", () => {
  assert.match(source, /supabase\.from\("bills"\)\.select\("id,bill_date"\)/);
  assert.match(source, /const billDateById = new Map/);
  assert.match(source, /sourceType === "bill" && sourceId/);
  assert.match(source, /billDateById\.get\(sourceId\)/);
  assert.match(source, /const mvDate = movementDate\(m\)/);
});
