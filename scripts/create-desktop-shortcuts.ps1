$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$desktopPath = [Environment]::GetFolderPath("Desktop")

$startBat = Join-Path $repoRoot "Start-BOAT.bat"
$stopBat = Join-Path $repoRoot "Stop-BOAT.bat"
$startVbs = Join-Path $repoRoot "Start-BOAT.vbs"
$stopVbs = Join-Path $repoRoot "Stop-BOAT.vbs"

if (-not (Test-Path $startBat)) {
  throw "Start script not found: $startBat"
}
if (-not (Test-Path $stopBat)) {
  throw "Stop script not found: $stopBat"
}
if (-not (Test-Path $startVbs)) {
  throw "Start launcher not found: $startVbs"
}
if (-not (Test-Path $stopVbs)) {
  throw "Stop launcher not found: $stopVbs"
}

$wsh = New-Object -ComObject WScript.Shell

function New-Shortcut {
  param(
    [string]$ShortcutPath,
    [string]$TargetPath,
    [string]$WorkingDirectory,
    [string]$Description
  )

  $shortcut = $wsh.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.Description = $Description
  $shortcut.Save()
}

$startShortcut = Join-Path $desktopPath "Start BOAT.lnk"
$stopShortcut = Join-Path $desktopPath "Stop BOAT.lnk"

New-Shortcut `
  -ShortcutPath $startShortcut `
  -TargetPath $startVbs `
  -WorkingDirectory $repoRoot `
  -Description "Start BOAT system (server + frontend)"

New-Shortcut `
  -ShortcutPath $stopShortcut `
  -TargetPath $stopVbs `
  -WorkingDirectory $repoRoot `
  -Description "Stop BOAT system"

Write-Host "Desktop shortcuts created:" -ForegroundColor Green
Write-Host "- $startShortcut"
Write-Host "- $stopShortcut"
