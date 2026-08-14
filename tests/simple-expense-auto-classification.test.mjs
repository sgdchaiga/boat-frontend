import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("simple expenses classify common hotel costs before category defaults", async () => {
  const source = await readFile(new URL("src/components/purchases/ExpensesPage.tsx", root), "utf8");

  assert.match(source, /const SIMPLE_EXPENSE_AUTO_RULES/);
  assert.match(source, /withdraw charge\|withdrawal charge/);
  assert.match(source, /cleaning\|cleaner\|detergent\|soap\|toilet paper/);
  assert.match(source, /plumb\|bomba\|pipe/);
  assert.match(source, /bar purchase\|beverage cost/);
  assert.match(source, /kitchen purchase\|food cost/);
  assert.match(source, /const descriptionMatch = findExpenseGlFromItem/);
  assert.match(source, /if \(descriptionMatch\) return descriptionMatch\.id/);
});
