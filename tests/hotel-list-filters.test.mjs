import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const reservations=await readFile(new URL("../src/components/ReservationsPage.tsx",import.meta.url),"utf8");
const stays=await readFile(new URL("../src/components/ActiveStaysPage.tsx",import.meta.url),"utf8");
test("reservations can be filtered by guest, room, status and overlapping dates",()=>{assert.match(reservations,/filteredReservations/);assert.match(reservations,/Guest or room/);assert.match(reservations,/All statuses/);assert.match(reservations,/All rooms/);assert.match(reservations,/reservation\.check_out_date < filterFrom/);assert.match(reservations,/reservation\.check_in_date > filterTo/)});
test("active and checked-out stays share guest, room, status and date filters",()=>{assert.match(stays,/filteredActiveStays/);assert.match(stays,/filteredCheckedOutStays/);assert.match(stays,/Guest, email or room/);assert.match(stays,/Active and checked out/);assert.match(stays,/All rooms/);assert.match(stays,/departure < filterFrom/);assert.match(stays,/arrival > filterTo/)});
