import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("learning schema supports global content, tours, tasks and per-user progress", async () => {
  const sql = await read("supabase/migrations/20260806100000_in_app_learning_foundation.sql");
  for (const table of ["help_articles", "help_tooltips", "guided_tours", "guided_tour_steps", "training_tasks", "user_training_progress"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  }
  assert.match(sql, /user_id=auth\.uid\(\)/);
  assert.match(sql, /organization_id IS NULL OR public\.user_is_member_of_org/);
});

test("learning centre is routed, navigable and permission-aware", async () => {
  const [app, layout, permissions, access] = await Promise.all([
    read("src/App.tsx"), read("src/components/Layout.tsx"), read("src/lib/permissions.ts"), read("src/lib/moduleAccess.ts"),
  ]);
  assert.match(app, /case 'learning_centre'/);
  assert.match(layout, /Help & Learning/);
  assert.match(permissions, /learning_centre/);
  assert.match(access, /learning_centre/);
});

test("reusable learning components support dismissal, tours and progress", async () => {
  const source = await read("src/components/learning/InAppLearning.tsx");
  for (const component of ["PageIntroduction", "HelpTooltip", "GuidedTour", "TrainingProgress"]) {
    assert.match(source, new RegExp(`function ${component}`));
  }
  assert.match(source, /Don't show again/);
  assert.match(source, /content_type/);
});

test("training account reset and certificates are protected", async () => {
  const sql = await read("supabase/migrations/20260806110000_training_account_certificates.sql");
  assert.match(sql, /Kampala Traders Ltd - Training Account/);
  assert.match(sql, /protect_practice_training_client/);
  assert.match(sql, /reset_practice_training_account/);
  assert.match(sql, /issue_training_certificate/);
  assert.match(sql, /user_id=auth\.uid\(\)/);
});
