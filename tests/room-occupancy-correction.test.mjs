import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const rooms=await readFile(new URL("../src/components/RoomsPage.tsx",import.meta.url),"utf8");
test("occupied rooms explain and correct the underlying open stay",()=>{assert.match(rooms,/actual_check_out", null/);assert.match(rooms,/Correct occupancy \/ release room/);assert.match(rooms,/hotel_check_out_stay/);assert.match(rooms,/Close stay and release room/)});
test("occupancy correction preserves housekeeping choice",()=>{assert.match(rooms,/Cleaning required/);assert.match(rooms,/Available now/);assert.match(rooms,/update\(\{ status: correctionRoomStatus \}\)/);assert.match(rooms,/Checkout cannot be before check-in/)});
