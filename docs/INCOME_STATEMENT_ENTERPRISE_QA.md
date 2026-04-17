# Income Statement Enterprise QA Checklist

Use this checklist before release and after any change to accounting/reporting logic.

## 1) Tenant isolation

- [ ] Sign in as Org A user and open `Accounting -> Income Statement`.
- [ ] Confirm no accounts/amounts from Org B appear.
- [ ] Repeat with Org B and confirm separation.
- [ ] Validate branch/department filter options only show values from the signed-in org.

## 2) Posted-only enforcement

- [ ] Create one posted journal entry in period.
- [ ] Create one unposted journal entry in same period.
- [ ] Confirm report totals include only posted entry impact.
- [ ] Open drill-down for affected account and confirm only posted transactions appear.

## 3) Dimension filters (branch, department)

- [ ] Post entries with `dimensions.branch = Main` and `dimensions.branch = Annex`.
- [ ] Filter Branch = `Main`; confirm totals and drill-down only show Main.
- [ ] Filter Department = a specific department ID; confirm scope is correct.
- [ ] Apply both filters together; confirm intersection behavior.
- [ ] Clear filters; confirm totals return to full posted set.

## 4) Accounting sign logic

- [ ] Confirm income account effect = `credit - debit`.
- [ ] Confirm expense account effect = `debit - credit`.
- [ ] Insert a reversal/bad data case that causes negative account total.
- [ ] Confirm warning banner is shown and negative rows are highlighted.

## 5) Completeness (zero-activity accounts)

- [ ] Ensure at least one active income account has no transactions in selected period.
- [ ] Ensure at least one active expense account has no transactions in selected period.
- [ ] Confirm both accounts appear with `UGX 0.00` (or equivalent currency format).

## 6) Comparison periods

- [ ] `Compare with previous period`: confirm Previous totals match same-length preceding date span.
- [ ] `Compare with same period last year`: confirm Previous totals match shifted year range.
- [ ] Confirm net income comparison follows `Revenue - Expenses`.

## 7) Drill-down integrity

- [ ] Click a revenue account and capture listed drill-down rows.
- [ ] Sum drill-down impact values for that account.
- [ ] Confirm sum equals account row total in report.
- [ ] Repeat for at least one expense account.

## 8) Charts and analytics

- [ ] Trend chart loads with period points and no console errors.
- [ ] Revenue/expense lines align with period totals.
- [ ] Expense pie renders top expense accounts with sensible percentages.
- [ ] `% of Revenue` and `% of Expenses` columns are mathematically correct.

## 9) Export validation

- [ ] Export Excel and confirm file type is `.xlsx` (not CSV).
- [ ] Confirm company header appears in export.
- [ ] Confirm currency is formatted with symbol and locale (e.g. `UGX` / `en-UG`).
- [ ] Confirm PDF export contains same totals as on-screen values.

## 10) Loading and responsiveness

- [ ] First load shows skeleton state.
- [ ] Changing filters keeps prior data visible with “Refreshing…” indicator.
- [ ] Rapidly editing custom dates does not spam requests (debounce works).
- [ ] Re-selecting previous filter combinations returns quickly (cache hit behavior).

## 11) Regression quick pack

- [ ] No linter errors in `IncomeStatementPage`.
- [ ] No runtime errors in browser console while using page end-to-end.
- [ ] Permissions remain correct for non-super-admin users with organization scoping.

## Sign-off

- QA date:
- Environment:
- Tested by:
- Result: Pass / Fail
- Notes:

