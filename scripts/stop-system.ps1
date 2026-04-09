$ErrorActionPreference = "SilentlyContinue"

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$pidFile = Join-Path $repoRoot ".runtime\boat-system-pids.json"

function Stop-PidIfRunning {
  param([int]$PidToStop)
  if ($PidToStop -le 0) { return }
  $proc = Get-Process -Id $PidToStop
  if ($null -ne $proc) {
    Stop-Process -Id $PidToStop -Force
    Write-Host "Stopped PID $PidToStop"
  }
}

if (Test-Path $pidFile) {
  $state = Get-Content $pidFile -Raw | ConvertFrom-Json
  Stop-PidIfRunning -PidToStop ([int]$state.server_pid)
  Stop-PidIfRunning -PidToStop ([int]$state.web_pid)
  Remove-Item $pidFile -Force
} else {
  Write-Host "No PID file found, trying port-based stop..."
}

# Fallback: stop listeners on common local dev ports.
$ports = @(5173, 3001)
foreach ($port in $ports) {
  $matches = netstat -ano | Select-String ":$port\s"
  foreach ($m in $matches) {
    $parts = ($m.ToString() -replace "\s+", " ").Trim().Split(" ")
    $pid = 0
    if ($parts.Length -gt 0) {
      [int]::TryParse($parts[$parts.Length - 1], [ref]$pid) | Out-Null
    }
    if ($pid -gt 0) {
      Stop-PidIfRunning -PidToStop $pid
    }
  }
}

Write-Host "BOAT stop routine complete." -ForegroundColor Green
