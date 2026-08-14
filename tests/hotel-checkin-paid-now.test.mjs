import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/components/ReservationsPage.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260814213000_hotel_checkin_paid_now.sql", import.meta.url), "utf8");

test("check-in defaults to a user-confirmed matching payment", () => {
  assert.match(page, /useState\(true\)/);
  assert.match(page, /First room charge paid now/);
  assert.match(page, /p_paid_now: checkInPaidNow/);
  assert.match(page, /p_payment_method: checkInPaymentMethod/);
});

test("check-in payment is linked, idempotent and method-aware", () => {
  assert.match(migration, /billing_id uuid REFERENCES public\.billing/);
  assert.match(migration, /payments_completed_billing_uq/);
  assert.match(migration, /pos_mtn_mobile_money_gl_account_id/);
  assert.match(migration, /pos_airtel_money_gl_account_id/);
  assert.match(migration, /hotel_check_in_reservation_with_payment/);
});

test("midday billing is excluded from automatic payment", () => {
  assert.doesNotMatch(migration, /run_hotel_midday_billing_for_org/);
  assert.match(page, /Daily midday room charges are not marked paid automatically/);
});
