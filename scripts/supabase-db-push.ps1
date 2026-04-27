#Requires -Version 5.1
<#
  Apply migrations via Supabase CLI (fallback when psql is unavailable).

  Usage:
    npm run db:push

  Notes:
    - Requires Supabase CLI (`supabase`) on PATH.
    - Requires project link/auth already configured for the target Supabase project.
#>

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

$supabase = Get-Command supabase -ErrorAction SilentlyContinue
if (-not $supabase) {
  throw "Supabase CLI not found. Install it and ensure 'supabase' is on PATH. See: https://supabase.com/docs/guides/cli"
}

Write-Host "Running Supabase migration push..."
& supabase db push
if ($LASTEXITCODE -ne 0) {
  throw "supabase db push failed (exit $LASTEXITCODE)"
}

Write-Host "Done."
