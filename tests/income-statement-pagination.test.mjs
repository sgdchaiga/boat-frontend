import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("income statement fetches every journal-line page for long ranges", async () => {
  const source = await readFile(new URL("src/components/accounting/IncomeStatementPage.tsx", root), "utf8");

  assert.match(source, /const JOURNAL_LINE_PAGE_SIZE = 1000/);
  assert.match(source, /const fetchLinesPage = \(pageFrom: number, pageTo: number\)/);
  assert.match(source, /for \(let pageFrom = 0; ; pageFrom \+= JOURNAL_LINE_PAGE_SIZE\)/);
  assert.match(source, /\.range\(pageFrom, pageTo\)/);
  assert.match(source, /if \(\(data \|\| \[\]\)\.length < JOURNAL_LINE_PAGE_SIZE\) break/);
  assert.match(source, /q\.range\(pageFrom, pageFrom \+ JOURNAL_LINE_PAGE_SIZE - 1\)/);
});
