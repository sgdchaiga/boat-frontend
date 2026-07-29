# BOAT SACCO — Phase 1 Current-State Audit

Date: 24 July 2026  
Scope: React/Vite/TypeScript interface, SACCO routes and workflows, Supabase schema/migrations, RLS, reporting, permissions, and responsive behavior.

## Executive summary

The SACCO module has a substantial working foundation: members, savings accounts, teller sessions, loans, cashbook, reports, audit records, correction workflows, organization scoping, and member self-service. The main operational problem is not missing functionality; it is that functions grew into separate pages and menu items without a single task-oriented experience.

The safest improvement path is to retain existing routes and tables, simplify their presentation, and progressively strengthen transaction controls. No existing SACCO page, table, or migration should be deleted during the first implementation phases.

### Immediate control issue

The teller approval screen currently tells a maker that they may approve or reject their own transaction (`SaccoTellerPage.tsx`, pending-approval panel). The data function that approves a transaction checks its status but does not reject `maker_staff_id === checkerStaffId` (`saccoTellerDb.ts`, `approveTellerTransaction`). This conflicts with the required maker-checker separation and is the highest-priority financial-control correction.

## 1. Current application inventory

### Pages and routes

The application exposes 29 SACCO route identifiers through `saccoproPages.ts`, including:

- Dashboard, overview, and performance dashboard
- Members, member profile, savings account opening/list/statements
- Teller, cashbook, and member app
- Loan application, list, approval, disbursement, dashboard, reports, recovery, servicing, settings, and interest calculation
- Savings settings, interest, fixed deposits, imports, permissions, and financial summaries

Findings:

- Dashboard, overview, performance dashboard, and loan dashboard overlap.
- Savings statements and savings reports reuse substantially the same presentation.
- Loan recovery, arrears ageing, loan reports, and servicing overlap as separate destinations.
- Bulk imports and product configuration were previously presented beside routine work.
- Several legacy routes are still needed for bookmarks and dependencies; route removal is not justified.
- `SaccoOverviewPage` is incomplete as an operational page: its metric values are placeholders.

### Navigation

The original navigation mixed daily work, management reporting, payroll, wallet, staff, imports, accounting, and technical utilities. Phase 1 now presents the requested task structure:

- Home
- Members
- Money In
- Money Out
- Loans
- Approvals
- Reports
- Settings

Existing route identifiers remain intact. Settings and accounting pages are hidden from tellers and loan officers. Teller and loan-officer menus are reduced to role-relevant work.

### Roles and permissions

Recognized roles include Administrator, Manager, Accountant, Loan Officer, and Teller. The system also supports configurable permission records and staff overrides.

| Capability | Teller | Loan Officer | Manager | Accountant | Administrator |
|---|---:|---:|---:|---:|---:|
| Member lookup | Yes | Yes | Yes | Yes | Yes |
| Receive/pay money | Yes | No | Oversight | Oversight | Yes |
| Loan application/assessment | No | Yes | Yes | Read | Yes |
| Approvals | No | No | Yes | As configured | Yes |
| Operational reports | Yes | Yes | Yes | Yes | Yes |
| Accounting records | No | No | Read | Yes | Yes |
| Products/users/permissions | No | No | Limited | Limited | Yes |

Gaps:

- Navigation visibility is role-aware, but page/API enforcement must be verified route by route.
- Manager and accountant are currently grouped for several restricted features even where duties should differ.
- Teller approval self-service violates maker-checker separation.
- Loan approval actions require explicit server-side self-approval prevention and immutable decision history verification.

## 2. Products and member-account structure

The schema supports members, savings product types, member savings accounts, account-number settings, loan products, loans, fixed deposits, branches, and member-app requests.

Strengths:

- Records are organization-scoped.
- Savings accounts are separated from member identity.
- Product configuration and numbering are configurable.
- Member lookup already supports name, account number, and phone in important interfaces.

Gaps:

- Account/product terminology differs across pages.
- Member profile, account list, statements, and member app create multiple ways to view similar information.
- Some product defaults contain board-policy assumptions in code; these must be visibly confirmed rather than silently accepted.
- Savings and loan product imports need preview, validation summary, and explicit administrator-only access.

## 3. Workflow audit

### Teller

Current capabilities include till sessions, opening balances, cash limits, receive/give/transfer desks, approval queues, daily activity, cashbook/GL posting, corrections, and audit logging.

Strengths:

- One open session per staff member is enforced.
- Duplicate-session recovery exists.
- Posted corrections use reversal and replacement.
- Teller audit records are append-only for authenticated users.
- Journal posting uses a source reference for idempotency.

Critical gaps:

- Makers can currently approve their own pending transactions.
- Approval rules are not presented as configurable monetary thresholds in one clear setup area.
- The screen combines teller and supervisor functions, increasing accidental access risk.
- Duplicate submission protection relies on downstream constraints/posting references; the transaction-creation boundary needs a client-generated idempotency key and database uniqueness.
- Payment-method handling is primarily cash/cheque oriented; bank and mobile-money balance presentation is fragmented.

Target flow:

1. Find member.
2. Choose purpose/account.
3. Enter amount and payment method.
4. Review balance and transaction summary.
5. Confirm once.
6. Print/share receipt.

### Loans

The module supports applications, staged approvals, disbursement, repayment information, recovery, modifications, write-offs, and reports.

Gaps:

- Stages are spread across multiple pages rather than shown as one case timeline.
- “Assessment”, guarantors/security, responsible officer, next action, and stage ownership are not consistently prominent.
- Approval and disbursement controls need server-side self-approval checks.
- Interest defaults and board-policy assumptions need clear confirmation.
- Closure, restructure, write-off, and recovery should share one auditable servicing timeline.

### Cashbook and accounting

Teller activity can generate cashbook records and balanced journal entries. Accounting screens remain separate from operational entry.

Gaps requiring transaction-level tests:

- Verify every supported transaction purpose posts to the intended configurable accounts.
- Verify principal, interest, and penalty allocations independently.
- Verify reversals fully compensate savings, cashbook, teller, and GL effects.
- Verify transfers and non-cash payment methods do not incorrectly affect teller cash.
- Confirm provisioning, accrual, supplier-payment, and expense coverage rather than assuming it from generic accounting pages.

## 4. Database and RLS audit

SACCO-specific migrations cover core data, members, accounts, products, teller sessions/transactions, branches, policies, corrections, member access, member requests, and historical imports.

Strengths:

- `organization_id` is widely used for tenant isolation.
- RLS is enabled on teller tables.
- Audit tables restrict ordinary update/delete operations.
- Historical cashbook import is documented as auditable and idempotent.

Risks:

- Early teller RLS policies allow broad `FOR ALL` access based mainly on organization membership. UI hiding is therefore not sufficient for sensitive operations.
- Authenticated users are granted update/delete privileges on teller transaction tables; later application rules compensate for some cases, but database immutability should be explicit.
- Approval, reversal, write-off, and configuration mutations need dedicated RPCs/policies that check role, organization, status transition, and maker/checker identity.
- A policy-by-policy regression test suite is not currently evident.

No migration should be removed. New control migrations should be additive, idempotent, and include rollback notes.

## 5. Reports and responsive behavior

Available reporting covers loans, ageing, collections, savings statements, performance ratios, financial summaries, annual accounts, teller summaries, and PDF output.

Gaps:

- Filters are inconsistent across report pages.
- Branch, product, teller, loan officer, and status are not uniformly available.
- Export/print controls are not consistently implemented through the shared toolbar.
- Required PAR 1/30/60/90, provisioning/write-off, exception, and complete audit reports need coverage verification.
- Large tables need consistent mobile card views and low-resolution laptop layouts.
- Offline caching exists in the member app, but staff workflows need clearer retry and stale-data states for slow connections.

## 6. Page-by-page disposition

| Existing page(s) | Recommendation |
|---|---|
| Dashboard / Overview / Performance | Make Dashboard the operational home; retain Performance under Reports; retire Overview from navigation but keep its route. |
| Members / Profile / Account list / Statements | Present as one Members journey with profile tabs; keep current components during refactor. |
| Teller | Split ordinary teller task view from supervisor approval/oversight view. |
| Cashbook | Keep restricted under Accounting & Administration. |
| Loans dashboard/input/list | Present as Loans home, application wizard, and case list. |
| Loan approval/disbursement | Surface through Approvals with distinct authority checks. |
| Recovery/reports/servicing | Group under Loans and Reports; reuse one loan timeline. |
| Savings settings/interest | Keep under restricted Settings. |
| Bulk imports | Administrator-only Settings tool with preview and validation. |
| Member app/client dashboard | Keep as a separate member-facing interface. |
| Financial summaries/annual accounts | Keep under Reports for managers/accountants. |

## 7. Proposed implementation plan

### Quick wins

1. Simplified, role-aware navigation — completed.
2. Prevent teller self-approval in UI and database/API.
3. Add operational dashboard quick actions and remove placeholder/duplicate destinations.
4. Replace technical labels in ordinary-user views.
5. Add submit locks and stable idempotency keys to teller transactions.
6. Standardize loading, empty, success, and error states.

### Medium-term

1. Guided teller workflow with review/receipt step.
2. Unified loan stage timeline and responsibility indicator.
3. Configurable approval thresholds and dedicated approval inbox.
4. Standard report filters and Excel/PDF export.
5. Additive RLS/RPC hardening for approvals, corrections, write-offs, and settings.
6. Reusable member search, money input, confirmation, receipt, status, and approval components.

### Later enhancements

1. Full mobile-money/bank integration and reconciled balance cards.
2. Automated accruals, provisioning, and exception monitoring.
3. Offline-capable staff transaction queue with conflict handling.
4. Expanded member notifications and self-service.

## 8. Acceptance and test baseline

Before each later phase is accepted:

- Existing member, savings, loan, teller, cashbook, and journal records remain unchanged.
- Every financial test asserts balanced debits and credits.
- A maker cannot approve their own item.
- Posted records cannot be edited or deleted directly.
- Corrections require a reason and create compensating entries.
- Repeated submission/retry creates one operational transaction and one journal.
- Cross-organization reads and writes fail.
- Teller, loan officer, manager, accountant, administrator, and member journeys are tested separately.
- Key pages pass mobile and low-resolution laptop checks.

