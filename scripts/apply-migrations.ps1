#Requires -Version 5.1
<#
  Apply supabase/migrations/*.sql to a PostgreSQL database in filename order.

  Prerequisites: psql on PATH (install PostgreSQL client tools or full PostgreSQL).

  Usage (PowerShell from repo root):
    $env:PGPASSWORD = "your-db-password"
    .\scripts\apply-migrations.ps1 -DatabaseUrl "postgresql://user@127.0.0.1:5432/boat"

  Or:
    .\scripts\apply-migrations.ps1 -Host 127.0.0.1 -Port 5432 -Database boat -User postgres

  Note: Migrations target Supabase (auth.users, auth.uid(), roles). For plain PostgreSQL, ensure
  migration `00000000000000_local_postgres_auth_stub.sql` runs first (included in repo order).
#>

param(
  [string]$DatabaseUrl = "",
  [string]$Host = "127.0.0.1",
  [int]$Port = 5432,
  [string]$Database = "boat",
  [string]$User = "postgres"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$MigrationsDir = Join-Path $RepoRoot "supabase\migrations"

if (-not (Test-Path $MigrationsDir)) {
  throw "Missing folder: $MigrationsDir"
}

$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
  throw "psql not found. Add PostgreSQL bin to PATH or install PostgreSQL."
}

$files = @(Get-ChildItem $MigrationsDir -Filter "*.sql" | Sort-Object Name)
if ($files.Count -eq 0) {
  throw "No .sql files in $MigrationsDir"
}

Write-Host "Applying $($files.Count) migration file(s) to database..."

foreach ($f in $files) {
  Write-Host "  -> $($f.Name)"
  if ($DatabaseUrl) {
    & psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $f.FullName
  } else {
    $env:PGHOST = $Host
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
