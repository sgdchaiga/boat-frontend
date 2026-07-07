$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runtimeDir = Join-Path $repoRoot ".runtime"
$pidFile = Join-Path $runtimeDir "boat-system-pids.json"
$apiUrl = "http://127.0.0.1:3001"
$webUrl = "http://127.0.0.1:5173"
$postgresService = "postgresql-x64-18"
$npmCmd = (Get-Command "npm.cmd" -ErrorAction Stop).Source

function Test-PidRunning {
  param([int]$PidToCheck)
  if ($PidToCheck -le 0) { return $false }
  $proc = Get-Process -Id $PidToCheck -ErrorAction SilentlyContinue
  return $null -ne $proc
}

function Wait-HttpOk {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  return $false
}

if (-not (Test-Path $runtimeDir)) {
  New-Item -ItemType Directory -Path $runtimeDir | Out-Null
}

if (Test-Path $pidFile) {
  try {
    $state = Get-Content $pidFile -Raw | ConvertFrom-Json
    $serverRunning = Test-PidRunning -PidToCheck ([int]$state.server_pid)
    $webRunning = Test-PidRunning -PidToCheck ([int]$state.web_pid)
    if ($serverRunning -or $webRunning) {
      Write-Host "BOAT appears to be already running." -ForegroundColor Yellow
      if ($webRunning) {
        Start-Process $webUrl
      }
      exit 10
    }
  } catch {
    Write-Host "PID file exists but could not be parsed; continuing startup..." -ForegroundColor Yellow
  }
}

if (-not (Test-Path (Join-Path $repoRoot "server\.env"))) {
  throw "Missing server\.env. Set DATABASE_URL there before starting BOAT."
}

$pgService = Get-Service -Name $postgresService -ErrorAction SilentlyContinue
if ($pgService) {
  if ($pgService.Status -ne "Running") {
    Write-Host "Starting PostgreSQL 18..." -ForegroundColor Cyan
    try {
      Start-Service -Name $postgresService
      $pgService.WaitForStatus("Running", "00:00:30")
    } catch {
      throw "PostgreSQL 18 is installed but could not be started automatically. Start it from Services, or run Start BOAT as administrator. Details: $($_.Exception.Message)"
    }
  } else {
    Write-Host "PostgreSQL 18 is already running." -ForegroundColor DarkGreen
  }
} else {
  Write-Host "PostgreSQL 18 service was not found; continuing in case your DATABASE_URL uses another server." -ForegroundColor Yellow
}

Write-Host "Starting BOAT API server..." -ForegroundColor Cyan
$serverProc = Start-Process -FilePath "powershell.exe" `
  -ArgumentList "-NoExit", "-Command", "cd '$repoRoot\server'; & '$npmCmd' run dev" `
  -PassThru

Write-Host "Starting BOAT frontend..." -ForegroundColor Cyan
$webProc = Start-Process -FilePath "powershell.exe" `
  -ArgumentList "-NoExit", "-Command", "cd '$repoRoot'; `$env:VITE_DESKTOP_DATA_MODE='api'; `$env:VITE_BOAT_API_URL='$apiUrl'; `$env:VITE_LOCAL_BUSINESS_TYPE='school'; & '$npmCmd' run dev -- --host 127.0.0.1" `
  -PassThru

Write-Host "Waiting for BOAT frontend..." -ForegroundColor Cyan
$webReady = Wait-HttpOk -Url $webUrl -TimeoutSeconds 45

Write-Host "Waiting for BOAT API..." -ForegroundColor Cyan
if (-not (Wait-HttpOk -Url "$apiUrl/ready" -TimeoutSeconds 60)) {
  Write-Host "BOAT API did not report ready within 60 seconds. The API window may show the reason." -ForegroundColor Yellow
}

$state = @{
  started_at = (Get-Date).ToString("o")
  server_pid = $serverProc.Id
  web_pid = $webProc.Id
  api_url = $apiUrl
  web_url = $webUrl
} | ConvertTo-Json

Set-Content -Path $pidFile -Value $state -Encoding UTF8

Write-Host "Opening browser at $webUrl ..." -ForegroundColor Green
if (-not $webReady) {
  Write-Host "Frontend did not answer within 45 seconds; opening the URL anyway so it can finish loading." -ForegroundColor Yellow
}
Start-Process $webUrl

Write-Host "BOAT started." -ForegroundColor Green
Write-Host "- API terminal PID: $($serverProc.Id)"
Write-Host "- Web terminal PID: $($webProc.Id)"
Write-Host "- API URL: $apiUrl"
Write-Host "- App URL: $webUrl"
Write-Host "Use Stop-BOAT.bat to stop both services."
