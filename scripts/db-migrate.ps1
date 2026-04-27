#Requires -Version 5.1
<#
  Smart migration runner:
    1) Try psql-based migration apply script
    2) Fallback to Supabase CLI db push

  Usage:
    npm run db:migrate
#>

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

$applyScript = Join-Path $PSScriptRoot "apply-migrations.ps1"
$pushScript = Join-Path $PSScriptRoot "supabase-db-push.ps1"

if (-not (Test-Path $applyScript)) {
  throw "Missing script: $applyScript"
}
if (-not (Test-Path $pushScript)) {
  throw "Missing script: $pushScript"
}

$psql = Get-Command psql -ErrorAction SilentlyContinue
if ($psql) {
  Write-Host "[db:migrate] psql detected. Running apply-migrations.ps1..."
  & powershell -ExecutionPolicy Bypass -File $applyScript
  if ($LASTEXITCODE -eq 0) {
    Write-Host "[db:migrate] Success via psql."
    exit 0
  }
  Write-Host "[db:migrate] psql path failed (exit $LASTEXITCODE). Falling back to Supabase CLI..."
} else {
  Write-Host "[db:migrate] psql not found. Falling back to Supabase CLI..."
}

$supabase = Get-Command supabase -ErrorAction SilentlyContinue
if (-not $supabase) {
  throw "[db:migrate] Neither psql nor Supabase CLI is available on PATH. Install one and re-run."
}

& powershell -ExecutionPolicy Bypass -File $pushScript
if ($LASTEXITCODE -ne 0) {
  throw "[db:migrate] Supabase fallback failed (exit $LASTEXITCODE)."
}

Write-Host "[db:migrate] Success via Supabase CLI."
