#Requires -Version 5.1
<#
  BOAT local stack (Postgres + Fastify) on Windows.

  What it does:
  1) Optionally starts Docker Compose (postgres + api) if Docker is available.
  2) Ensures deploy/sync.env exists (from example) - you must edit secrets.
  3) Registers a Scheduled Task "BOAT-Sync" to run the sync worker every 5 minutes.

  Run from repo root (PowerShell):
    powershell -ExecutionPolicy Bypass -File .\deploy\install-windows.ps1

  Or from deploy folder:
    powershell -ExecutionPolicy Bypass -File .\install-windows.ps1

  Prerequisites: Node.js 18+ on PATH, npm install at repo root (for pg + sync script).
  For Docker path: Docker Desktop running.
#>

$ErrorActionPreference = "Stop"

$DeployDir = $PSScriptRoot
$BoatRoot = Resolve-Path (Join-Path $DeployDir "..")
$SyncEnv = Join-Path $DeployDir "sync.env"
$SyncEnvExample = Join-Path $DeployDir "sync.env.example"
$ComposeEnv = Join-Path $DeployDir "compose.env"
$ComposeEnvExample = Join-Path $DeployDir "compose.env.example"
$ComposeFile = Join-Path $DeployDir "docker-compose.yml"

Write-Host "BOAT root: $BoatRoot"

if (-not (Test-Path (Join-Path $BoatRoot "node_modules\pg"))) {
  Write-Host "Installing root npm dependencies (pg, dotenv)..."
  Push-Location $BoatRoot
  try {
    npm install
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path $SyncEnv)) {
  if (-not (Test-Path $SyncEnvExample)) {
    throw "Missing $SyncEnvExample"
  }
  Copy-Item $SyncEnvExample $SyncEnv
  Write-Host "Created $SyncEnv - edit CLOUD_* and DATABASE_URL before relying on sync."
}

if (-not (Test-Path $ComposeEnv)) {
  if (Test-Path $ComposeEnvExample) {
    Copy-Item $ComposeEnvExample $ComposeEnv
    Write-Host "Created $ComposeEnv - edit POSTGRES_PASSWORD if needed."
  }
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
  $useDocker = Read-Host "Start Postgres + API with Docker Compose now? (y/N)"
  if ($useDocker -eq "y" -or $useDocker -eq "Y") {
    Push-Location $BoatRoot
    try {
      docker compose -f $ComposeFile --env-file $ComposeEnv up -d --build
      Write-Host "Docker stack started. API: http://127.0.0.1:3001/health (check API_PORT in compose.env)"
    } finally {
      Pop-Location
    }
  }
} else {
  Write-Host "Docker not found on PATH - skip compose, or install Docker Desktop and re-run."
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  throw "node not found on PATH. Install Node.js LTS and re-run."
}
$nodeExe = $nodeCmd.Source

$taskName = "BOAT-Sync"
$scriptPath = Join-Path $BoatRoot "deploy\run-sync.cmd"
@"
@echo off
cd /d "$BoatRoot"
"$nodeExe" "$BoatRoot\scripts\sync-worker.mjs"
"@ | Set-Content -Path $scriptPath -Encoding ASCII

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$scriptPath`""
$start = (Get-Date).AddMinutes(1)
$trigger = New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "BOAT: sync_outbox to cloud sync_events every 5 min"

Write-Host ""
Write-Host "Registered scheduled task: $taskName (every 5 minutes)"
Write-Host "Edit sync secrets in: $SyncEnv"
Write-Host "Test once: node `"$BoatRoot\scripts\sync-worker.mjs`""
