# VSLA v1.2 Phase 5 operational readiness

## Performance targets

| Workflow | Target | Control |
| --- | --- | --- |
| Open a group-health dashboard | p95 under 3 seconds for a 24-month cycle history | Cycle/type/status indexes; aggregate queries only |
| Record an online meeting collection | p95 under 2 seconds | Atomic RPC and idempotency key |
| Payment webhook acknowledgement | p95 under 2 seconds; retry-safe | Provider reference uniqueness and no ledger post from callback |
| Payment inbox review | First 100 records under 3 seconds | Organization/status indexes and bounded query |
| Institutional programme overview | p95 under 5 seconds for 100 authorized groups | Aggregate-only correlated summaries; no member records |

## Load and recovery exercises before broad rollout

1. Exercise concurrent submissions from at least 20 meetings using distinct idempotency keys; verify no duplicate event, loan, or payment-intent records.
2. Replay a representative provider webhook burst at least three times; verify each provider reference produces one payment evidence record and zero duplicate ledger events.
3. Simulate network loss on the designated offline device, then reconnect; verify provisional records are either idempotently confirmed or visibly rejected.
4. Restore a non-production database backup and confirm that posted events, audit trail, approval decisions, payment evidence, and workflow settings remain consistent.
5. Run tenant-isolation checks with two VSLA organizations plus one institutional organization; verify an institution can see only explicitly authorized aggregate rows.

## Monitoring and alert thresholds

- Alert when a payment intent remains `provider_pending` for more than one business day.
- Alert when any intent is `reversal_pending` or a meeting cash reconciliation requires approval.
- Alert when an active digital loan remains `approved_pending_payout` at meeting-close time.
- Review daily: unmatched payment evidence, failed payout requests, rejected offline records, and institutional authorization changes.
- Review monthly: health-dashboard data completeness, index/query performance, backup restore evidence, and audit export retention.

## Marketplace boundary

Marketplace activity is optional and must remain outside the VSLA financial ledger. A group business profile, product sale, or collective purchase may link to a VSLA organization only through a separate commercial agreement. It must not create savings, loan, repayment, share-out, or cash-reconciliation events, and it must not delay core VSLA controls.

## SACCO referral boundary

A VSLA-to-SACCO referral exports an approved aggregate snapshot only. It cannot create a SACCO member, transfer funds, migrate historical transactions, or alter the group’s legal identity. Any such action needs a separate consented process with the receiving SACCO.
