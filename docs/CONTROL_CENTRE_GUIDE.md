# BOAT Control Centre Guide

The BOAT Control Centre is a shared register for operational, revenue and cash-control issues. It brings exceptions into one queue so that the right people can see exposure, record a clear reason and follow the issue through to resolution.

## 1. Who uses it

- **Super Admins** currently have exclusive access during the rollout and enable it for subscription plans.
- Organization administrators, managers, internal controllers and other users cannot currently open the Control Centre.
- A future page-access release will allow Super Admins and organization administrators to grant access to selected users, beginning with organization administrators.

## 2. Enable it for an organization

Control Centre is a feature on a subscription plan. It is not a business type.

1. Sign in as a Super Admin.
2. Open **Subscription plans**.
3. Find the plan used by the organization (for example, the Hotel Professional plan).
4. Select **BOAT Control Centre — Enable for this plan**.
5. Ask affected users to refresh the application or sign out and back in.

Every organization on that plan receives the feature. To make an exception for just one organization, use the organization feature override in the platform database administration workflow.

## 3. Open the Control Centre

After the feature is enabled, authorized users will see **Control Centre** in the main navigation.

The opening screen is **Priority exceptions**. It contains:

- **Critical exceptions** — open issues marked critical.
- **Open exceptions** — issues not yet resolved.
- **Overdue** — open issues whose follow-up date has passed.
- **Value at risk** — the total potential financial exposure across open issues.

Use the **Control area** filter to focus on one area, such as Revenue Assurance or Cash & Treasury. Select **Refresh** after creating an issue or after scheduled controls have run.

## 4. Refer an issue manually

Use **Send to Control Centre** when you identify an issue that needs formal follow-up.

1. Select **Send to Control Centre**.
2. Enter a specific title. Example: `Room 204 checked out with unpaid balance`.
3. Choose the most suitable control area:
   - **Operations** — process, service or operational exception.
   - **Revenue assurance** — missing, incorrect or uncollected revenue.
   - **Cash & treasury** — cash, bank, till or reconciliation issue.
   - **Stock control** — stock loss, variance or movement issue.
   - **User & system controls** — access, approval or system-control concern.
4. Set severity:
   - **Critical** — immediate material exposure, suspected fraud or urgent customer/regulatory impact.
   - **High** — significant issue requiring prompt management attention.
   - **Warning** — issue to investigate and correct through normal follow-up.
   - **Low** — minor issue or observation.
5. Enter the potential value at risk, if known. Use `0` when it cannot yet be estimated.
6. Record the facts, transaction references, dates and immediate action taken in **Reason and comments**.
7. Select **Create exception**.

Do not use vague titles such as “problem” or “check this.” State what happened, where it happened and the affected transaction/stay/order where possible.

## 5. Read the priority queue

Each queue row shows:

- An automatically assigned exception reference.
- The exception title and control area.
- Severity and potential value at risk.
- When it was detected.
- Current status.

The queue prioritizes critical items first, then higher value at risk and earlier detection time. Resolve the highest-risk items first, but do not close an issue until the cause, corrective action and evidence have been recorded.

## 6. Automated hotel controls

Scheduled monitoring can add exceptions without a manual referral. The initial hotel control pack checks for:

- A checked-out stay with an outstanding balance.
- An occupied automatic-billing stay with no room charge after two hours.
- Approved POS voids or refunds that require review.
- Reconciliation exceptions that remain unresolved for more than seven days.

These controls run through the configured scheduled monitoring job. A clear queue does not prove that every process is correct; it means no exception matched the implemented checks at that time.

## 7. Good control practice

- Review critical and overdue exceptions at least daily.
- Use the original transaction, stay, POS order or reconciliation record as evidence.
- Record facts separately from assumptions.
- Assign a clear owner and due date when your organization’s workflow is available.
- Escalate suspected fraud, data exposure or material cash loss immediately under your organization’s incident process.
- Do not share accounts or credentials. The audit trail is only useful when each person uses their own account.

## 8. Troubleshooting

### The Control Centre menu is missing

Confirm all of the following:

1. The organization has an active or trial subscription.
2. The organization’s plan has **BOAT Control Centre** enabled in Subscription plans.
3. The user is a Super Admin. Other roles are intentionally excluded during the initial rollout.
4. The user has refreshed their session by signing out and in again.

### The page says it could not load the Control Centre

Confirm that the Control Centre database migrations have been applied and that the user belongs to the active organization. Report the displayed error message to the platform administrator if it continues.

### No automated exceptions appear

Check that the scheduled monitoring job is active, the relevant hotel data exists, and the issue meets a current control rule. Manual referrals can still be created while monitoring is investigated.

---

Audience: Platform administrators, organization administrators, managers and internal controllers  
Module: BOAT Control Centre  
Version: 1.0
