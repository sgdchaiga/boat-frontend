import test from "node:test";
import assert from "node:assert/strict";
import { nextProductionOrderSerial, nextProductionLineSerial } from "../src/lib/productionSerial.ts";

test("new orders advance the main number and restart their lines", () => {
  assert.equal(nextProductionOrderSerial([]), "1_1");
  const first = nextProductionOrderSerial(["27_6", "27_7"]);
  assert.equal(first, "28_1");
  const second = nextProductionLineSerial(first);
  assert.equal(second, "28_2");
  assert.equal(nextProductionOrderSerial(["27_7", first, second]), "29_1");
});

test("date ordering and legacy serials do not reset the order counter", () => {
  assert.equal(nextProductionOrderSerial(["12_4", "29_2", "27_7"]), "30_1");
  assert.equal(nextProductionOrderSerial([null, "", "27", "unassigned"]), "28_1");
  assert.equal(nextProductionLineSerial("28_9"), "28_10");
});
