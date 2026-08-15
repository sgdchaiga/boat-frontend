import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reservations = await readFile(new URL("../src/components/ReservationsPage.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260815241000_enforce_stay_checkout_after_checkin.sql", import.meta.url), "utf8");

test("reservation checkout cannot be selected before check-in", () => {
  assert.match(reservations, /min=\{form\.check_in_date \|\| undefined\}/);
  assert.match(reservations, /form\.check_out_date > checkInDate/);
});

test("stay checkout ordering is enforced in the database", () => {
  assert.match(migration, /CHECK \(actual_check_out IS NULL OR actual_check_out >= actual_check_in\)/);
});
