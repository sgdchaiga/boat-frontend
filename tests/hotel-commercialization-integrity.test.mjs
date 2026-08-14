import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20260814160000_hotel_commercialization_integrity.sql", import.meta.url), "utf8");
const reservations = await readFile(new URL("../src/components/ReservationsPage.tsx", import.meta.url), "utf8");
const stays = await readFile(new URL("../src/components/ActiveStaysPage.tsx", import.meta.url), "utf8");
const billing = await readFile(new URL("../src/components/BillingPage.tsx", import.meta.url), "utf8");

test("room names and numbers are unique inside an organization, not globally", () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS room_types_name_key/);
  assert.match(migration, /room_types \(organization_id, lower\(name\)\)/);
  assert.match(migration, /rooms \(organization_id, lower\(room_number\)\)/);
});

test("reservation overlap is serialized and rejected in the database", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /daterange\(r\.check_in_date, r\.check_out_date, '\[\)'\)[\s\S]*&& daterange/);
  assert.match(migration, /trg_enforce_hotel_reservation_availability/);
});

test("front desk uses atomic check-in and checkout RPCs", () => {
  assert.match(reservations, /rpc\("hotel_check_in_reservation"/);
  assert.doesNotMatch(reservations, /from\("stays"\)\s*\.insert\(insertPayload\)/);
  assert.match(stays, /rpc\("hotel_check_out_stay"/);
});

test("manual folio changes use one atomic billing and journal RPC", () => {
  assert.match(billing, /rpc\("save_hotel_folio_charge"/);
  assert.doesNotMatch(billing, /createJournalForRoomCharge|syncRoomChargeJournal/);
  assert.match(migration, /create_journal_entry_atomic\(/);
  assert.match(migration, /Configure hotel receivable and revenue accounts before posting room charges/);
});
