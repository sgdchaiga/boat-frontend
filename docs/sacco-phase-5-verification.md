# BOAT SACCO — Phase 5 Verification

Date: 24 July 2026

## Automated checks

Run with:

```text
npm run test:sacco
```

The suite verifies:

1. Flat-rate monthly payment calculations.
2. Declining-balance schedules repay the full principal and never produce negative balances.
3. Teller operational and reversal journals contain equal debit/credit pairs.
4. Teller makers cannot approve their own transactions in the UI, service, or database trigger.
5. Teller retries reuse a stable request key backed by organization-scoped database uniqueness.
6. Posted corrections require reasons, reversal metadata, compensating actions, and replacement linkage.
7. Teller and loan-officer roles do not receive transaction-correction permission by default.

## Regression checks

- TypeScript application compile: required.
- Production Vite build: required.
- No existing SACCO table or route was deleted.
- Control migrations are additive and include rollback notes.

## Deployment verification still required

The repository tests confirm code and migration definitions. After deploying the migrations to each target database, run a staging smoke test with two distinct staff accounts to confirm:

- maker creates a threshold transaction;
- the maker is rejected as checker;
- a different authorized checker can approve;
- retrying the same request returns one transaction and one journal;
- correction creates reversal and replacement records;
- cross-organization access is rejected by deployed RLS.

Existing production financial data was not mutated during repository verification.
