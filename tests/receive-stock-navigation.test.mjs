import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const simpleNav = await readFile(new URL("../src/lib/simpleOrgNavigation.ts", import.meta.url), "utf8");
const catalog = await readFile(new URL("../src/lib/reportHubCatalog.ts", import.meta.url), "utf8");
const reportsPage = await readFile(new URL("../src/components/ReportsPage.tsx", import.meta.url), "utf8");

test("receive-stock register is directly available under stock", () => {
  assert.match(simpleNav, /Receive stock \/ GRN bills[^\n]+purchases_bills/);
});

test("receive-stock register is directly available from reports", () => {
  assert.match(catalog, /PURCHASES_PAGES[\s\S]*?"purchases_bills"/);
  assert.match(simpleNav, /Goods received & supplier bills[^\n]+purchases_bills/);
  assert.match(reportsPage, /onNavigate\?\.\("purchases_bills"\)/);
});
