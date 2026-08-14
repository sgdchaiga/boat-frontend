import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const treasury=await readFile(new URL("../src/components/treasury/TreasuryPage.tsx",import.meta.url),"utf8");
const migration=await readFile(new URL("../supabase/migrations/20260814210000_hotel_billing_registers_and_cash_account_cleanup.sql",import.meta.url),"utf8");
test("Treasury presents four task-oriented primary sections",()=>{for(const label of ["Overview","Money in","Money out","Cash & transfers"])assert.match(treasury,new RegExp(label));assert.match(treasury,/Supplier payments/);assert.match(treasury,/End of day/)});
test("inactive unused duplicate cash accounts are not presented as live tills",()=>{assert.match(treasury,/setCashAccounts\(nextFundingAccounts/);assert.match(migration,/regexp_replace\(lower\(g\.account_name\)/);assert.match(migration,/NOT EXISTS\(SELECT 1 FROM public\.journal_entry_lines/)});
