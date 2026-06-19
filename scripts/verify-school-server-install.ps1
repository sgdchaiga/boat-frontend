#Requires -Version 5.1
param(
  [string]$BaseUrl = "http://127.0.0.1:3001",
  [string]$InstallDir = "C:\BOAT-School"
)
$ErrorActionPreference = "Stop"
$checks = New-Object System.Collections.Generic.List[object]
function Add-Check {
  param([string]$Name, [bool]$Ok, [string]$Detail)
  $checks.Add([pscustomobject]@{ name = $Name; ok = $Ok; detail = $Detail })
}
function Test-CommandExists {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}
Add-Check "Install folder" (Test-Path $InstallDir) $InstallDir
$nodeDetail = "missing"
if (Test-CommandExists "node") {
  $nodeDetail = (& node --version)
}
Add-Check "Node.js" (Test-CommandExists "node") $nodeDetail
Add-Check "npm" ((Test-CommandExists "npm.cmd") -or (Test-CommandExists "npm")) "npm command"
Add-Check "Docker" (Test-CommandExists "docker") "docker command"
try {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "docker"
  $psi.Arguments = "info"
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $proc = [System.Diagnostics.Process]::Start($psi)
  $proc.WaitForExit()
  Add-Check "Docker engine" ($proc.ExitCode -eq 0) "docker info"
} catch {
  Add-Check "Docker engine" $false $_.Exception.Message
}
foreach ($path in @("health", "ready")) {
  $url = "$BaseUrl/$path"
  try {
    $res = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 8
    Add-Check "API $path" ($res.StatusCode -eq 200) "HTTP $($res.StatusCode)"
  } catch {
    Add-Check "API $path" $false $_.Exception.Message
  }
}
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "BOAT School.lnk"
Add-Check "Desktop shortcut" (Test-Path $desktopShortcut) $desktopShortcut
$settingsPath = Join-Path ([Environment]::GetFolderPath("ApplicationData")) "BOAT Desktop\settings.json"
Add-Check "Desktop API settings" (Test-Path $settingsPath) $settingsPath
$checks | Format-Table -AutoSize
if ($checks | Where-Object { -not $_.ok }) {
  exit 1
}
Write-Host "BOAT school server verification passed." -ForegroundColor Green
