import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/components/CashRoomRegisterPage.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260815120000_cash_room_register.sql", import.meta.url), "utf8");
const nav = await readFile(new URL("../src/lib/simpleOrgNavigation.ts", import.meta.url), "utf8");

test("cash room register shows all open stays and protects reservation check-ins", () => {
  assert.match(page, /actual_check_out/);
  assert.match(page, /dateInTimeZone/);
  assert.match(page, /registerDate/);
  assert.match(page, /reservationId/);
  assert.match(page, /Reservation check-in/);
  assert.match(page, /occupied_by_other_workflow/);
  assert.match(nav, /Cash room register/);
});

test("cash register posts occupancy, daily bill, discount and default cash payment", () => {
  assert.match(page, /paid: true/);
  assert.match(page, /save_cash_room_register_entry/);
  assert.match(migration, /billing_mode IN \('automatic','cash_register'\)/);
  assert.match(migration, /COALESCE\(s\.billing_mode,'automatic'\)<>'cash_register'/);
  assert.match(migration, /create_journal_entry_atomic/);
  assert.match(migration, /payments_completed_billing_uq|billing_id=v_billing/);
});
