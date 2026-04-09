#Requires -Version 5.1
<#
  Build a ZIP you can send to a client for on-prem install (no node_modules).

  Run from repo root:
    powershell -ExecutionPolicy Bypass -File .\scripts\pack-release.ps1

  Output: dist\boat-onprem-YYYYMMDD-HHmmss.zip
#>

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$DistDir = Join-Path $RepoRoot "dist"
if (-not (Test-Path $DistDir)) {
  New-Item -ItemType Directory -Path $DistDir | Out-Null
}

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Staging = Join-Path $env:TEMP "boat-onprem-$Stamp"
$ZipName = "boat-onprem-$Stamp.zip"
$ZipPath = Join-Path $DistDir $ZipName

if (Test-Path $Staging) {
  Remove-Item -Recurse -Force $Staging
}
New-Item -ItemType Directory -Path $Staging | Out-Null

function Invoke-Robocopy {
  param([string]$Source, [string]$Dest, [string[]]$ExtraExcludeDirs = @())
  $xd = @("node_modules", "dist", ".git") + $ExtraExcludeDirs
  $xdArgs = $xd | ForEach-Object { "/XD"; $_ }
  $args = @($Source, $Dest, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS") + $xdArgs
  & robocopy @args | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed ($LASTEXITCODE): $Source -> $Dest"
  }
}

Write-Host "Staging: $Staging"

# App + API + deploy + DB migrations
Invoke-Robocopy (Join-Path $RepoRoot "src") (Join-Path $Staging "src")
if (Test-Path (Join-Path $RepoRoot "public")) {
  Invoke-Robocopy (Join-Path $RepoRoot "public") (Join-Path $Staging "public")
}
Invoke-Robocopy (Join-Path $RepoRoot "server") (Join-Path $Staging "server")
Invoke-Robocopy (Join-Path $RepoRoot "deploy") (Join-Path $Staging "deploy")
Invoke-Robocopy (Join-Path $RepoRoot "scripts") (Join-Path $Staging "scripts")
Invoke-Robocopy (Join-Path $RepoRoot "supabase") (Join-Path $Staging "supabase")

$rootFiles = @(
  "package.json",
  "package-lock.json",
  ".env.example",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "index.html",
  "tailwind.config.ts",
  "postcss.config.js",
  "eslint.config.js"
)

foreach ($f in $rootFiles) {
  $src = Join-Path $RepoRoot $f
  if (Test-Path $src) {
    Copy-Item $src $Staging -Force
  }
}

# Client doc at zip root
$releaseDoc = Join-Path $RepoRoot "deploy\RELEASE.md"
if (Test-Path $releaseDoc) {
  Copy-Item $releaseDoc (Join-Path $Staging "RELEASE.md") -Force
}

if (-not (Test-Path (Join-Path $Staging "package.json"))) {
  throw "package.json missing - run from BOAT repo root."
}

Write-Host "Compressing: $ZipPath"
if (Test-Path $ZipPath) {
  Remove-Item -Force $ZipPath
}
Compress-Archive -Path (Join-Path $Staging "*") -DestinationPath $ZipPath -CompressionLevel Optimal -ErrorAction Stop

Remove-Item -Recurse -Force $Staging

Write-Host ""
Write-Host "Created: $ZipPath"
Write-Host "Send this ZIP to the client. They follow RELEASE.md inside the archive."
