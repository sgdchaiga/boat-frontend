import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const ledger = await readFile(new URL("src/lib/poGrnStock.ts", root), "utf8");
const bills = await readFile(new URL("src/components/purchases/BillsPage.tsx", root), "utf8");

test("bill stock receipts retain the bill date when posted or edited", () => {
  assert.match(ledger, /receiptDate\?: string \| null/);
  assert.match(ledger, /businessDayRangeForDateString\(receiptDate\)/);
  assert.match(bills, /postStockInFromPurchaseOrderForBill\(bill\.id, bill\.purchase_order_id, bill\.bill_date\)/);
  assert.match(bills, /postStockInFromPurchaseOrderForBill\(bill\.id, bill\.purchase_order_id, next\.billDate\)/);
});
