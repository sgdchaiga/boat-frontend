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

test("v1.2 foundation keeps legacy opt-in and protects its financial event ledger", async () => {
  const [migration, organizations] = await Promise.all([
    source("supabase/migrations/20261119100000_vsla_v12_workflow_and_controls_foundation.sql"),
    source("src/components/platform/PlatformOrganizationsPage.tsx"),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.vsla_workflow_settings/);
  assert.match(migration, /workflow_version IN \('legacy', 'v1_2'\)/);
  assert.match(migration, /FUNCTION public\.set_vsla_workflow_version/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.vsla_financial_events/);
  assert.match(migration, /WHERE organization_id=v_org AND idempotency_key=p_idempotency_key/);
  assert.match(migration, /VSLA v1\.2 financial events are immutable; post a reversal instead/);
  assert.match(migration, /REVOKE ALL ON public\.vsla_financial_events FROM authenticated/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.vsla_audit_events/);
  assert.match(migration, /FUNCTION public\.vsla_v12_post_financial_event/);
  assert.match(organizations, /set_vsla_workflow_version/);
  assert.match(organizations, /v1\.2 controlled/);
});

test("v1.2 restricted actions use independent approval and reversal-only correction", async () => {
  const migration = await source("supabase/migrations/20261119110000_vsla_v12_approvals_and_reversals.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.vsla_approval_policies/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.vsla_financial_approval_requests/);
  assert.match(migration, /FUNCTION public\.vsla_v12_create_financial_draft/);
  assert.match(migration, /FUNCTION public\.vsla_v12_submit_financial_draft/);
  assert.match(migration, /FUNCTION public\.vsla_v12_decide_financial_approval/);
  assert.match(migration, /Maker and checker must be different users/);
  assert.match(migration, /This action requires a draft and independent approval/);
  assert.match(migration, /FUNCTION public\.vsla_v12_reverse_financial_event/);
  assert.match(migration, /A reversal reason is required/);
  assert.match(migration, /OLD\.status='posted' AND NEW\.status='reversed'/);
  assert.match(migration, /USING \(public\.is_platform_admin\(\)\)/);
  assert.match(migration, /Baseline policies are installed when an organization enters v1\.2/);
});

test("v1.2 meeting workspace calculates cash server-side and preserves legacy routing", async () => {
  const [migration, router, workspace, app] = await Promise.all([
    source("supabase/migrations/20261119120000_vsla_v12_meeting_cash_reconciliation.sql"),
    source("src/components/vsla/VslaMeetingWorkflowRouter.tsx"),
    source("src/components/vsla/VslaV12MeetingWorkspace.tsx"),
    source("src/App.tsx"),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.vsla_v12_cash_reconciliations/);
  assert.match(migration, /FUNCTION public\.vsla_v12_open_meeting/);
  assert.match(migration, /FUNCTION public\.vsla_v12_reconcile_meeting_cash/);
  assert.match(migration, /FROM public\.vsla_financial_events WHERE meeting_id=p_meeting_id AND status='posted'/);
  assert.match(migration, /expected_closing_cash/);
  assert.match(router, /LegacyVslaMeetingsPage/);
  assert.match(router, /VslaV12MeetingWorkspace/);
  assert.match(workspace, /vsla_v12_reconcile_meeting_cash/);
  assert.match(app, /VslaMeetingWorkflowRouter/);
});

test("v1.2 blocks legacy financial writes and legacy posting screens", async () => {
  const [migration, gate, app] = await Promise.all([
    source("supabase/migrations/20261119130000_vsla_v12_block_legacy_financial_writes.sql"),
    source("src/components/vsla/VslaV12FinancialWorkflowGate.tsx"),
    source("src/App.tsx"),
  ]);
  assert.match(migration, /FUNCTION public\.vsla_v12_block_legacy_financial_write/);
  assert.match(migration, /Legacy VSLA financial posting is disabled for v1\.2 organizations/);
  assert.match(migration, /vsla_share_transactions/);
  assert.match(migration, /vsla_cycle_shareout/);
  assert.match(gate, /Legacy financial posting is locked/);
  assert.match(app, /VslaV12FinancialWorkflowGate/);
});

test("v1.2 meeting collections validate members, share limits, and idempotency", async () => {
  const [migration, workspace] = await Promise.all([
    source("supabase/migrations/20261119140000_vsla_v12_meeting_collections.sql"),
    source("src/components/vsla/VslaV12MeetingWorkspace.tsx"),
  ]);
  assert.match(migration, /FUNCTION public\.vsla_v12_receive_savings/);
  assert.match(migration, /Maximum shares per meeting/);
  assert.match(migration, /WHERE organization_id=v_org AND idempotency_key=p_idempotency_key/);
  assert.match(migration, /FUNCTION public\.vsla_v12_receive_member_collection/);
  assert.match(migration, /fine_received/);
  assert.match(migration, /social_fund_received/);
  assert.match(workspace, /vsla_v12_receive_savings/);
  assert.match(workspace, /vsla_v12_receive_member_collection/);
  assert.match(workspace, /crypto\.randomUUID/);
});

test("v1.2 loans require approval before disbursement and protect repayment balances", async () => {
  const migration = await source("supabase/migrations/20261119150000_vsla_v12_loans.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.vsla_v12_loans/);
  assert.match(migration, /FUNCTION public\.vsla_v12_request_loan/);
  assert.match(migration, /vsla_v12_submit_financial_draft/);
  assert.match(migration, /status='pending_approval'/);
  assert.match(migration, /status=CASE WHEN p_approve THEN 'disbursed' ELSE 'rejected' END/);
  assert.match(migration, /FUNCTION public\.vsla_v12_receive_loan_repayment/);
  assert.match(migration, /cannot exceed the outstanding balance/);
});

test("v1.2 share-out is calculated from posted events and requires approval", async () => {
 const migration = await source("supabase/migrations/20261119160000_vsla_v12_cash_approval_and_shareout.sql");
 assert.match(migration,/CREATE TABLE IF NOT EXISTS public\.vsla_v12_shareouts/);
 assert.match(migration,/FUNCTION public\.vsla_v12_prepare_shareout/);
 assert.match(migration,/Resolve outstanding v1\.2 loans before share-out/);
 assert.match(migration,/payout_schedule/);
 assert.match(migration,/event_type='shareout_accrual'/);
 assert.match(migration,/status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END/);
});

test("v1.2 cash variances become independent approval requests", async () => {
 const migration = await source("supabase/migrations/20261119170000_vsla_v12_cash_variance_approval.sql");
 assert.match(migration,/FUNCTION public\.vsla_v12_request_cash_variance_approval/);
 assert.match(migration,/'cash_adjustment','draft'/);
 assert.match(migration,/vsla_v12_submit_financial_draft/);
 assert.match(migration,/SET status='reconciled' WHERE approval_request_id=r\.id/);
});

test("v1.2 meeting workspace exposes loan, repayment, and approval actions", async () => {
 const workspace = await source("src/components/vsla/VslaV12MeetingWorkspace.tsx");
 assert.match(workspace,/vsla_v12_request_loan/); assert.match(workspace,/vsla_v12_receive_loan_repayment/); assert.match(workspace,/vsla_v12_decide_financial_approval/); assert.match(workspace,/Approval queue/);
});

test("v1.2 meeting close requires complete attendance, cash, approvals, and minutes", async () => {
 const migration = await source("supabase/migrations/20261119180000_vsla_v12_attendance_and_close.sql");
 assert.match(migration,/FUNCTION public\.vsla_v12_set_attendance/); assert.match(migration,/FUNCTION public\.vsla_v12_close_meeting/); assert.match(migration,/Record attendance for every active member/); assert.match(migration,/Reconcile cash before closing/); assert.match(migration,/Resolve pending approvals before closing/); assert.match(migration,/vsla_save_structured_minutes/);
});

test("v1.2 meeting workspace provides attendance and controlled close UI", async () => {
 const workspace = await source("src/components/vsla/VslaV12MeetingWorkspace.tsx");
 assert.match(workspace,/vsla_v12_set_attendance/); assert.match(workspace,/vsla_v12_close_meeting/); assert.match(workspace,/Mark every active member present or absent/); assert.match(workspace,/Close and lock meeting/);
});

test("v1.2 setup uses a validated configuration RPC", async () => {
 const [migration,page,app]=await Promise.all([source("supabase/migrations/20261119190000_vsla_v12_group_configuration.sql"),source("src/components/vsla/VslaV12SetupPage.tsx"),source("src/App.tsx")]);
 assert.match(migration,/FUNCTION public\.vsla_v12_update_configuration/);assert.match(migration,/Configuration values are invalid/);assert.match(page,/vsla_v12_update_configuration/);assert.match(app,/VslaV12SetupPage/);
});

test("member dashboard exposes only the caller's v1.2 share-out estimate", async () => {
 const [migration,dashboard]=await Promise.all([source("supabase/migrations/20261119200000_vsla_v12_member_shareout_estimate.sql"),source("src/components/vsla/VslaMemberDashboard.tsx")]);
 assert.match(migration,/current_vsla_member_id/);assert.match(dashboard,/vsla_v12_my_shareout_estimate/);assert.match(dashboard,/text\.estimatedShareout/);
});

test("VSLA translation registry supports English and Luganda", async () => {
 const i18n=await source("src/lib/vslaI18n.ts");
 assert.match(i18n,/VslaLanguage/);assert.match(i18n,/language: "Olulimi"/);assert.match(i18n,/estimatedShareout/);
});

test("member portal applies the language registry to primary controls", async () => {
 const dashboard=await source("src/components/vsla/VslaMemberDashboard.tsx");
 assert.match(dashboard,/vslaText/);assert.match(dashboard,/vsla-language/);assert.match(dashboard,/text\.estimatedShareout/);
});

test("members can submit but not alter their own VSLA disputes", async () => {
 const migration=await source("supabase/migrations/20261119210000_vsla_member_disputes.sql");
 assert.match(migration,/CREATE TABLE IF NOT EXISTS public\.vsla_member_disputes/);assert.match(migration,/vsla_member_disputes_self_insert/);assert.doesNotMatch(migration,/GRANT SELECT,INSERT,UPDATE,DELETE ON public\.vsla_member_disputes/);
});

test("members can request statements, profile changes, and reminders without self-approval", async () => {
 const migration=await source("supabase/migrations/20261119220000_vsla_member_service_requests.sql");
 assert.match(migration,/request_type IN\('statement','profile_update','meeting_reminder'\)/);assert.match(migration,/vsla_member_service_requests_self_insert/);
});

test("member requests have role-gated decisions, immutable audit events, and v1.2 screens", async () => {
 const [migration,controls,reports,shareout]=await Promise.all([
  source("supabase/migrations/20261119230000_vsla_request_resolution_controls.sql"),source("src/components/vsla/VslaControlsPage.tsx"),source("src/components/vsla/VslaReportsPage.tsx"),source("src/components/vsla/VslaShareOutPage.tsx")
 ]);
 assert.match(migration,/FUNCTION public\.vsla_v12_resolve_member_dispute/);assert.match(migration,/FUNCTION public\.vsla_v12_resolve_member_service_request/);assert.match(migration,/vsla_v12_can_resolve_member_request/);assert.match(migration,/VSLA audit events are immutable/);
 assert.match(controls,/Required resolution note/);assert.match(controls,/Read-only submission details/);assert.match(controls,/vsla_v12_resolve_member_dispute/);
 assert.match(reports,/VslaV12ReportsPage/);assert.match(shareout,/VslaV12ShareOutPage/);
});

test("v1.2 offline collections remain encrypted, provisional, idempotent, and reviewable", async () => {
  const [queue, workspace, setup, migration, repaymentMigration, serviceWorker] = await Promise.all([
    source("src/lib/vslaOfflineQueue.ts"),
    source("src/components/vsla/VslaV12MeetingWorkspace.tsx"),
    source("src/components/vsla/VslaV12SetupPage.tsx"),
    source("supabase/migrations/20261119240000_vsla_v12_offline_device_controls.sql"),
    source("supabase/migrations/20261119250000_vsla_v12_offline_loan_repayment.sql"),
    source("public/sw.js"),
  ]);
  assert.match(queue, /AES-GCM/);
  assert.match(queue, /indexedDB\.open/);
  assert.match(queue, /meeting-snapshots/);
  assert.match(queue, /saveVslaOfflineMeetingSnapshot/);
  assert.match(queue, /idempotencyKey/);
  assert.match(queue, /status: "rejected"/);
  assert.match(queue, /transientConnectionFailure/);
  assert.match(queue, /discardRejectedVslaOfflineCollection/);
  assert.match(queue, /vsla_v12_sync_offline_collection/);
  assert.match(workspace, /Offline · transactions are provisional/);
  assert.match(workspace, /not in the ledger or cash total/);
  assert.match(workspace, /provisional offline repayment/);
  assert.match(workspace, /readVslaOfflineMeetingSnapshot/);
  assert.match(workspace, /Using encrypted meeting context saved/);
  assert.match(workspace, /Sync or resolve every provisional offline collection before closing the meeting/);
  assert.match(workspace, /Rejected by the server/);
  assert.match(workspace, /Remove rejected local record/);
  assert.match(migration, /uq_vsla_v12_one_active_offline_device/);
  assert.match(migration, /FUNCTION public\.vsla_v12_designate_offline_device/);
  assert.match(migration, /FUNCTION public\.vsla_v12_sync_offline_collection/);
  assert.match(migration, /This device is not designated for VSLA offline collection sync/);
  assert.match(repaymentMigration, /FUNCTION public\.vsla_v12_sync_offline_loan_repayment/);
  assert.match(repaymentMigration, /vsla_v12_receive_loan_repayment/);
  assert.match(setup, /Designate this device/);
  assert.match(setup, /vsla_v12_designate_offline_device/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);
});
