#Requires -Version 5.1
<#
  Apply supabase/migrations/*.sql to a PostgreSQL database in filename order.

  Prerequisites: psql on PATH (install PostgreSQL client tools or full PostgreSQL).

  Usage (PowerShell from repo root):
    $env:PGPASSWORD = "your-db-password"
    .\scripts\apply-migrations.ps1 -DatabaseUrl "postgresql://user@127.0.0.1:5432/boat"

  Or:
    .\scripts\apply-migrations.ps1 -Host 127.0.0.1 -Port 5432 -Database boat -User postgres

  Note: Migrations target Supabase (auth.users, auth.uid(), roles). For plain PostgreSQL, the
  local auth compatibility stub is applied first. Pass -SkipLocalAuthStub for a Supabase target.
#>

param(
  [string]$DatabaseUrl = "",
  [string]$PgHost = "127.0.0.1",
  [int]$Port = 5432,
  [string]$Database = "boat",
  [string]$User = "postgres",
  [switch]$SkipLocalAuthStub
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$MigrationsDir = Join-Path $RepoRoot "supabase\migrations"
$LocalAuthStub = Join-Path $RepoRoot "supabase\manual\00000000000000_local_postgres_auth_stub.sql"

if (-not (Test-Path $MigrationsDir)) {
  throw "Missing folder: $MigrationsDir"
}

$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
  throw "psql not found. Add PostgreSQL bin to PATH or install PostgreSQL."
}

$files = @()
if (-not $SkipLocalAuthStub) {
  if (-not (Test-Path $LocalAuthStub)) { throw "Missing local PostgreSQL auth stub: $LocalAuthStub" }
  $files += Get-Item $LocalAuthStub
}
$files += @(Get-ChildItem $MigrationsDir -Filter "*.sql" | Sort-Object Name)
if ($files.Count -eq 0) {
  throw "No .sql files in $MigrationsDir"
}

Write-Host "Applying $($files.Count) migration file(s) to database..."

foreach ($f in $files) {
  Write-Host "  -> $($f.Name)"
  if ($DatabaseUrl) {
    & psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $f.FullName
  } else {
    $env:PGHOST = $PgHost
    $env:PGPORT = "$Port"
    $env:PGDATABASE = $Database
    $env:PGUSER = $User
    & psql -v ON_ERROR_STOP=1 -f $f.FullName
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Migration failed: $($f.Name) (exit $LASTEXITCODE)"
  }
}

Write-Host "Done."
