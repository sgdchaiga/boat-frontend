import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20260815150000_room_types_rls_super_admin.sql", import.meta.url), "utf8");

test("room type management recognizes organization and platform super admins", () => {
  assert.match(migration, /caller_is_org_super_admin_for\(organization_id\)/);
  assert.match(migration, /is_platform_admin\(\)/);
  assert.match(migration, /'admin','manager','super_admin'/);
  assert.match(migration, /s\.organization_id=room_types\.organization_id/);
  assert.match(migration, /organization_id IS NOT NULL/);
});
