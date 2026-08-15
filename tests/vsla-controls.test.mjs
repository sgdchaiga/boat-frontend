import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("VSLA financial postings use atomic database functions", async () => {
  const [migration, consensusMigration, meetings, repayments, loans, savings] = await Promise.all([
    source("supabase/migrations/20260815123000_vsla_atomic_posting_controls.sql"),
    source("supabase/migrations/20260815239000_vsla_consensus_meeting_loans.sql"),
    source("src/components/vsla/VslaMeetingsPage.tsx"),
    source("src/components/vsla/VslaRepaymentsPage.tsx"),
    source("src/components/vsla/VslaLoansPage.tsx"),
    source("src/components/vsla/VslaSavingsPage.tsx"),
  ]);

  for (const fn of [
    "vsla_disburse_loan",
    "vsla_post_loan_repayment",
    "vsla_set_member_meeting_shares",
  ]) {
    assert.match(migration, new RegExp(`FUNCTION public\\.${fn}`));
  }
  assert.match(consensusMigration, /FUNCTION public\.vsla_record_meeting_loan/);
  assert.match(meetings, /rpc\("vsla_record_meeting_loan"/);
  assert.match(meetings, /"vsla_post_loan_repayment"/);
  assert.match(meetings, /"vsla_set_member_meeting_shares"/);
  assert.match(repayments, /Consolidated repayment history/);
  assert.doesNotMatch(repayments, /p_meeting_id: null/);
  assert.match(loans, /VSLA Loan Register/);
  assert.doesNotMatch(loans, /Approve/);
  assert.match(savings, /"vsla_set_member_meeting_shares"/);
});

test("repayments are restricted to disbursed loans", async () => {
  const [migration, integrityMigration, page] = await Promise.all([
    source("supabase/migrations/20260815123000_vsla_atomic_posting_controls.sql"),
    source("supabase/migrations/20260815240000_vsla_loan_ledger_integrity.sql"),
    source("src/components/vsla/VslaRepaymentsPage.tsx"),
  ]);
  assert.match(migration, /v_loan\.status <> 'disbursed'/);
  assert.match(integrityMigration, /Repayments must be recorded during an open VSLA meeting/);
  assert.match(integrityMigration, /balance_after/);
  assert.match(page, /Consolidated repayment history/);
  assert.doesNotMatch(page, /l\.status === "approved"/);
});

test("closed meetings cannot be mutated through VSLA posting functions", async () => {
  const migration = await source(
    "supabase/migrations/20260815123000_vsla_atomic_posting_controls.sql",
  );
  assert.match(migration, /Closed meetings cannot be changed/);
  assert.match(migration, /status <> 'closed'/);
});

test("share-out is scoped to one active cycle and locks finalized records", async () => {
  const [migration, page] = await Promise.all([
    source("supabase/migrations/20260815233000_vsla_cycles_and_controlled_shareout.sql"),
    source("src/components/vsla/VslaShareOutPage.tsx"),
  ]);
  assert.match(migration, /uq_vsla_one_active_cycle/);
  assert.match(migration, /uq_vsla_finalized_shareout_cycle/);
  assert.match(migration, /FUNCTION public\.vsla_finalize_shareout/);
  assert.match(migration, /Closed VSLA cycle records are locked/);
  assert.match(migration, /Resolve outstanding loans before finalizing share-out/);
  assert.match(migration, /ALTER TABLE public\.vsla_cashbox_snapshots ADD COLUMN IF NOT EXISTS cycle_id/);
  assert.match(page, /\.eq\("cycle_id", activeCycle\?\.id/);
  assert.match(page, /rpc\("vsla_finalize_shareout"/);
  assert.match(page, /Preview Finalization/);
});

test("dashboard and reports use cycle-scoped operational data", async () => {
  const [dashboard, reports] = await Promise.all([
    source("src/components/vsla/VslaDashboardPage.tsx"),
    source("src/components/vsla/VslaReportsPage.tsx"),
  ]);
  assert.match(dashboard, /\.eq\("cycle_id", cycleId\)/);
  assert.match(dashboard, /Continue Open Meeting/);
  assert.match(reports, /Reporting Cycle/);
  assert.match(reports, /Loan Aging/);
  assert.doesNotMatch(reports, /can be added next/i);
});

test("guided meeting workflow persists progress and gates closure", async () => {
  const [migration, page] = await Promise.all([
    source("supabase/migrations/20260815234000_vsla_guided_meeting_workflow.sql"),
    source("src/components/vsla/VslaMeetingsPage.tsx"),
  ]);
  assert.match(migration, /completed_steps text\[\]/);
  assert.match(migration, /FUNCTION public\.vsla_mark_meeting_step/);
  assert.match(migration, /Complete all meeting workflow steps before closing/);
  assert.match(migration, /FUNCTION public\.vsla_save_meeting_cash_reconciliation/);
  assert.match(page, /All Present/);
  assert.match(page, /Save Reconciliation & Complete Step/);
  assert.match(page, /Close and Lock Meeting/);
  assert.match(page, /allWorkflowStepsComplete/);
});

test("meeting governance requires quorum, signatories and finalized minutes", async () => {
  const [migration, page, meetings] = await Promise.all([
    source("supabase/migrations/20260815235000_vsla_minutes_governance.sql"),
    source("src/components/vsla/VslaMeetingMinutesPage.tsx"),
    source("src/components/vsla/VslaMeetingsPage.tsx"),
  ]);
  assert.match(migration, /FUNCTION public\.vsla_save_structured_minutes/);
  assert.match(migration, /Quorum has not been met/);
  assert.match(migration, /Chairperson and secretary must confirm/);
  assert.match(migration, /Finalize the meeting minutes before closing/);
  assert.match(migration, /split_part\(name, '\/', 1\) = public\.auth_staff_org_id\(\)::text/);
  assert.match(page, /Saving draft/);
  assert.match(page, /Resolutions & Actions/);
  assert.match(page, /uploadVslaMeetingMinutesFile/);
  assert.match(page, /printMinutes/);
  assert.match(meetings, /minutesFinal/);
});

test("phase 3 reports and confirmations are accessible and exportable", async () => {
  const [migration, reports, dialog, savings, funds] = await Promise.all([
    source("supabase/migrations/20260815236000_vsla_phase3_reporting_scope.sql"),
    source("src/components/vsla/VslaReportsPage.tsx"),
    source("src/components/common/ConfirmActionDialog.tsx"),
    source("src/components/vsla/VslaSavingsPage.tsx"),
    source("src/components/vsla/VslaFundsPage.tsx"),
  ]);
  assert.match(migration, /ALTER TABLE public\.vsla_meeting_attendance/);
  assert.match(reports, /downloadXlsx/);
  assert.match(reports, /exportAccountingPdf/);
  assert.match(reports, /role="tablist"/);
  assert.match(reports, /Search this report/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(savings, /ConfirmActionDialog/);
  assert.match(funds, /ConfirmActionDialog/);
  assert.doesNotMatch(`${savings}\n${funds}`, /\bconfirm\(/);
});
