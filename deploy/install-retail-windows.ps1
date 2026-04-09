#Requires -Version 5.1
<#
  BOAT — retail tenant: install PostgreSQL (silent), create DB, run migrations, seed retail org, start web + API.

  From repo root (PowerShell as Administrator recommended for PostgreSQL install):
    powershell -ExecutionPolicy Bypass -File .\deploy\install-retail-windows.ps1

  The UI still uses Supabase Auth; configure VITE_SUPABASE_* in `.env` (see `.env.example`).
  This script prepares the Postgres schema the app expects for LAN / self-hosted DB scenarios.

  Parameters:
    PostgresPassword  Superuser password for user postgres (must match your PostgreSQL install; winget/EDB
                        often prompt or assign a password — set this to match, or set env BOAT_PG_PASSWORD)
    DatabaseName        Database to create (default: boat)
    SkipPostgreSQLInstall  Use if PostgreSQL is already installed and psql is on PATH
    SkipNpmInstall        Skip npm install and prisma generate (if already done)
    NonInteractive        Do not prompt for postgres password on auth failure (CI / automation)
#>

param(
  [string]$PostgresUser = "postgres",
  [string]$PostgresPassword = $(if ($env:BOAT_PG_PASSWORD) { $env:BOAT_PG_PASSWORD } else { "BoatRetail1!" }),
  [string]$DatabaseName = "boat",
  [int]$PostgresPort = 5432,
  [switch]$SkipPostgreSQLInstall,
  [switch]$SkipNpmInstall,
  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"

$DeployDir = $PSScriptRoot
$BoatRoot = Resolve-Path (Join-Path $DeployDir "..")
$ServerEnv = Join-Path $BoatRoot "server\.env"
$SeedSql = Join-Path $DeployDir "seed-retail-organization.sql"
$ApplyScript = Join-Path $BoatRoot "scripts\apply-migrations.ps1"

function Add-PostgreSqlBinToPath {
  $roots = @(
    "${env:ProgramFiles}\PostgreSQL",
    "${env:ProgramFiles(x86)}\PostgreSQL"
  )
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      $bin = Join-Path $_.FullName "bin\psql.exe"
      if (Test-Path $bin) {
        $dir = Split-Path $bin
        if ($env:Path -notlike "*$dir*") {
          $env:Path = "$dir;$env:Path"
        }
        return $true
      }
    }
  }
  return $false
}

function Test-Psql {
  return $null -ne (Get-Command psql -ErrorAction SilentlyContinue)
}

function Test-PostgresLogin {
  param(
    [string]$User,
    [string]$Password,
    [int]$Port
  )
  $env:PGPASSWORD = $Password
  & psql -h 127.0.0.1 -p $Port -U $User -d postgres -v ON_ERROR_STOP=1 -c 'SELECT 1' 2>$null | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Write-PostgresPasswordHelp {
  Write-Host ''
  Write-Host 'The password for user "postgres" must be the one set when PostgreSQL was installed.'
  Write-Host 'The script default (BoatRetail1!) only applies if you use that exact password.'
  Write-Host ''
  Write-Host 'Try one of:'
  Write-Host '  1) Re-run with your real password:'
  Write-Host '     .\deploy\install-retail-windows.ps1 -PostgresPassword YOUR_PASSWORD -SkipPostgreSQLInstall'
  Write-Host '  2) Set env BOAT_PG_PASSWORD then re-run.'
  Write-Host '  3) If you forgot it: open Stack Builder / pgAdmin install notes, or reset (see PostgreSQL docs for Windows).'
  Write-Host '     Quick reset: temporarily set host lines in data\pg_hba.conf to "trust" for 127.0.0.1,'
  Write-Host '     restart the postgresql service, run ALTER USER postgres WITH PASSWORD ''newpass'';, then restore pg_hba.'
  Write-Host ''
}

function Install-PostgreSqlWindows {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw 'winget not found. Install PostgreSQL manually (see postgresql.org/download/windows) or install App Installer from the Microsoft Store, then re-run.'
  }
  Write-Host 'Installing PostgreSQL via winget (silent)...'
  $ids = @("PostgreSQL.PostgreSQL.17", "PostgreSQL.PostgreSQL.16", "PostgreSQL.PostgreSQL")
  $ok = $false
  foreach ($id in $ids) {
    & winget install -e --id $id --accept-package-agreements --accept-source-agreements --silent 2>&1 | Out-Host
    if ($LASTEXITCODE -eq 0) { $ok = $true; break }
    Write-Host ('winget install ' + $id + ' exited ' + $LASTEXITCODE + ' - trying next id...')
  }
  if (-not $ok) {
    throw 'winget could not install PostgreSQL. Install PostgreSQL 16+ manually, ensure psql.exe is on PATH, then re-run with -SkipPostgreSQLInstall.'
  }
  Start-Sleep -Seconds 3
  $svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if ($svc -and $svc.Status -ne "Running") {
    Start-Service $svc.Name
  }
  if (-not (Add-PostgreSqlBinToPath)) {
    throw 'PostgreSQL installed but psql.exe not found under Program Files. Add PostgreSQL\bin to PATH and re-run with -SkipPostgreSQLInstall.'
  }
}

Write-Host ('BOAT root: ' + $BoatRoot)

if ($DatabaseName -notmatch '^[a-zA-Z_][a-zA-Z0-9_]*$') {
  throw 'DatabaseName must be a simple PostgreSQL identifier: letters, digits, underscore only.'
}

if (-not (Test-Path $ApplyScript)) { throw ('Missing ' + $ApplyScript) }
if (-not (Test-Path $SeedSql)) { throw ('Missing ' + $SeedSql) }

if (-not (Test-Psql)) {
  if ($SkipPostgreSQLInstall) {
    throw 'psql not on PATH. Install PostgreSQL or remove -SkipPostgreSQLInstall.'
  }
  Install-PostgreSqlWindows
}

if (-not (Test-Psql)) {
  Add-PostgreSqlBinToPath | Out-Null
}
if (-not (Test-Psql)) {
  throw 'psql not found. Add PostgreSQL bin to PATH or re-run after fixing the install.'
}

Write-Host ('Testing PostgreSQL login as ' + $PostgresUser + '@127.0.0.1:' + $PostgresPort + ' ...')
if (-not (Test-PostgresLogin -User $PostgresUser -Password $PostgresPassword -Port $PostgresPort)) {
  Write-Host 'Login failed with the current password.'
  Write-PostgresPasswordHelp
  if (-not $NonInteractive) {
    $try = Read-Host 'Enter postgres superuser password (or press Enter to abort)'
    if ([string]::IsNullOrWhiteSpace($try)) {
      throw 'Aborted. Fix password and re-run.'
    }
    $PostgresPassword = $try
    if (-not (Test-PostgresLogin -User $PostgresUser -Password $PostgresPassword -Port $PostgresPort)) {
      throw 'PostgreSQL authentication still failed. Use -PostgresPassword or BOAT_PG_PASSWORD with the correct password.'
    }
    Write-Host 'Login OK.'
  } else {
    throw 'PostgreSQL authentication failed. Set BOAT_PG_PASSWORD or -PostgresPassword to the postgres superuser password.'
  }
} else {
  Write-Host 'Login OK.'
}

$env:PGPASSWORD = $PostgresPassword
$createDbSql = "SELECT 1 FROM pg_database WHERE datname = '$DatabaseName'"
$exists = & psql -h 127.0.0.1 -p $PostgresPort -U $PostgresUser -d postgres -tAc $createDbSql 2>$null
if ($exists -match "1") {
  Write-Host ('Database already exists: ' + $DatabaseName)
} else {
  Write-Host ('Creating database: ' + $DatabaseName)
  $createSql = 'CREATE DATABASE ' + $DatabaseName + ';'
  & psql -h 127.0.0.1 -p $PostgresPort -U $PostgresUser -d postgres -v ON_ERROR_STOP=1 -c $createSql
  if ($LASTEXITCODE -ne 0) { throw ('CREATE DATABASE failed (exit ' + $LASTEXITCODE + ')') }
}

Write-Host 'Applying migrations...'
Push-Location $BoatRoot
try {
  & $ApplyScript -Host "127.0.0.1" -Port $PostgresPort -Database $DatabaseName -User $PostgresUser
} finally {
  Pop-Location
}

Write-Host 'Seeding retail organization flags...'
& psql -h 127.0.0.1 -p $PostgresPort -U $PostgresUser -d $DatabaseName -v ON_ERROR_STOP=1 -f $SeedSql
if ($LASTEXITCODE -ne 0) { throw ('Retail seed failed (exit ' + $LASTEXITCODE + ')') }

$enc = [uri]::EscapeDataString($PostgresPassword)
$dbUrl = 'postgresql://' + $PostgresUser + ':' + $enc + '@127.0.0.1:' + $PostgresPort + '/' + $DatabaseName + '?schema=public'
$nl = [Environment]::NewLine
$q = [char]34
$serverEnvBody = @(
  ('DATABASE_URL=' + $q + $dbUrl + $q)
  'PORT=3001'
  'HOST=0.0.0.0'
  'NODE_ENV=development'
  ''
) -join $nl
Set-Content -Path $ServerEnv -Value $serverEnvBody -Encoding UTF8
Write-Host ('Wrote ' + $ServerEnv)

if (-not $SkipNpmInstall) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js not on PATH. Install Node.js 18+ LTS and re-run.'
  }
  Write-Host 'npm install (repo root)...'
  Push-Location $BoatRoot
  try {
    npm install
    Write-Host 'npm install (server)...'
    npm install --prefix server
    Push-Location (Join-Path $BoatRoot 'server')
    try {
      npx prisma generate
    } finally {
      Pop-Location
    }
  } finally {
    Pop-Location
  }
}

Write-Host ""
Write-Host 'Starting Vite (frontend) and Fastify (API) in new windows...'
$rootPath = $BoatRoot.Path
Start-Process cmd.exe -WorkingDirectory $rootPath -ArgumentList @('/k', 'title BOAT Retail Web ^&^& npm run dev')
Start-Process cmd.exe -WorkingDirectory $rootPath -ArgumentList @('/k', 'title BOAT Retail API ^&^& npm run server:dev')

Write-Host ""
Write-Host 'Done. API: http://127.0.0.1:3001/health - Web: http://127.0.0.1:5173 (typical Vite port)'
Write-Host 'Copy .env.example to .env and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for sign-in.'
