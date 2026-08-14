import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("hotel charts hide only unused unrelated template accounts", async () => {
  const migration = await readFile(
    new URL("supabase/migrations/20260814150000_curate_hotel_chart_of_accounts.sql", root),
    "utf8"
  );

  assert.match(migration, /bt IN \('hotel', 'hospitality'\)/);
  assert.match(migration, /'4130', '4150'/);
  assert.match(migration, /'5130', '5131'.*'5136'/s);
  assert.match(migration, /'6800', '6810'.*'6819'/s);
  assert.match(migration, /NOT EXISTS \(\s*WITH RECURSIVE account_tree/s);
  assert.match(migration, /JOIN public\.journal_entry_lines jel ON jel\.gl_account_id = account_node\.id/);
  assert.doesNotMatch(migration, /DELETE FROM public\.gl_accounts/i);
  assert.match(migration, /WHERE lower\(COALESCE\(business_type, ''\)\) IN \('hotel', 'hospitality'\)/);
});
