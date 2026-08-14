import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/components/purchases/BillsPage.tsx", import.meta.url), "utf8");

test("receive-stock report supports persistent column visibility", () => {
  assert.match(page, /BILL_COLUMN_STORAGE_KEY/);
  assert.match(page, /visibleColumns\.paidOffDate/);
  assert.match(page, /Show columns/);
  assert.match(page, /window\.localStorage\.setItem/);
  assert.match(page, /Show all/);
});
