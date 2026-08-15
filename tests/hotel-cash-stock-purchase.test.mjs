import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modal = await readFile(new URL("../src/components/purchases/HotelCashPurchaseModal.tsx", import.meta.url), "utf8");
const bills = await readFile(new URL("../src/components/purchases/BillsPage.tsx", import.meta.url), "utf8");
const nav = await readFile(new URL("../src/lib/simpleOrgNavigation.ts", import.meta.url), "utf8");

test("BOAT exposes a native multi-line cash stock purchase workflow", () => {
  assert.match(nav, /Cash stock purchase/);
  assert.match(bills, /HotelCashPurchaseModal/);
  assert.match(modal, /Add item/);
  assert.match(modal, /quantity \* rate/);
  assert.match(nav, /cashPurchaseOpen: true/);
  assert.doesNotMatch(nav, /isHotelOrMixed \? \[\{ name: "Cash stock purchase"/);
  assert.doesNotMatch(bills, /openCashPurchase && isHotelOrMixed/);
  assert.match(bills, /Cash stock purchase/);
  assert.match(modal, /BOAT inventory/);
});

test("cash stock purchase receives inventory and can pay immediately", () => {
  assert.match(modal, /postStockInFromPurchaseOrderForBill/);
  assert.match(modal, /Pay supplier straight away/);
  assert.match(modal, /createJournalForVendorPayment/);
  assert.match(modal, /queueApprovedBillForTreasury/);
  assert.match(modal, /product_stock_movements/);
});
