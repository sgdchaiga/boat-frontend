# Database migration workflow

`supabase/migrations` is the canonical cloud migration history. Every file must have a unique 14-digit version prefix. Local PostgreSQL compatibility helpers belong in `supabase/manual`, not in the cloud migration folder.

The direct PostgreSQL runner applies the local auth compatibility stub automatically. Use `-SkipLocalAuthStub` only when that runner targets an actual Supabase database.

## Before creating a migration

1. Pull the latest `main` branch.
2. Run `npm run migrations:validate`.
3. Create a new migration with a version later than the latest repository version.
4. Never reuse or rename a version that has been pushed to a hosted database.

## Validate and deploy

Run:

```powershell
npm run migrations:validate
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
```

The migration list must show matching local and remote versions. Do not use `--include-all` to bypass a mismatch. Resolve unexpected local-only or remote-only versions before deployment.

## Legacy history baseline

On 2026-08-14, the hosted BOAT schema migration ledger was reconciled with the repository. Older SQL had already been applied through earlier direct deployment paths, so those versions were recorded as applied with `supabase migration repair --status applied`; their SQL was not replayed. Duplicate repository timestamps were normalized before that repair.

## Recovery rule

Migration repair changes history metadata and must not be used to conceal a failed migration. Use it only after confirming the schema change already exists or after restoring the canonical history from source control.
