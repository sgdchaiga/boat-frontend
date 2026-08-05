import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("general business is eligible for the existing manufacturing module", async () => {
  const access = await source("src/lib/moduleAccess.ts");
  assert.match(access, /audience === "production"[\s\S]*businessType === "general_business"/);
});

test("general business exposes Process Stock through inventory", async () => {
  const navigation = await source("src/lib/simpleOrgNavigation.ts");
  assert.match(navigation, /name: "Process Stock", page: "manufacturing_production_entries", state: \{ manufacturingMode: "simple" \}/);
});

test("cashbook mode keeps manufacturing available", async () => {
  const layout = await source("src/components/Layout.tsx");
  assert.match(layout, /allowManufacturing \? \[\{ name: 'Process Stock', page: 'manufacturing_production_entries', state: \{ manufacturingMode: 'simple' \} \}\]/);
  assert.match(layout, /allowManufacturing \? \[\{ name: 'Manufacturing', icon: Factory/);
});

test("simple processing posts actual quantity in through the manufacturing engine", async () => {
  const ui = await source("src/components/manufacturing/ManufacturingProductionEntriesPage.tsx");
  const sql = await source("supabase/migrations/20260805170000_manufacturing_simple_processing.sql");
  assert.match(ui, />Quantity in</);
  assert.match(ui, />\{simpleMode \? "Quantity out"/);
  assert.match(sql, /NEW\.processing_mode = 'simple'/);
  assert.match(sql, /'manufacturing_consumption', NEW\.id, 0, NEW\.quantity_in/);
  assert.match(sql, /direct_processing_cost/);
});

test("scrap wording is industry neutral", async () => {
  const ui = await source("src/components/manufacturing/ManufacturingProductionEntriesPage.tsx");
  const accounts = await source("src/lib/journalAccountSettings.ts");
  assert.doesNotMatch(ui, /Scrap metal quantity/);
  assert.match(ui, /Scrap \/ by-product quantity/);
  assert.match(accounts, /scrap \/ by-product inventory/);
});
