import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reservations = await readFile(new URL("../src/components/ReservationsPage.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260815241000_enforce_stay_checkout_after_checkin.sql", import.meta.url), "utf8");
const sameDayMigration = await readFile(new URL("../supabase/migrations/20260815242000_fix_same_day_hotel_checkout.sql", import.meta.url), "utf8");

test("reservation checkout cannot be selected before check-in", () => {
  assert.match(reservations, /min=\{form\.check_in_date \|\| undefined\}/);
  assert.match(reservations, /form\.check_out_date > checkInDate/);
});

test("stay checkout ordering is enforced in the database", () => {
  assert.match(migration, /CHECK \(actual_check_out IS NULL OR actual_check_out >= actual_check_in\)/);
});

test("same-day checkout compares local dates instead of noon to the precise check-in time", () => {
  assert.match(sameDayMigration, /v_checkin_date := \(v_stay\.actual_check_in AT TIME ZONE v_timezone\)::date/);
  assert.match(sameDayMigration, /IF p_checkout_date < v_checkin_date THEN/);
  assert.match(sameDayMigration, /GREATEST\(v_checkout, v_stay\.actual_check_in\)/);
  assert.doesNotMatch(sameDayMigration, /IF v_checkout < v_stay\.actual_check_in/);
});
