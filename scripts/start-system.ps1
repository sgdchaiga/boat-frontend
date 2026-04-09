$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runtimeDir = Join-Path $repoRoot ".runtime"
$pidFile = Join-Path $runtimeDir "boat-system-pids.json"

function Test-PidRunning {
  param([int]$PidToCheck)
  if ($PidToCheck -le 0) { return $false }
  $proc = Get-Process -Id $PidToCheck -ErrorAction SilentlyContinue
  return $null -ne $proc
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
        Start-Process "http://localhost:5173"
      }
      exit 10
    }
  } catch {
    Write-Host "PID file exists but could not be parsed; continuing startup..." -ForegroundColor Yellow
  }
}

Write-Host "Starting BOAT API server..." -ForegroundColor Cyan
$serverProc = Start-Process -FilePath "powershell.exe" `
  -ArgumentList "-NoExit", "-Command", "cd '$repoRoot\server'; npm run dev" `
  -PassThru

Write-Host "Starting BOAT frontend..." -ForegroundColor Cyan
$webProc = Start-Process -FilePath "powershell.exe" `
  -ArgumentList "-NoExit", "-Command", "cd '$repoRoot'; npm run dev" `
  -PassThru

$state = @{
  started_at = (Get-Date).ToString("o")
  server_pid = $serverProc.Id
  web_pid = $webProc.Id
} | ConvertTo-Json

Set-Content -Path $pidFile -Value $state -Encoding UTF8

$url = "http://localhost:5173"
Write-Host "Opening browser at $url ..." -ForegroundColor Green
Start-Sleep -Seconds 3
Start-Process $url

Write-Host "BOAT started." -ForegroundColor Green
Write-Host "- API terminal PID: $($serverProc.Id)"
Write-Host "- Web terminal PID: $($webProc.Id)"
Write-Host "Use Stop-BOAT.bat to stop both services."
