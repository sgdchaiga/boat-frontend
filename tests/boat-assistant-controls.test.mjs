import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("BOAT Assistant is independently controlled by Super Admin and defaults off", async () => {
  const flagSql = await source("supabase/migrations/20260807120000_organizations_enable_boat_assistant.sql");
  const platform = await source("src/components/platform/PlatformOrganizationsPage.tsx");
  const auth = await source("src/contexts/AuthContext.tsx");
  assert.match(flagSql, /enable_assistant boolean NOT NULL DEFAULT false/);
  assert.match(platform, /toggleOrgModule\(org\.id, "enable_assistant"/);
  assert.match(auth, /enable_assistant: org\?\.enable_assistant === true/);
});

test("assistant records are tenant isolated and require enabled organization", async () => {
  const sql = await source("supabase/migrations/20260807123000_boat_assistant_workflow.sql");
  assert.match(sql, /s\.organization_id = boat_assistant_suggestions\.organization_id/);
  assert.match(sql, /o\.enable_assistant = true/);
  assert.match(sql, /boat_assistant_activity_append/);
  assert.match(sql, /actor_id = \(SELECT auth\.uid\(\)\)/);
});

test("high risk, sensitive, high value and low confidence actions cannot auto process", async () => {
  const risk = await source("src/lib/boatAssistantRisk.ts");
  assert.match(risk, /IRREVERSIBLE/);
  assert.match(risk, /SENSITIVE/);
  assert.match(risk, /highValue/);
  assert.match(risk, /suggestion\.confidence !== "high"/);
  assert.match(risk, /automaticBlocked/);
});

test("transaction suggestions remain unposted drafts and duplicates require review", async () => {
  const service = await source("src/lib/boatAssistantService.ts");
  const guide = await source("src/components/WorkspaceGuide.tsx");
  const expense = await source("src/components/purchases/ExpensesPage.tsx");
  assert.match(service, /const approvalRequired = params\.approvalRequired \|\| duplicate/);
  assert.match(guide, /Nothing has been posted/);
  assert.match(guide, /assistantDraft/);
  assert.match(expense, /Prepared by BOAT Assistant for review/);
  assert.doesNotMatch(expense, /assistantDraft[\s\S]{0,800}saveExpense/);
});

test("approval routing and onboarding activation are role constrained", async () => {
  const workflow = await source("supabase/migrations/20260807123000_boat_assistant_workflow.sql");
  const onboarding = await source("supabase/migrations/20260807130000_boat_assistant_onboarding.sql");
  const guide = await source("src/components/WorkspaceGuide.tsx");
  assert.match(workflow, /s\.role IN \('admin','manager','accountant'\)/);
  assert.match(onboarding, /s\.role IN \('admin','manager'\)/);
  assert.match(guide, /Review proposed configuration/);
  assert.match(guide, /Activate after review/);
});

test("insights cite records and learning handoffs remain separate", async () => {
  const insights = await source("src/lib/boatAssistantInsights.ts");
  const guide = await source("src/components/WorkspaceGuide.tsx");
  assert.match(insights, /sourceLabel/);
  assert.match(guide, /View supporting records/);
  assert.match(guide, /Learn why \/ Show me how/);
  assert.match(guide, /Let BOAT help me do this/);
  assert.match(guide, /Finish or defer the current confirmation/);
});

test("General Business exposes Manual journals in modern and cashbook modes", async () => {
  const simpleNavigation = await source("src/lib/simpleOrgNavigation.ts");
  const layout = await source("src/components/Layout.tsx");
  assert.match(simpleNavigation, /const accounting:[\s\S]{0,500}Manual journals[\s\S]{0,100}accounting_manual/);
  assert.match(layout, /Cashbook entry[\s\S]{0,700}Manual journals[\s\S]{0,200}accounting_manual/);
});

test("General Business Cashbook mode is Super Admin controlled and defaults off", async () => {
  const sql = await source("supabase/migrations/20260807133000_organizations_enable_cashbook_mode.sql");
  const platform = await source("src/components/platform/PlatformOrganizationsPage.tsx");
  const auth = await source("src/contexts/AuthContext.tsx");
  const layout = await source("src/components/Layout.tsx");
  const app = await source("src/App.tsx");
  assert.match(sql, /enable_cashbook_mode boolean NOT NULL DEFAULT false/);
  assert.match(platform, /toggleOrgModule\(org\.id, "enable_cashbook_mode"/);
  assert.match(auth, /enable_cashbook_mode: org\?\.enable_cashbook_mode === true/);
  assert.match(layout, /effectiveGeneralBusinessMode = generalBusinessCashbookEnabled \? generalBusinessMode : 'modern'/);
  assert.match(app, /user\.enable_cashbook_mode !== true/);
  assert.match(app, /currentPage\.startsWith\("general_business_cashbook"\)/);
  assert.match(app, /currentPage === "general_business_daily_summary"/);
});
