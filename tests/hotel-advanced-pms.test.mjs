import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("advanced PMS is opt-in and defaults off for existing organizations", async () => {
  const [config, migration] = await Promise.all([read("src/lib/hotelConfig.ts"), read("supabase/migrations/20260814200000_advanced_pms_opt_in.sql")]);
  assert.match(config, /pms_full_enabled: false/);
  assert.match(migration, /COALESCE\(\(p_config->>'pms_full_enabled'\)::boolean,false\)/);
  assert.match(migration, /IF NOT v_enabled THEN/);
});

test("advanced PMS provides the recommended operational control registers", async () => {
  const migration = await read("supabase/migrations/20260814200000_advanced_pms_opt_in.sql");
  for (const table of ["hotel_pms_room_blocks","hotel_pms_rate_controls","hotel_pms_guest_deposits","hotel_pms_work_orders","hotel_pms_inspections","hotel_pms_period_closes"]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  assert.match(migration, /Room is held by an active PMS room block/);
  assert.match(migration, /stop-sell for the requested dates/);
  assert.match(migration, /hotel accounting period is closed/);
});

test("PMS records stay tenant scoped and writes are limited to operational roles", async () => {
  const security = await read("supabase/migrations/20260814201000_advanced_pms_role_security.sql");
  assert.match(security, /organization_id IN \(SELECT s\.organization_id/);
  assert.match(security, /s\.role IN \(''super_admin'',''admin'',''manager'',''receptionist'',''accountant'',''supervisor''\)/);
});

test("advanced PMS is hidden from navigation until the organization enables it", async () => {
  const [nav, layout, admin, page] = await Promise.all([read("src/lib/simpleOrgNavigation.ts"),read("src/components/Layout.tsx"),read("src/components/admin/AdminHotelConfigPage.tsx"),read("src/components/PmsAdvancedPage.tsx")]);
  assert.match(nav, /allowAdvancedPms \? \[\{ name: "Advanced PMS"/);
  assert.match(layout, /advancedPmsEnabled/);
  assert.match(admin, /Enable Advanced PMS workspace/);
  for (const label of ["Groups & room blocks","Rates & inventory","Guest deposits","Maintenance","Room inspections","Period close"]) assert.match(page, new RegExp(label.replace(/[&]/g,"&")));
});
