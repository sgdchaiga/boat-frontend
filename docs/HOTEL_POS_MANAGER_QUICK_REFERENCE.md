# Hotel POS Manager Quick Reference

Use this guide for oversight, approvals, and control actions in Hotel POS.

## 1) Manager Responsibilities

- Supervise order flow from cart to kitchen to payment.
- Approve sensitive actions (void/refund/overrides).
- Ensure posted transactions match operational reality.
- Enforce role-based access and PIN controls.

## 2) Approval and Override Rules

- Waiters must escalate sensitive edits/refunds to manager/supervisor.
- Use Manager PIN only for valid, documented reasons.
- Never approve without a clear reason captured in the system.
- Refunded transactions are locked after refund state is applied.

## 3) Posted Transaction Controls

- Open `Posted Hotel POS Transactions` for selected date.
- Review fields before save:
  - Amount
  - Payment method
  - Payment status
  - Void/refund reason (when required)
- Confirm `Last Edit` details for audit traceability.
- Reject or reverse improper changes immediately.

## 4) Queue and Service Oversight

- Monitor `Order Queue` by status/station (Kitchen/Bar/Dessert).
- Ensure delayed tickets are actioned quickly.
- Authorize edits only for genuine corrections.
- Prevent repeated modifications on same order without cause.

## 5) Billing and Settlement Checks

- Verify `Pay Now` entries reconcile to cash/card/mobile totals.
- Verify `Bill to Room` entries map to correct active stays.
- Review `Credit Sale` entries and ensure follow-up collection.
- Spot-check printed bills against cart totals and posted amounts.

## 6) Security and Data Discipline

- Do not share manager credentials or PIN.
- Ensure each staff user operates with own account.
- Confirm organization-bound data visibility only.
- Escalate any cross-hotel or cross-tenant data anomaly immediately.

## 7) End-of-Day Manager Checklist

- All active sessions reviewed; completed sessions closed.
- No unexplained pending/preparing orders left in queue.
- Posted payment totals reconciled with tender summaries.
- Voids/refunds reviewed with reasons and approver accountability.
- Exceptions documented for finance/admin follow-up.

## 8) Escalation Triggers

- Duplicate or suspicious payment edits.
- Missing reason for void/refund request.
- Unmatched bill-to-room charge.
- Repeated user access or role misuse.
- Any suspected data leakage across hotels.

---

Audience: Managers / Supervisors / Accountants  
Module: Hotel POS  
Version: 1.0
