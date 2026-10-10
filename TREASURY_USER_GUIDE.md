# BOAT Treasury User Guide

## Purpose

Treasury is BOAT's workspace for monitoring and controlling money held in cash, bank, mobile-money, wallet, and float accounts. Use it to review balances, approve and release payments, record transfers, investigate daily movement, and prepare evidence for review or reconciliation.

## Before You Start

1. Confirm that Treasury is enabled for your organization and that your role has access.
2. Ensure the relevant cash, bank, mobile-money, and float accounts exist in the Chart of Accounts.
3. In **Treasury → Cash & transfers → Cash accounts**, confirm that each account is correctly named and active before using it for payments or transfers.
4. Post receipts, expenses, supplier payments, and transfers through the appropriate BOAT workflow. Treasury reports posted activity; drafts and unposted records do not appear as money movement.

## The Treasury Workspace

| Area | Use it for |
| --- | --- |
| Overview | A high-level view of cash-equivalent inflows, outflows, available funds, collections, and fund movements. |
| Money in | Review completed POS and billing collections. |
| Money out | Approve expenses, release supplier payments, and review payment history. |
| Cash & transfers | Maintain Treasury accounts, record account-to-account transfers, review money movement, and complete end-of-day review. |

The global **From** and **To** date filters affect Treasury activity reports. Cash account balances remain current posted balances, rather than historical balances for the selected date range.

## Daily Treasury Routine

1. Open **Treasury → Overview** and review cash-equivalent inflows, gross outflows, funds under management, and pending approvals.
2. Open **Money in** to confirm completed collections are present.
3. Open **Money out** to approve valid Spend Money requests and release approved supplier payments.
4. Open **Cash & transfers → End of day**, choose the date, and review inflows, Spend Money, supplier payments, transfers, and account balances.
5. Count physical cash and compare bank/mobile-money balances with their external statements.
6. Investigate unexpected totals by selecting their blue linked amounts to view the underlying posted entries.

## Managing Cash, Bank, and Other Treasury Accounts

Open **Treasury → Cash & transfers → Cash accounts**.

- A Treasury account is a cash-equivalent GL account: cash, bank, mobile money, wallet, or float.
- Use clear names, for example `Cash Till`, `Stanbic Current Account`, or `MTN Collection Wallet`.
- Mark an account inactive when it must no longer receive new payments or transfers. Its historic activity remains visible.
- Only authorized users should create or edit account definitions.

## Recording Cash Banked and Transfers Between Accounts

Use **Treasury → Cash & transfers → Transfers**.

To record cash being banked:

1. Choose the physical cash account in **From account**.
2. Choose the relevant bank account in **To account**.
3. Enter the amount and actual transfer date.
4. Enter the deposit slip, cheque, or bank reference.
5. Add a short memo, for example `Cash banked from main till`.
6. Select **Post fund transfer**.

BOAT posts one balanced journal: it credits the source account and debits the destination account. The transfer changes the balances of the two accounts but does not change total cash equivalents.

Never use a transfer to record an external payment, supplier payment, or expense. Use the appropriate Money out workflow for those transactions.

## Finding an Account Statement or Transfer History

In **Cash & transfers → Transfers**:

1. Choose a **From** and **To** date.
2. Select the cash or bank account in the **Account** filter.
3. Select **All movements**, **Transfers**, **Inflows**, or **Outflows** in **Movement type**.
4. Review the ledger rows and the totals shown above them.
5. Select **Excel** or **PDF** to export exactly the filtered result.

The export includes the period, selected account, selected movement type, transaction rows, and totals. Use it as a transfer statement or supporting schedule.

For a formal account ledger with opening balance, running balance, and closing balance, use **Accounting → Cash Flow → Account ledger**, select the relevant cash or bank account, choose the period, and export the result.

## Reviewing Spend Money and Supplier Payments

### Approving Spend Money

1. Open **Treasury → Money out → Approvals**.
2. Select **View details** to inspect the payee, purpose, expense lines, account coding, and evidence.
3. Approve only complete, valid requests. Reject incomplete or incorrect requests and record the reason when prompted.
4. An approved item becomes ready for release.

### Releasing a Payment

1. Open **Treasury → Money out → Supplier payments** or the approved request.
2. Select **Release funds**.
3. Choose the payment method and the account funding the payment.
4. Enter the payment date and reference, such as a cheque, bank-transfer, or mobile-money reference.
5. Confirm the release.

Release creates the financial posting. Do not release the same invoice or expense twice.

## End-of-Day Drill-Down

Open **Cash & transfers → End of day** and select the reporting date or period.

The **Outflow breakdown** displays linked totals for:

- Spend Money
- Suppliers
- Other external outflows
- Transfers out

Select a blue amount to open its same-page detail list. The list shows the date, description, accounts touched, and amount for every posted entry included in that total. This is the fastest way to explain a total such as a UGX 29,000 Spend Money balance.

## Reconciliation and Control

Treasury shows BOAT's posted books. A bank or mobile-money statement is an external record. Compare the two regularly.

1. Export or review the account ledger for the period.
2. Obtain the bank or mobile-money statement for the same period.
3. Open **Accounting → Bank Reconciliation**.
4. Select the control account and period, then import or enter the statement lines.
5. Match statement lines to BOAT ledger lines.
6. Resolve unmatched items, such as deposits in transit, bank charges, timing differences, or incorrect postings.
7. Confirm the cashbook and statement sections, then approve the reconciliation when all exceptions are resolved.

## Practical Controls

- Enter references for every transfer and payment; they are essential for tracing and reconciliation.
- Separate the person requesting a payment, the person approving it, and the person releasing it where staffing permits.
- Review inactive and low/negative float accounts routinely.
- Use the date, account, and movement-type filters before exporting. This prevents schedules from mixing unrelated accounts or periods.
- Investigate negative balances and unexpected outflows promptly.
- Do not edit a completed payment merely to change its accounting meaning. Correct errors through the approved correction or reversal process.

## Troubleshooting

| Issue | What to check |
| --- | --- |
| An account is missing from a transfer selector | Confirm it is a cash-equivalent GL account and is active in Treasury. |
| A transfer is not in the ledger | Confirm it was posted successfully, then refresh Treasury and check the date range. |
| The selected account has no rows | Expand the date range and select **All movements**. Check that the account was used on the journal entry. |
| A total does not match an external statement | Use the blue total drill-down and Bank Reconciliation to identify timing differences or missing entries. |
| Excel/PDF export is unavailable | Apply filters that return at least one posted movement. |
| A payment cannot be released | Confirm the request is approved, the funding account is selected and active, and your role has release authority. |

## Expert Checklist

An expert Treasury user can confidently:

- Identify the correct source and destination account for every transfer.
- Record cash banked with a date, amount, memo, and traceable reference.
- Explain every cash-movement total from its underlying entries.
- Produce account-specific Excel or PDF movement schedules.
- Distinguish internal transfers from external receipts and payments.
- Complete daily review and escalate unexpected balances quickly.
- Reconcile BOAT balances to external bank and mobile-money statements.
