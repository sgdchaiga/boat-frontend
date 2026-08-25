import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const adjustmentPage = fs.readFileSync(
  new URL("../src/components/admin/AdminStockAdjustmentsPage.tsx", import.meta.url),
  "utf8"
);
const stockImport = fs.readFileSync(
  new URL("../src/lib/stockBulkImport.ts", import.meta.url),
  "utf8"
);

test("manual stock adjustments reload item balances for the selected effective date", () => {
  assert.match(adjustmentPage, /loadStockSnapshot\(nextDate\)/);
  assert.match(adjustmentPage, /currentQty = stock\[row\.product_id\] \?\? 0/);
  assert.match(adjustmentPage, /Current Qty is shown as at this date/);
});

test("dated balances use supplier bill dates instead of legacy receipt posting dates", () => {
  assert.match(stockImport, /\.select\("id,bill_date"\)/);
  assert.match(stockImport, /applySupplierBillDates\(movementRows, organizationId, isSuperAdmin\)/);
  assert.match(stockImport, /movement\.movement_date = `\$\{billDate\}T12:00:00\.000Z`/);
});
