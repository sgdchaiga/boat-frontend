import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const report = await readFile(new URL("../src/components/reports/RoomBillingReportPage.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260814123000_fix_room_billing_organization_link.sql", import.meta.url), "utf8");

test("room reconciliation loads charges and cash by the organization's stay IDs", () => {
  assert.match(report, /\.from\("billing"\)[\s\S]*\.in\("stay_id", ids\)/);
  assert.match(report, /\.from\("payments"\)[\s\S]*\.in\("stay_id", ids\)/);
});

test("billing organization is repaired and maintained from its stay", () => {
  assert.match(migration, /UPDATE public\.billing b[\s\S]*FROM public\.stays s/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF stay_id, created_by, organization_id ON public\.billing/);
  assert.match(migration, /b\.organization_id IS DISTINCT FROM s\.organization_id/);
});
