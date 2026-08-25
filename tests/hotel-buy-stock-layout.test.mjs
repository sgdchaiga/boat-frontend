import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/components/purchases/PurchaseOrdersPage.tsx", import.meta.url),
  "utf8"
);

test("school procurement presentation is scoped away from hotel buy stock", () => {
  assert.match(source, /const isSchool = String\(user\?\.business_type/);
  assert.match(source, /\{isSchool && <nav[^>]+>School/);
  assert.match(source, /isSchool \? [^:]+ : <h1[^>]*>Buy stock<\/h1>/);
  assert.match(source, /isSchool \? "Direct Purchase" : "Simple"/);
  assert.match(source, /isSchool \? "Purchase Order" : "Advanced"/);
  assert.match(source, /isSchool \? "New Purchase Order" : "Record purchase"/);
  assert.match(source, /isSchool \? "Receive Goods" : "Receive stock"/);
});
