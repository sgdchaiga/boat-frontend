#Requires -Version 5.1
param(
  [Parameter(Mandatory=$true)]
  [string]$ServerUrl,
  [string]$InstallDir = "C:\BOAT-School-Client"
)
$ErrorActionPreference = "Stop"
$DeployDir = $PSScriptRoot
$SourceRoot = Resolve-Path (Join-Path $DeployDir "..")

function Invoke-Checked {
  param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory)
  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$FilePath failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

function Get-NpmCommand {
  $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "npm not found. Install Node.js first."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required for client install. Install Node.js first."
}
$npm = Get-NpmCommand
$resolvedInstall = $null
if (Test-Path $InstallDir) {
  $resolvedInstall = (Resolve-Path $InstallDir).Path
}
if ($resolvedInstall -ne $SourceRoot.Path) {
  if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir | Out-Null }
  robocopy $SourceRoot $InstallDir /E /XD node_modules .git .runtime release release-desktop dist dist-ssr out | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Failed to copy client files." }
  $RepoRoot = (Resolve-Path $InstallDir).Path
} else {
  $RepoRoot = $SourceRoot.Path
}
Invoke-Checked $npm @("install") $RepoRoot
Invoke-Checked $npm @("run", "build:desktop:school-api") $RepoRoot
$appData = [Environment]::GetFolderPath("ApplicationData")
$settingsDir = Join-Path $appData "BOAT Desktop"
if (-not (Test-Path $settingsDir)) { New-Item -ItemType Directory -Path $settingsDir | Out-Null }
@{
  apiBaseUrl = $ServerUrl.TrimEnd("/")
  deploymentMode = "lan"
  businessType = "school"
} | ConvertTo-Json | Set-Content -Path (Join-Path $settingsDir "settings.json") -Encoding UTF8
$runtime = Join-Path $RepoRoot ".runtime"
if (-not (Test-Path $runtime)) { New-Item -ItemType Directory -Path $runtime | Out-Null }
$cmd = Join-Path $runtime "start-boat-school-client.cmd"
$vbs = Join-Path $runtime "start-boat-school-client.vbs"
$logPath = Join-Path $runtime "boat-school-client.log"
Set-Content -Path $cmd -Encoding ASCII -Value @"
@echo off
cd /d "$RepoRoot"
echo [%date% %time%] Starting BOAT School client > "$logPath"
set NODE_ENV=production
set VITE_DESKTOP_DATA_MODE=api
set BOAT_DESKTOP_DATA_MODE=api
if exist "$RepoRoot\node_modules\electron\dist\electron.exe" (
  "$RepoRoot\node_modules\electron\dist\electron.exe" "$RepoRoot" >> "$logPath" 2>>&1
) else (
  echo Electron was not found; falling back to npm. >> "$logPath"
  npm run desktop:run:school-api >> "$logPath" 2>>&1
)
if errorlevel 1 (
  echo BOAT School client failed. See log:
  echo "$logPath"
  pause
)
"@
Set-Content -Path $vbs -Encoding ASCII -Value @"
Set shell = CreateObject("WScript.Shell")
shell.Run Chr(34) & "$cmd" & Chr(34), 0, False
"@
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "BOAT School.lnk"
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $cmd
$shortcut.WorkingDirectory = $RepoRoot
$shortcut.Description = "Open BOAT School"
$shortcut.Save()
Write-Host "Client installed. Shortcut: $shortcutPath"
