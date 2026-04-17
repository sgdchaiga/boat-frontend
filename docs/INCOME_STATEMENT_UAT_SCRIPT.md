# Income Statement UAT Script (Repeatable)

This script gives QA and accountants a deterministic way to validate the enterprise Income Statement.

Use together with:
- `docs/INCOME_STATEMENT_ENTERPRISE_QA.md`

---

## 1) Preconditions

- Environment has at least 2 organizations (Org A, Org B).
- Tester has access to:
  - one Org A accounting user
  - one Org B accounting user
  - optional super admin user
- Posting controls available in journals.
- Branch and department dimensions enabled in journal entry lines.

---

## 2) Reference test window

- Current period: `2026-04-01` to `2026-04-30`
- Previous period (auto by app): `2026-03-01` to `2026-03-31`
- Same period last year (auto by app): `2025-04-01` to `2025-04-30`

---

## 3) Sample dataset (Org A only)

Create these **posted** journals in Org A:

1. `2026-04-05`  
   - Income account (e.g. `4000 Sales`) credit `1,000,000`  
   - Offset cash/receivable debit `1,000,000`  
   - Dimensions: `branch=Main`, `department_id=Food`

2. `2026-04-06`  
   - Expense account (e.g. `5100 Utilities`) debit `250,000`  
   - Offset cash/payable credit `250,000`  
   - Dimensions: `branch=Main`, `department_id=Admin`

3. `2026-04-10`  
   - Income account (e.g. `4010 Services`) credit `300,000`  
   - Offset cash/receivable debit `300,000`  
   - Dimensions: `branch=Annex`, `department_id=Food`

4. `2026-04-11`  
   - Expense account (e.g. `5200 Supplies`) debit `100,000`  
   - Offset cash/payable credit `100,000`  
   - Dimensions: `branch=Annex`, `department_id=Ops`

Create one **unposted** journal in Org A (same period):

5. `2026-04-15`  
   - Income credit `999,999` (any income account)  
   - Offset debit `999,999`  
   - Dimensions optional

Create one **negative edge case** (posted) in Org A:

6. `2026-04-18`  
   - Reverse/over-correct an income account so one revenue account total becomes negative (e.g. debit income `50,000`)  
   - Offset credit `50,000`

Create minimal posted records in Org B (different totals) to validate isolation.

---

## 4) Expected baseline totals (Org A, current period, all branches/departments)

From entries 1-4 only:

- Revenue = `1,300,000`
- Expenses = `350,000`
- Net income = `950,000`

Notes:
- Entry 5 (unposted) must be excluded.
- Entry 6 affects sign-warning test and should be reflected if present.

---

## 5) UAT execution steps

### Step A: Tenant isolation
- Log in as Org A -> open Income Statement.
- Confirm Org B data does not appear.
- Log in as Org B -> confirm Org A data does not appear.

### Step B: Posted-only
- Validate totals do not include unposted entry #5.
- Drill-down on impacted account and confirm unposted transaction is absent.

### Step C: Dimension filtering
- Filter `Branch=Main`; expected:
  - Revenue `1,000,000`
  - Expenses `250,000`
  - Net income `750,000`
- Filter `Branch=Annex`; expected:
  - Revenue `300,000`
  - Expenses `100,000`
  - Net income `200,000`
- Apply department filter (e.g. Food/Admin/Ops) and verify scoped totals.

### Step D: Comparison periods
- Set comparison to `previous period`.
- Verify previous column maps to March window and values match seeded March data.
- Set comparison to `same period last year`.
- Verify previous column maps to April last year.

### Step E: Drill-down
- Click one income account.
- Sum drill-down impact amounts:
  - for income rows, `credit - debit`
- Confirm equals summary row total.
- Repeat for one expense account:
  - `debit - credit`

### Step F: Percentages
- Validate `% of Revenue` for each revenue row:
  - `(row total / totalRevenue) * 100`
- Validate `% of Expenses` for each expense row:
  - `(row total / totalExpenses) * 100`

### Step G: Charts
- Trend chart:
  - period buckets show month labels
  - line values reconcile to month totals
- Expense pie:
  - slices match expense accounts
  - percentages look proportional

### Step H: Exports
- Export Excel:
  - file extension `.xlsx`
  - company header present
  - currency formatted values
- Export PDF:
  - company header present
  - totals match on-screen values

### Step I: Loading behavior
- First visit: skeleton shows.
- Change filters/date: existing data remains, “Refreshing...” shows.
- Type custom dates quickly: no visible request thrash; final value resolves correctly.

### Step J: Negative logic
- If entry #6 present, confirm:
  - warning banner appears
  - negative rows highlighted
  - values are not silently clamped

---

## 6) Pass/fail criteria

Pass if all are true:
- Isolation, posted-only, and dimensions are correct
- Totals and drill-down reconcile
- Comparisons map to correct windows
- Charts and percentages are mathematically consistent
- Exports preserve headers and currency formatting
- Loading UX behaves as designed

Fail if any material mismatch is found.

---

## 7) UAT run log template

- Run date:
- Environment:
- Tester:
- Org tested:
- Build/commit:
- Result: Pass / Fail
- Failed step(s):
- Evidence links (screenshots/video):
- Notes / follow-up tickets:

