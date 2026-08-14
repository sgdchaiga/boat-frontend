import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20260814212000_hotel_checkin_and_midday_room_billing.sql", import.meta.url), "utf8");

test("check-in must create the first room charge", () => {
  assert.match(migration, /AFTER INSERT ON public\.stays/);
  assert.match(migration, /post_hotel_room_night_charge/);
  assert.match(migration, /First-night room charge failed/);
});

test("daily billing posts the current occupied day at local midday", () => {
  assert.match(migration, /hotel_night_audit_time='12:00:00'/);
  assert.match(migration, /run_hotel_midday_billing_for_org\(o\.id,v_local_date,NULL\)/);
  assert.doesNotMatch(migration, /v_local_date-1,NULL/);
});

test("historical missing room charges are repaired idempotently", () => {
  assert.match(migration, /generate_series\(v_first,v_last/);
  assert.match(migration, /st\.organization_id,st\.id,'checkin',st\.checked_in_by,v_day/);
});
