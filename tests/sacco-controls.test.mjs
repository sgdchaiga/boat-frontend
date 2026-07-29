import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

async function importTypeScriptModule(path) {
  const input = await source(path);
  const output = ts.transpileModule(input, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("flat loan payment includes principal and flat interest", async () => {
  const { calculateMonthlyPayment } = await importTypeScriptModule("src/lib/saccoLoanMath.ts");
  assert.equal(calculateMonthlyPayment(1_200_000, 12, 12, "flat"), 112_000);
  assert.equal(calculateMonthlyPayment(0, 12, 12, "flat"), 0);
});

test("declining schedule clears principal without a negative balance", async () => {
  const { calculateMonthlyPayment, buildLoanAmortizationSchedule } =
    await importTypeScriptModule("src/lib/saccoLoanMath.ts");
  const payment = calculateMonthlyPayment(5_000_000, 18, 24, "declining");
  const rows = buildLoanAmortizationSchedule({
    amount: 5_000_000,
    interestRate: 18,
    term: 24,
    interestBasis: "declining",
    monthlyPayment: payment,
  });
  assert.equal(rows.length, 24);
  assert.equal(rows.at(-1).balance, 0);
  assert.equal(rows.reduce((sum, row) => sum + row.principal, 0), 5_000_000);
  assert.ok(rows.every((row) => row.principal >= 0 && row.interest >= 0 && row.balance >= 0));
});

test("teller posting rules contain balanced operational and reversal pairs", async () => {
  const db = await source("src/lib/saccoTellerDb.ts");
  for (const expected of [
    '{ gl_account_id: cashId, debit: amount, credit: 0',
    '{ gl_account_id: cp, debit: 0, credit: amount',
    '{ gl_account_id: cp, debit: amount, credit: 0',
    '{ gl_account_id: cashId, debit: 0, credit: amount',
    "postReversalJournalForPostedTellerTxn",
    "insertCashbookReversalForTellerTxn",
  ]) assert.match(db, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("maker-checker is enforced in UI, service, and database", async () => {
  const [page, db, migration] = await Promise.all([
    source("src/components/sacco/SaccoTellerPage.tsx"),
    source("src/lib/saccoTellerDb.ts"),
    source("supabase/migrations/20260724120000_sacco_prevent_self_approval.sql"),
  ]);
  assert.match(page, /disabled=\{!canMutate \|\| saving \|\| isMaker\}/);
  assert.match(db, /cannot approve a transaction that you entered/i);
  assert.match(db, /\.neq\("maker_staff_id", params\.checkerStaffId\)/);
  assert.match(migration, /NEW\.checker_staff_id = NEW\.maker_staff_id/);
});

test("teller retries use an organization-scoped unique idempotency key", async () => {
  const [hook, db, migration] = await Promise.all([
    source("src/components/sacco/hooks/useTellerCompleteTransaction.ts"),
    source("src/lib/saccoTellerDb.ts"),
    source("supabase/migrations/20260724130000_sacco_teller_idempotency.sql"),
  ]);
  assert.match(hook, /pendingIdempotencyKeyRef/);
  assert.match(db, /code === "23505"/);
  assert.match(db, /\.eq\("idempotency_key", params\.idempotencyKey\)/);
  assert.match(migration, /\(organization_id, idempotency_key\)/);
});

test("posted corrections require a reason and retain reversal audit fields", async () => {
  const db = await source("src/lib/saccoTellerDb.ts");
  assert.match(db, /A reason is required for transaction corrections/);
  assert.match(db, /status: "reversed"/);
  assert.match(db, /reversed_by_staff_id: params\.editorStaffId/);
  assert.match(db, /correction_reason: reason/);
  assert.match(db, /corrects_txn_id: ex\.id/);
});

test("ordinary SACCO roles do not receive transaction-correction rights", async () => {
  const permissions = await source("src/lib/permissions.ts");
  assert.match(
    permissions,
    /permission === "sacco_transaction_edit"\) return roleKey === "admin" \|\| roleKey === "manager" \|\| roleKey === "accountant"/
  );
});
