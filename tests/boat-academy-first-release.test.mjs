import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Academy schema versions content, isolates tenants, and assigns feature training", async () => {
  const sql = await read("supabase/migrations/20261017140000_boat_academy_first_release.sql");
  for (const table of ["academy_courses", "academy_course_versions", "academy_lessons", "academy_lesson_versions", "academy_assignment_rules", "academy_feature_releases", "academy_user_assignments", "academy_lesson_progress", "academy_assessment_attempts"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  }
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /assign_academy_feature_release/);
  assert.match(sql, /trg_academy_assign_releases_to_new_staff/);
  assert.match(sql, /academy_manager_progress/);
});

test("Academy is a shared operational page and keeps contextual learning media configurable", async () => {
  const [access, layout, learning] = await Promise.all([
    read("src/lib/moduleAccess.ts"), read("src/components/Layout.tsx"), read("src/components/learning/LearningCentrePage.tsx"),
  ]);
  assert.match(access, /page === "learning_centre"\) return true/);
  assert.match(layout, /BOAT Academy/);
  assert.match(learning, /academy_manager_progress/);
  assert.match(learning, /Video or screenshot URL/);
});

test("phase 1 seeds operational Academy content for all launch modules", async () => {
  const sql = await read("supabase/migrations/20261017150000_boat_academy_phase1_content.sql");
  for (const course of ["hotel-front-desk-basics", "sacco-member-and-teller-basics", "school-fees-and-collections", "retail-pos-basics", "manufacturing-production-basics", "accounting-period-controls"]) {
    assert.match(sql, new RegExp(course));
  }
  assert.match(sql, /academy_course_versions/);
  assert.match(sql, /help_articles/);
});

test("phase 2 assessment scoring keeps answer keys server-side and issues certificates", async () => {
  const sql = await read("supabase/migrations/20261017160000_boat_academy_phase2_assessments.sql");
  for (const table of ["academy_assessment_questions", "academy_assessment_answers", "academy_certificates", "academy_reminder_outbox"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  assert.match(sql, /get_academy_assessment/);
  assert.match(sql, /submit_academy_assessment/);
  assert.match(sql, /queue_academy_due_reminders/);
});

test("phase 3 keeps walkthroughs, AI session records, and practice attempts separate from live operations", async () => {
  const sql = await read("supabase/migrations/20261017170000_boat_academy_phase3_walkthroughs_practice.sql");
  for (const table of ["academy_walkthroughs", "academy_practice_scenarios", "academy_practice_attempts", "academy_certification_paths", "academy_assistant_sessions"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  assert.match(sql, /submit_academy_practice_scenario/);
  assert.match(sql, /cannot post or modify BOAT operational data/);
});
