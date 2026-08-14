import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const report = await readFile(new URL("../src/components/reports/RoomBillingReportPage.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260814210000_hotel_billing_registers_and_cash_account_cleanup.sql", import.meta.url), "utf8");

test("room reconciliation loads charges and cash by the organization's stay IDs", () => {
  assert.match(report, /get_hotel_room_reconciliation_register/);
  assert.match(migration, /JOIN public\.stays s ON s\.id=b\.stay_id/);
  assert.match(migration, /public\.payments p WHERE p\.stay_id=s\.id/);
});

test("billing organization is repaired and maintained from its stay", () => {
  assert.match(migration, /WHERE s\.organization_id=v_org/);
  assert.match(migration, /get_hotel_billing_register/);
});

test("reconciliation shows record dates and supports operational filters", () => {
  assert.match(report, /Stay dates/);
  assert.match(report, /Billing dates/);
  assert.match(report, /Guest or room/);
  assert.match(report, /Needs review/);
});
