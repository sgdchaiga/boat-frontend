import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("production document dependencies use maintained patched packages", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.match(pkg.dependencies.jspdf, /^\^4\./);
  assert.match(pkg.dependencies["pdfjs-dist"], /^\^6\./);
  assert.match(pkg.dependencies.xlsx, /^npm:@e965\/xlsx@/);
  assert.equal(pkg.dependencies.pptxgenjs, undefined);
  assert.equal(pkg.overrides.dompurify, "3.4.13");
});

test("hotel configuration is persisted centrally and hydrated per organization", async () => {
  const [config, layout, migration] = await Promise.all([
    read("src/lib/hotelConfig.ts"),
    read("src/components/Layout.tsx"),
    read("supabase/migrations/20260814180000_hotel_central_config_and_audit_eligibility.sql"),
  ]);
  assert.match(config, /save_organization_hotel_config/);
  assert.match(config, /hotel_config/);
  assert.match(layout, /hydrateHotelConfig/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS hotel_config jsonb/);
});

test("high-volume hotel reports retrieve complete paged result sets", async () => {
  const files = await Promise.all([
    read("src/components/BillingPage.tsx"),
    read("src/components/ActiveStaysPage.tsx"),
    read("src/components/reports/RoomBillingReportPage.tsx"),
  ]);
  for (const source of files) {
    assert.match(source, /fetchAllPages/);
    assert.doesNotMatch(source, /\.limit\((?:30|500|1000|10000)\)/);
  }
});

test("scheduled and database night audits share one hotel eligibility rule", async () => {
  const [edge, migration] = await Promise.all([
    read("supabase/functions/run-daily-room-charges/index.ts"),
    read("supabase/migrations/20260814180000_hotel_central_config_and_audit_eligibility.sql"),
  ]);
  assert.match(edge, /eligible_hotel_night_audit_organizations/);
  assert.match(migration, /business_type IN \('hotel','mixed'\)/);
  assert.match(migration, /WHERE public\.organization_is_hotel_enabled\(id\)/);
});
