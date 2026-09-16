# Manufacturing Phase 2 verification

## Implemented in the worktree

- Optional production orders with saved BOM recipes, material reservations and release.
- Work centres, BOM routing steps and job cards generated on release.
- Mobile job cards with order/centre/status filters, actual minutes, block reasons, start/resume/complete actions and concurrent-edit detection.
- Starter routings for grain milling, bakery and metal fabrication, with editable stage names, centres and planned minutes before saving.
- Raw-material and finished-product lots, inspections and corrective actions.
- Sales allocation to available lots by earliest expiry and a customer trace view for retail sales.
- Order output, dates, actual costs, unit costs and material usage reporting.

Production entries without an order remain supported. Starter routings are editable process outlines, not product recipes or approved quality specifications. Job time is entered manually; the mobile page requires a connection.

## Automated checks

`npm run test:manufacturing` passes nine tests using embedded PostgreSQL (PGlite). The suite applies the September 15 manufacturing migrations to a reduced pre-Phase-2 schema plus the existing simple-processing consumption trigger. It checks:

1. Saved order recipe consumption and order-free BOM consumption, including material costing.
2. Job status transitions, required block reasons, preserved start timestamps and completed-job protection.
3. Lot allocation with an untracked remainder and stock conservation.
4. Held/expired/future stock exclusion and atomic rollback when sale allocation fails.
5. Rejection of reservation, release and stock assignment when organization identity is missing.
6. Rejection of a directly selected held sales lot.
7. Earliest-expiry allocation independent of lot creation order.
8. Material reservation before release and generation of job cards.
9. Rejection of corrective action based on an inspection without the matching lot.

`npm run typecheck`, `npm run build` and `npm run migrations:validate` also pass. Vite reports existing mixed-import and bundle-size warnings.

These tests execute PostgreSQL functions and triggers; they do not reproduce the entire application database, all authorization roles, or browser interaction with a live organization.

## Deployment state

No live migrations were applied in this work session. The linked database dry run lists twelve pending manufacturing migrations, from `20260915100000` through `20260915160000`. The ordinary project push also includes four pending school/hotel migrations.

The one-time release script `scripts/manufacturing-phase2-release.ps1` prepares a temporary migration directory containing the reviewed history and the explicit twelve manufacturing migrations. Its default action is a dry run. That scoped dry run has been verified against the linked database and lists only the manufacturing set.

```powershell
# Read-only preview
./scripts/manufacturing-phase2-release.ps1

# Apply only after live rollout is authorized
./scripts/manufacturing-phase2-release.ps1 -Apply
```

The script uses a fixed release baseline. If later migrations have already been applied remotely, review and update the baseline before using it; do not repair migration history to bypass a mismatch.

## Remaining acceptance work

Apply the reviewed manufacturing migration set, then verify the screens and posting workflows in a designated organization. Check an order-free production entry, a released order, a blocked/resumed job, a failed inspection followed by rework and reinspection, and a sale traced to an output lot. Phase 2 should not be marked complete before that integration verification.
