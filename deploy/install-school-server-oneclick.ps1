#Requires -Version 5.1
<#
  BOAT School Server one-click installer for Windows.

  Intended use:
    1) Copy the BOAT release folder to the client's server PC.
    2) Right-click this file -> Run with PowerShell.
    3) Client uses the created "BOAT School" desktop icon.

  Default mode uses native PostgreSQL + Node.js on Windows. Docker remains
  available with -Backend docker, but native is lighter and avoids Docker
  Desktop / WSL startup issues on client servers.
#>

param(
  [ValidateSet("lan", "wan")]
  [string]$Mode = "lan",
  [ValidateSet("native", "docker")]
  [string]$Backend = "native",
  [int]$ApiPort = 3001,
  [int]$PostgresPort = 5432,
  [string]$PostgresUser = "postgres",
  [string]$PostgresPassword = $(if ($env:BOAT_PG_PASSWORD) { $env:BOAT_PG_PASSWORD } else { "BoatSchool1!" }),
  [string]$PostgresDb = "boat",
  [string]$CorsOrigin = "",
  [switch]$SkipMigrations,
  [switch]$SkipDependencyInstall,
  [switch]$InstallPostgreSql,
  [switch]$SkipPostgreSQLInstall,
  [switch]$NoFirewall,
  [switch]$OfflineOnly,
  [string]$AdminEmail = "admin@school.local",
  [string]$AdminPassword = "ChangeMe123!",
  [string]$AdminName = "School Administrator",
  [string]$AdminPin = "1234"
)

$ErrorActionPreference = "Stop"

$DeployDir = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $DeployDir "..")).Path
$RuntimeDir = Join-Path $RepoRoot ".runtime"
$InstallLogDir = Join-Path $RepoRoot "install-logs"
$SchoolServerScript = Join-Path $RepoRoot "scripts\school-server.ps1"
$DesktopShortcutName = "BOAT School.lnk"
$ApiBaseUrl = "http://127.0.0.1:$ApiPort"
if (-not (Test-Path $InstallLogDir)) {
  New-Item -ItemType Directory -Path $InstallLogDir | Out-Null
}
$InstallTranscript = Join-Path $InstallLogDir ("install-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
try {
  Start-Transcript -Path $InstallTranscript -Append | Out-Null
  Write-Host "Installer log: $InstallTranscript"
} catch {
  Write-Host "Could not start installer transcript: $($_.Exception.Message)" -ForegroundColor Yellow
}
$PrerequisiteDirs = @(
  (Join-Path $DeployDir "prerequisites"),
  (Join-Path $RepoRoot "prerequisites")
)

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Test-Command {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory = $RepoRoot
  )
  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $extra = @(
    (Join-Path $env:ProgramFiles "Docker\Docker\resources\bin"),
    (Join-Path $env:ProgramFiles "nodejs")
  ) | Where-Object { Test-Path $_ }
  foreach ($root in @("${env:ProgramFiles}\PostgreSQL", "${env:ProgramFiles(x86)}\PostgreSQL")) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      $binDir = Join-Path $_.FullName "bin"
      if (Test-Path (Join-Path $binDir "psql.exe")) {
        $extra += $binDir
      }
    }
  }
  $env:Path = (@($machinePath, $userPath) + $extra | Where-Object { $_ }) -join ";"
}

function Find-Prerequisite {
  param([string[]]$Patterns)
  foreach ($dir in $PrerequisiteDirs) {
    if (-not (Test-Path $dir)) {
      continue
    }
    foreach ($pattern in $Patterns) {
      $match = Get-ChildItem -Path $dir -Filter $pattern -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
      if ($match) {
        return $match.FullName
      }
    }
  }
  return $null
}

function Get-NpmCommand {
  $npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
  if ($npm) { return $npm.Source }
  $npm = Get-Command "npm" -ErrorAction SilentlyContinue
  if ($npm) { return $npm.Source }
  throw "npm not found on PATH. Install Node.js and re-run this installer."
}

function Install-WithWinget {
  param(
    [string]$PackageId,
    [string]$FriendlyName
  )
  if ($OfflineOnly) {
    throw "$FriendlyName is not installed and no bundled installer was found. OfflineOnly blocks winget fallback."
  }
  if (-not (Test-Command "winget")) {
    throw "$FriendlyName is not installed and winget is not available. Install $FriendlyName, then re-run this installer."
  }
  Write-Host "Installing $FriendlyName with winget..."
  & winget install --id $PackageId -e --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "winget could not install $FriendlyName (exit $LASTEXITCODE)."
  }
}

function Install-NodeFromBundle {
  $installer = Find-Prerequisite -Patterns @("node-v*-x64.msi", "node-*-x64.msi", "node*.msi")
  if (-not $installer) {
    return $false
  }
  Write-Host "Installing bundled Node.js: $installer"
  $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/i", "`"$installer`"", "/qn", "/norestart") -Wait -PassThru
  if ($proc.ExitCode -ne 0) {
    throw "Bundled Node.js installer failed with exit code $($proc.ExitCode)."
  }
  Refresh-ProcessPath
  return $true
}

function Install-DockerFromBundle {
  $installer = Find-Prerequisite -Patterns @("Docker Desktop Installer.exe", "Docker*.exe")
  if (-not $installer) {
    return $false
  }
  Write-Host "Installing bundled Docker Desktop: $installer"
  $proc = Start-Process -FilePath $installer -ArgumentList @("install", "--quiet", "--accept-license") -Wait -PassThru
  if ($proc.ExitCode -ne 0) {
    Write-Host "Docker installer rejected --accept-license; retrying quiet install..." -ForegroundColor Yellow
    $proc = Start-Process -FilePath $installer -ArgumentList @("install", "--quiet") -Wait -PassThru
  }
  if ($proc.ExitCode -ne 0) {
    throw "Bundled Docker Desktop installer failed with exit code $($proc.ExitCode)."
  }
  Refresh-ProcessPath
  return $true
}

function Install-PostgreSqlFromBundle {
  $installer = Find-Prerequisite -Patterns @("postgresql-*-windows-x64.exe", "postgresql*.exe")
  if (-not $installer) {
    return $false
  }
  Write-Host "Installing bundled PostgreSQL: $installer"
  $pgLog = Join-Path $InstallLogDir ("postgresql-install-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
  $pgPrefix = Join-Path $RepoRoot "PostgreSQL"
  $pgData = Join-Path $RepoRoot "postgres-data-$PostgresPort"
  $serviceName = "boat-postgresql-$PostgresPort"
  $proc = Start-Process -FilePath $installer -ArgumentList @(
    "--mode", "unattended",
    "--unattendedmodeui", "minimal",
    "--superpassword", $PostgresPassword,
    "--serverport", "$PostgresPort",
    "--disable-components", "stackbuilder",
    "--prefix", $pgPrefix,
    "--datadir", $pgData,
    "--servicename", $serviceName,
    "--debuglevel", "2",
    "--debugtrace", $pgLog
  ) -Wait -PassThru
  if ($proc.ExitCode -ne 0) {
    throw "Bundled PostgreSQL installer failed with exit code $($proc.ExitCode). PostgreSQL log: $pgLog"
  }
  Refresh-ProcessPath
  return $true
}

function Ensure-Node {
  Refresh-ProcessPath
  if (Test-Command "node" -and (Test-Command "npm.cmd" -or Test-Command "npm")) {
    $nodeVersion = (& node --version)
    Write-Host "Node.js found: $nodeVersion"
    return
  }
  if (-not (Install-NodeFromBundle)) {
    Install-WithWinget -PackageId "OpenJS.NodeJS.LTS" -FriendlyName "Node.js LTS"
  }
  Refresh-ProcessPath
  if (-not (Test-Command "node")) {
    throw "Node.js was installed but is not available in this PowerShell session. Close PowerShell and re-run this installer."
  }
  if (-not (Test-Command "npm.cmd") -and -not (Test-Command "npm")) {
    throw "Node.js was installed but npm is not available in this PowerShell session. Close PowerShell and re-run this installer."
  }
}

function Test-Psql {
  Refresh-ProcessPath
  return $null -ne (Get-Command psql -ErrorAction SilentlyContinue)
}

function Install-PostgreSqlWithWinget {
  if ($OfflineOnly) {
    throw "PostgreSQL is not installed and no bundled PostgreSQL installer was found. OfflineOnly blocks winget fallback."
  }
  if (-not (Test-Command "winget")) {
    throw "PostgreSQL is not installed and winget is not available. Install PostgreSQL 16+ manually, then re-run this installer."
  }
  Write-Host "Installing PostgreSQL with winget..."
  $ids = @("PostgreSQL.PostgreSQL.17", "PostgreSQL.PostgreSQL.16", "PostgreSQL.PostgreSQL")
  foreach ($id in $ids) {
    & winget install -e --id $id --accept-package-agreements --accept-source-agreements --silent
    if ($LASTEXITCODE -eq 0) {
      Refresh-ProcessPath
      return
    }
    Write-Host "winget install $id exited $LASTEXITCODE; trying next package id..."
  }
  throw "winget could not install PostgreSQL. Install PostgreSQL 16+ manually, then re-run this installer."
}

function Ensure-PostgreSql {
  Refresh-ProcessPath
  if (-not $InstallPostgreSql -and -not (Test-PostgresPort -Port $PostgresPort)) {
    throw "PostgreSQL is not ready on 127.0.0.1:$PostgresPort. Install PostgreSQL separately, then run the finish-postgres-setup shortcut."
  }
  if (-not (Test-Psql)) {
    if (-not $InstallPostgreSql) {
      throw "psql.exe was not found. Install PostgreSQL separately, then run the finish-postgres-setup shortcut."
    }
    if ($SkipPostgreSQLInstall) {
      throw "psql.exe was not found. Install PostgreSQL or remove -SkipPostgreSQLInstall."
    }
    if (-not (Install-PostgreSqlFromBundle)) {
      Install-PostgreSqlWithWinget
    }
  }
  Refresh-ProcessPath
  if (-not (Test-Psql)) {
    throw "PostgreSQL was installed but psql.exe is not available yet. Restart PowerShell or Windows, then re-run this installer."
  }
  $svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $svc) {
    if (-not $InstallPostgreSql) {
      throw "No PostgreSQL server service was found. Install PostgreSQL separately, then run the finish-postgres-setup shortcut."
    }
    Write-Host "psql.exe was found, but no PostgreSQL server service was found. Installing bundled PostgreSQL server..."
    if (-not (Install-PostgreSqlFromBundle)) {
      if ($OfflineOnly) {
        throw "PostgreSQL server service was not found and no bundled PostgreSQL installer was found. OfflineOnly blocks winget fallback."
      }
      Install-PostgreSqlWithWinget
    }
    Refresh-ProcessPath
    $svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  }
  if ($svc -and $svc.Status -ne "Running") {
    Write-Host "Starting PostgreSQL service: $($svc.Name)"
    Start-Service $svc.Name
  }
  if ($svc) {
    $deadline = (Get-Date).AddMinutes(2)
    while ((Get-Date) -lt $deadline) {
      if (Test-PostgresPort -Port $PostgresPort) {
        return
      }
      Start-Sleep -Seconds 3
    }
    Write-Host "PostgreSQL service exists but port $PostgresPort is not accepting connections yet." -ForegroundColor Yellow
  }
}

function Test-PostgresPort {
  param([int]$Port)
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(1000, $false)
    if ($ok) { $client.EndConnect($iar) }
    $client.Close()
    return $ok
  } catch {
    return $false
  }
}

function Find-AvailablePostgresPort {
  foreach ($candidate in @(55432, 55433, 55434, 55435, 55436, 55437, 55438, 55439)) {
    if (-not (Test-PostgresPort -Port $candidate)) {
      return $candidate
    }
  }
  throw "Could not find an available private PostgreSQL port for BOAT."
}

function Get-PrivatePostgresBinDir {
  $roots = @(
    (Join-Path $RepoRoot "PostgreSQL"),
    "${env:ProgramFiles}\PostgreSQL",
    "${env:ProgramFiles(x86)}\PostgreSQL"
  ) | Where-Object { $_ -and (Test-Path $_) }

  foreach ($root in $roots) {
    $matches = @(Get-ChildItem -Path $root -Recurse -Filter "pg_ctl.exe" -ErrorAction SilentlyContinue |
      Where-Object {
        (Test-Path (Join-Path $_.Directory.FullName "initdb.exe")) -and
        (Test-Path (Join-Path $_.Directory.FullName "postgres.exe"))
      } |
      Sort-Object FullName -Descending)
    if ($matches.Count -gt 0) {
      return $matches[0].Directory.FullName
    }
  }
  return $null
}

function Write-PrivatePostgresStartup {
  param([string]$BinDir, [string]$DataDir)
  if (-not (Test-Path $RuntimeDir)) {
    New-Item -ItemType Directory -Path $RuntimeDir | Out-Null
  }
  $cmdPath = Join-Path $RuntimeDir "start-boat-postgres.cmd"
  $vbsPath = Join-Path $RuntimeDir "start-boat-postgres.vbs"
  $logPath = Join-Path $InstallLogDir "boat-postgres.log"
  $pgCtl = Join-Path $BinDir "pg_ctl.exe"
  $cmd = @"
@echo off
"$pgCtl" start -D "$DataDir" -l "$logPath" -o "-p $PostgresPort -h 127.0.0.1"
"@
  Set-Content -Path $cmdPath -Value $cmd -Encoding ASCII
  Set-Content -Path $vbsPath -Value @("Set shell = CreateObject(""WScript.Shell"")", "shell.Run Chr(34) & ""$cmdPath"" & Chr(34), 0, False") -Encoding ASCII
  $startup = [Environment]::GetFolderPath("Startup")
  if ($startup) {
    Copy-Item -Path $vbsPath -Destination (Join-Path $startup "BOAT PostgreSQL.vbs") -Force
  }
}

function Join-ProcessArguments {
  param([string[]]$Arguments)
  $quoted = @()
  foreach ($arg in $Arguments) {
    if ($arg -match '[\s"]') {
      $quoted += '"' + ($arg -replace '"', '\"') + '"'
    } else {
      $quoted += $arg
    }
  }
  return ($quoted -join " ")
}

function Invoke-ProcessChecked {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory = $RepoRoot,
    [string]$FailureMessage = "Process failed",
    [int]$TimeoutSeconds = 300
  )
  $stdout = Join-Path $InstallLogDir ("process-" + [Guid]::NewGuid().ToString("N") + ".out")
  $stderr = Join-Path $InstallLogDir ("process-" + [Guid]::NewGuid().ToString("N") + ".err")
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FilePath
  $psi.Arguments = Join-ProcessArguments -Arguments $Arguments
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $proc = [System.Diagnostics.Process]::Start($psi)
  $finished = $proc.WaitForExit($TimeoutSeconds * 1000)
  if (-not $finished) {
    try {
      $proc.Kill()
    } catch {
    }
    [System.IO.File]::WriteAllText($stdout, $proc.StandardOutput.ReadToEnd())
    [System.IO.File]::WriteAllText($stderr, $proc.StandardError.ReadToEnd())
    Write-Host "$FailureMessage timed out after $TimeoutSeconds second(s)." -ForegroundColor Yellow
    Write-Host "stdout: $stdout"
    Write-Host "stderr: $stderr"
    throw "$FailureMessage timed out."
  }
  [System.IO.File]::WriteAllText($stdout, $proc.StandardOutput.ReadToEnd())
  [System.IO.File]::WriteAllText($stderr, $proc.StandardError.ReadToEnd())
  if ($proc.ExitCode -ne 0) {
    Write-Host "$FailureMessage exited with $($proc.ExitCode)." -ForegroundColor Yellow
    Write-Host "stdout: $stdout"
    Write-Host "stderr: $stderr"
    throw "$FailureMessage failed with exit code $($proc.ExitCode)."
  }
  Remove-Item -Force $stdout, $stderr -ErrorAction SilentlyContinue
}

function Ensure-PrivatePostgresData {
  param([string]$BinDir, [string]$DataDir)
  $pgVersion = Join-Path $DataDir "PG_VERSION"
  if (Test-Path $pgVersion) {
    return
  }

  if (Test-Path $DataDir) {
    $backup = Join-Path $RepoRoot ("postgres-data-failed-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    Write-Host "Existing incomplete postgres data folder found. Moving it to: $backup"
    Move-Item -Path $DataDir -Destination $backup -Force
  }
  New-Item -ItemType Directory -Path $DataDir | Out-Null

  $pwFile = Join-Path $InstallLogDir ("pg-password-" + [Guid]::NewGuid().ToString("N") + ".txt")
  try {
    Set-Content -Path $pwFile -Value $PostgresPassword -Encoding ASCII
    $initdb = Join-Path $BinDir "initdb.exe"
    Invoke-ProcessChecked -FilePath $initdb -Arguments @("-D", $DataDir, "-U", $PostgresUser, "-A", "scram-sha-256", "--pwfile", $pwFile) -FailureMessage "initdb"
  } finally {
    Remove-Item -Force $pwFile -ErrorAction SilentlyContinue
  }
}

function Start-PrivatePostgresWithPgCtl {
  $binDir = Get-PrivatePostgresBinDir
  if (-not $binDir) {
    throw "PostgreSQL binaries were not found under $RepoRoot\PostgreSQL after installation."
  }

  $dataDir = Join-Path $RepoRoot "postgres-data-$PostgresPort"
  $serviceName = "boat-postgresql-$PostgresPort"
  Ensure-PrivatePostgresData -BinDir $binDir -DataDir $dataDir

  $pgCtl = Join-Path $binDir "pg_ctl.exe"
  $logPath = Join-Path $InstallLogDir "boat-postgres.log"
  Write-PrivatePostgresStartup -BinDir $binDir -DataDir $dataDir
  if (-not (Test-PostgresPort -Port $PostgresPort)) {
    Write-Host "Starting private BOAT PostgreSQL with pg_ctl..."
    try {
      Invoke-ProcessChecked -FilePath $pgCtl -Arguments @("start", "-w", "-t", "60", "-D", $dataDir, "-l", $logPath, "-o", "-p $PostgresPort -h 127.0.0.1") -FailureMessage "pg_ctl start" -TimeoutSeconds 90
    } catch {
      Write-Host "pg_ctl start reported an error; waiting briefly in case PostgreSQL is already starting." -ForegroundColor Yellow
    }
  }
  Write-Host "BOAT PostgreSQL binary folder: $binDir"
  Write-Host "BOAT PostgreSQL data folder: $dataDir"
  Write-Host "BOAT PostgreSQL log: $logPath"

  $deadline = (Get-Date).AddMinutes(2)
  while ((Get-Date) -lt $deadline) {
    if ((Test-PostgresPort -Port $PostgresPort) -and (Test-PostgresLogin -User $PostgresUser -Password $PostgresPassword -Port $PostgresPort)) {
      Write-Host "Private BOAT PostgreSQL is ready."
      return
    }
    Start-Sleep -Seconds 5
  }

  $pgLogDir = Join-Path $dataDir "log"
  Write-Host "BOAT PostgreSQL did not become ready. Data dir: $dataDir" -ForegroundColor Yellow
  Write-Host "PostgreSQL log folder, if present: $pgLogDir" -ForegroundColor Yellow
  throw "Private BOAT PostgreSQL did not become ready. Check install logs in $InstallLogDir."
}

function Install-PrivateBoatPostgreSql {
  Write-Host "Installing a private BOAT PostgreSQL instance so the existing unknown postgres password is not needed."
  $script:PostgresPort = Find-AvailablePostgresPort
  $script:PostgresUser = "postgres"
  $script:PostgresPassword = "BoatSchool1!"
  Write-Host "Private BOAT PostgreSQL port: $PostgresPort"

  $pgData = Join-Path $RepoRoot "postgres-data-$PostgresPort"
  if (Test-Path $pgData) {
    Write-Host "Existing BOAT postgres-data folder found for port $PostgresPort."
  }

  if (Get-PrivatePostgresBinDir) {
    Write-Host "BOAT PostgreSQL binaries already exist; configuring service directly."
  } else {
    if (-not (Install-PostgreSqlFromBundle)) {
      throw "Bundled PostgreSQL installer is required to create the private BOAT PostgreSQL instance."
    }
  }

  Start-PrivatePostgresWithPgCtl
}

function Test-PostgresLogin {
  param([string]$User, [string]$Password, [int]$Port)
  $oldPassword = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = $Password
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "psql"
    $psi.Arguments = "-h 127.0.0.1 -p $Port -U $User -d postgres -v ON_ERROR_STOP=1 -c ""SELECT 1"""
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    $proc.WaitForExit()
    return ($proc.ExitCode -eq 0)
  } finally {
    $env:PGPASSWORD = $oldPassword
  }
}

function Ensure-PostgresLogin {
  Write-Host "Testing PostgreSQL login as $PostgresUser@127.0.0.1:$PostgresPort ..."
  if (Test-PostgresLogin -User $PostgresUser -Password $PostgresPassword -Port $PostgresPort) {
    Write-Host "PostgreSQL login OK."
    return
  }

  Write-Host "PostgreSQL login failed with the current password." -ForegroundColor Yellow
  if (-not $InstallPostgreSql) {
    throw "PostgreSQL authentication failed. Install/configure PostgreSQL separately or rerun with -PostgresPassword."
  }
  if ($OfflineOnly -or (Find-Prerequisite -Patterns @("postgresql-*-windows-x64.exe", "postgresql*.exe"))) {
    Install-PrivateBoatPostgreSql
    return
  }

  Write-Host "If PostgreSQL was already installed, enter that existing postgres password."
  $try = Read-Host "PostgreSQL password for user $PostgresUser"
  if ([string]::IsNullOrWhiteSpace($try)) {
    throw "PostgreSQL login is required. Re-run with -PostgresPassword YOUR_PASSWORD or set BOAT_PG_PASSWORD."
  }
  $script:PostgresPassword = $try
  if (-not (Test-PostgresLogin -User $PostgresUser -Password $PostgresPassword -Port $PostgresPort)) {
    Install-PrivateBoatPostgreSql
  }
  Write-Host "PostgreSQL login OK."
}

function Ensure-Docker {
  Refresh-ProcessPath
  if (Test-Command "docker") {
    Write-Host "Docker found."
    return
  }
  if (-not (Install-DockerFromBundle)) {
    Install-WithWinget -PackageId "Docker.DockerDesktop" -FriendlyName "Docker Desktop"
  }
  Refresh-ProcessPath
  if (-not (Test-Command "docker")) {
    throw "Docker was installed but is not available yet. Restart Windows if needed, start Docker Desktop, then re-run this installer."
  }
}

function Test-DockerEngine {
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
    return ($proc.ExitCode -eq 0)
  } catch {
    return $false
  }
}

function Start-DockerDesktopIfAvailable {
  $candidates = @(
    (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Docker\Docker\Docker Desktop.exe"),
    (Join-Path $env:LocalAppData "Docker\Docker Desktop.exe")
  ) | Where-Object { $_ -and (Test-Path $_) }

  $dockerDesktop = $candidates | Select-Object -First 1
  if ($dockerDesktop) {
    Write-Host "Starting Docker Desktop..."
    Start-Process -FilePath $dockerDesktop | Out-Null
    return $true
  }
  return $false
}

function Ensure-DockerRunning {
  Write-Host "Checking Docker engine..."
  if (Test-DockerEngine) {
    Write-Host "Docker engine is running."
    return
  }

  $started = Start-DockerDesktopIfAvailable
  if (-not $started) {
    Write-Host "Docker command exists, but Docker Desktop was not found in the standard install folders." -ForegroundColor Yellow
  }

  Write-Host "Waiting for Docker engine. If Docker Desktop asks to finish setup or accept terms, complete that prompt."
  $deadline = (Get-Date).AddMinutes(8)
  while ((Get-Date) -lt $deadline) {
    if (Test-DockerEngine) {
      Write-Host "Docker engine is running."
      return
    }
    Write-Host "Still waiting for Docker engine..."
    Start-Sleep -Seconds 10
  }
  throw "Docker engine is not running. Start Docker Desktop, complete any WSL setup or terms prompts, wait until Docker says it is running, then re-run this installer."
}

function Has-NodeModules {
  param([string]$Path)
  return (Test-Path (Join-Path $Path "node_modules"))
}

function Has-RootDesktopNativeModules {
  $modulePath = Join-Path $RepoRoot "node_modules\better-sqlite3"
  return (Test-Path $modulePath)
}

function Ensure-Dependencies {
  if ($SkipDependencyInstall) {
    Write-Host "Skipping npm install because -SkipDependencyInstall was provided."
    return
  }
  $rootHasModules = Has-NodeModules -Path $RepoRoot
  $serverRoot = Join-Path $RepoRoot "server"
  $serverHasModules = Has-NodeModules -Path $serverRoot
  if ($rootHasModules -and $serverHasModules -and (Has-RootDesktopNativeModules)) {
    Write-Host "Bundled node_modules found; skipping npm install."
    return
  }
  if ($OfflineOnly) {
    throw "OfflineOnly was requested, but bundled node_modules is missing. Repack with -IncludeNodeModules."
  }
  Write-Step "Installing BOAT dependencies"
  $npm = Get-NpmCommand
  if (-not $rootHasModules) {
    Invoke-Checked -FilePath $npm -Arguments @("install") -WorkingDirectory $RepoRoot
  } elseif (-not (Has-RootDesktopNativeModules)) {
    Invoke-Checked -FilePath $npm -Arguments @("install") -WorkingDirectory $RepoRoot
  } else {
    Write-Host "Root node_modules found; skipping root npm install."
  }
  if (-not $serverHasModules) {
    Invoke-Checked -FilePath $npm -Arguments @("install") -WorkingDirectory $serverRoot
  } else {
    Write-Host "Server node_modules found; skipping server npm install."
  }
}

function Build-Boat {
  Write-Step "Building BOAT server and desktop"
  $npm = Get-NpmCommand
  Invoke-Checked -FilePath $npm -Arguments @("run", "build") -WorkingDirectory (Join-Path $RepoRoot "server")
  Invoke-Checked -FilePath $npm -Arguments @("run", "build:desktop:school-api") -WorkingDirectory $RepoRoot
}

function Add-BoatFirewallRule {
  param([int]$Port)
  if ($NoFirewall) {
    return
  }
  $ruleName = "BOAT School API $Port"
  $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "Firewall rule already exists: $ruleName"
    return
  }
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private | Out-Null
  Write-Host "Added Windows Firewall rule: $ruleName"
}

function Initialize-NativeDatabase {
  Write-Step "Preparing native PostgreSQL database"
  if ($PostgresDb -notmatch "^[a-zA-Z_][a-zA-Z0-9_]*$") {
    throw "PostgresDb must be a simple PostgreSQL identifier: letters, digits, underscore only."
  }
  $oldPassword = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = $PostgresPassword
    $exists = & psql -h 127.0.0.1 -p $PostgresPort -U $PostgresUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$PostgresDb'" 2>$null
    if ($exists -match "1") {
      Write-Host "Database already exists: $PostgresDb"
    } else {
      Write-Host "Creating database: $PostgresDb"
      & psql -h 127.0.0.1 -p $PostgresPort -U $PostgresUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $PostgresDb;"
      if ($LASTEXITCODE -ne 0) { throw "CREATE DATABASE failed with exit code $LASTEXITCODE" }
    }

    if (-not $SkipMigrations) {
      Write-Host "Applying BOAT database migrations..."
      $applyScript = Join-Path $RepoRoot "scripts\apply-migrations.ps1"
      if (-not (Test-Path $applyScript)) {
        throw "Missing migration script: $applyScript"
      }
      & $applyScript -PgHost "127.0.0.1" -Port $PostgresPort -Database $PostgresDb -User $PostgresUser
      if ($LASTEXITCODE -ne 0) { throw "Database migrations failed with exit code $LASTEXITCODE" }
    }
  } finally {
    $env:PGPASSWORD = $oldPassword
  }
}

function Write-NativeServerEnv {
  Write-Step "Writing native BOAT API settings"
  $serverEnv = Join-Path $RepoRoot "server\.env"
  $escapedPassword = [uri]::EscapeDataString($PostgresPassword)
  $dbUrl = "postgresql://$PostgresUser`:$escapedPassword@127.0.0.1:$PostgresPort/$PostgresDb`?schema=public"
  $cors = if ($Mode -eq "wan" -and $CorsOrigin.Trim()) { $CorsOrigin.Trim() } else { "*" }
  $lines = @(
    "DATABASE_URL=""$dbUrl""",
    "PORT=$ApiPort",
    "HOST=0.0.0.0",
    "NODE_ENV=production",
    "CORS_ORIGIN=$cors",
    ""
  )
  Set-Content -Path $serverEnv -Value $lines -Encoding UTF8
  Write-Host "Wrote $serverEnv"
}

function Start-NativeBoatApi {
  Write-Step "Starting native BOAT API"
  if (-not (Test-Path $RuntimeDir)) {
    New-Item -ItemType Directory -Path $RuntimeDir | Out-Null
  }
  $cmdPath = Join-Path $RuntimeDir "start-boat-school-api.cmd"
  $vbsPath = Join-Path $RuntimeDir "start-boat-school-api.vbs"
  $logPath = Join-Path $RuntimeDir "boat-school-api.log"
  $serverDir = Join-Path $RepoRoot "server"
  $cmd = @"
@echo off
cd /d "$serverDir"
set NODE_ENV=production
set PORT=$ApiPort
set HOST=0.0.0.0
node dist\index.js >> "$logPath" 2>>&1
"@
  Set-Content -Path $cmdPath -Value $cmd -Encoding ASCII
  $vbs = @"
Set shell = CreateObject("WScript.Shell")
shell.Run Chr(34) & "$cmdPath" & Chr(34), 0, False
"@
  Set-Content -Path $vbsPath -Value $vbs -Encoding ASCII
  Start-Process -FilePath "wscript.exe" -ArgumentList "`"$vbsPath`"" | Out-Null

  $startup = [Environment]::GetFolderPath("Startup")
  if ($startup) {
    Copy-Item -Path $vbsPath -Destination (Join-Path $startup "BOAT School API.vbs") -Force
  }

  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    try {
      $res = Invoke-WebRequest -UseBasicParsing -Uri "$ApiBaseUrl/health" -TimeoutSec 3
      if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 500) {
        Write-Host "BOAT API is running: $ApiBaseUrl"
        return
      }
    } catch {
      Start-Sleep -Seconds 3
    }
  }
  Write-Host "BOAT API did not answer yet. Check log: $logPath" -ForegroundColor Yellow
}

function Write-PostgreSqlPendingSetup {
  param([string]$Reason)
  Write-Step "PostgreSQL setup pending"
  if (-not (Test-Path $RuntimeDir)) {
    New-Item -ItemType Directory -Path $RuntimeDir | Out-Null
  }
  $finishPs1 = Join-Path $RuntimeDir "finish-postgres-setup.ps1"
  $finishCmd = Join-Path $RuntimeDir "finish-postgres-setup.cmd"
  $reasonFile = Join-Path $RuntimeDir "postgres-pending.txt"
  $reasonLines = @(
    "BOAT was installed, but PostgreSQL is not ready yet.",
    "",
    "Reason:",
    $Reason,
    "",
    "Install PostgreSQL separately, then run:",
    "  $finishCmd",
    "",
    "If PostgreSQL uses a different password, edit finish-postgres-setup.ps1 and set -PostgresPassword."
  )
  Set-Content -Path $reasonFile -Value $reasonLines -Encoding UTF8

  $finish = @"
#Requires -Version 5.1
`$ErrorActionPreference = "Stop"
powershell -ExecutionPolicy Bypass -File "$DeployDir\install-school-server-oneclick.ps1" -Mode "$Mode" -Backend native -ApiPort $ApiPort -PostgresPort $PostgresPort -PostgresUser "$PostgresUser" -PostgresDb "$PostgresDb" -SkipDependencyInstall
"@
  Set-Content -Path $finishPs1 -Value $finish -Encoding UTF8

  $cmd = @"
@echo off
powershell -ExecutionPolicy Bypass -File "$finishPs1"
pause
"@
  Set-Content -Path $finishCmd -Value $cmd -Encoding ASCII

  Write-Host "BOAT files, desktop settings, and shortcuts will still be installed."
  Write-Host "After installing PostgreSQL separately, run:"
  Write-Host "  $finishCmd"
  Write-Host "Details: $reasonFile"
}

function Invoke-SchoolServer {
  param([string]$Action)
  $args = @(
    "-ExecutionPolicy", "Bypass",
    "-File", $SchoolServerScript,
    "-Action", $Action,
    "-Mode", $Mode,
    "-ApiPort", "$ApiPort",
    "-PostgresPort", "$PostgresPort"
  )
  if ($Mode -eq "wan") {
    if (-not $CorsOrigin.Trim()) {
      throw "WAN mode requires -CorsOrigin, for example https://school.example.com"
    }
    $args += @("-CorsOrigin", $CorsOrigin.Trim())
  }
  if (-not $NoFirewall -and $Action -eq "init") {
    $args += "-AllowFirewall"
  }
  Invoke-Checked -FilePath "powershell" -Arguments $args -WorkingDirectory $RepoRoot
}

function Write-ElectronSettings {
  Write-Step "Writing BOAT Desktop server setting"
  $appData = [Environment]::GetFolderPath("ApplicationData")
  $settingsDir = Join-Path $appData "BOAT Desktop"
  if (-not (Test-Path $settingsDir)) {
    New-Item -ItemType Directory -Path $settingsDir | Out-Null
  }
  $settings = [ordered]@{
    apiBaseUrl = $ApiBaseUrl
    deploymentMode = $Mode
    businessType = "school"
  } | ConvertTo-Json
  Set-Content -Path (Join-Path $settingsDir "settings.json") -Value $settings -Encoding UTF8
  Write-Host "Desktop API URL set to $ApiBaseUrl"
}

function Write-BootstrapAdmin {
  Write-Step "Writing first-admin bootstrap"
  $appData = [Environment]::GetFolderPath("ApplicationData")
  $settingsDir = Join-Path $appData "BOAT Desktop"
  if (-not (Test-Path $settingsDir)) {
    New-Item -ItemType Directory -Path $settingsDir | Out-Null
  }
  $payload = [ordered]@{
    email = $AdminEmail
    password = $AdminPassword
    full_name = $AdminName
    role = "admin"
    staff_code = "ADMIN001"
    pin = $AdminPin
  } | ConvertTo-Json
  Set-Content -Path (Join-Path $settingsDir "bootstrap-admin.json") -Value $payload -Encoding UTF8
  Write-Host "Initial login: $AdminEmail / $AdminPassword"
  Write-Host "Initial PIN: $AdminPin"
}

function Write-Launchers {
  Write-Step "Creating BOAT launchers"
  if (-not (Test-Path $RuntimeDir)) {
    New-Item -ItemType Directory -Path $RuntimeDir | Out-Null
  }

  $cmdPath = Join-Path $RuntimeDir "start-boat-school.cmd"
  $vbsPath = Join-Path $RuntimeDir "start-boat-school.vbs"
  $logPath = Join-Path $RuntimeDir "boat-school-desktop.log"

  $cmd = @"
@echo off
cd /d "$RepoRoot"
echo [%date% %time%] Starting BOAT School desktop > "$logPath"
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
  echo. >> "$logPath"
  echo BOAT School desktop failed with exit code %errorlevel%. >> "$logPath"
  echo BOAT School desktop failed. See log:
  echo "$logPath"
  pause
)
"@
  Set-Content -Path $cmdPath -Value $cmd -Encoding ASCII

  $vbs = @"
Set shell = CreateObject("WScript.Shell")
shell.Run Chr(34) & "$cmdPath" & Chr(34), 0, False
"@
  Set-Content -Path $vbsPath -Value $vbs -Encoding ASCII

  $desktop = [Environment]::GetFolderPath("Desktop")
  $shortcutPath = Join-Path $desktop $DesktopShortcutName
  $wsh = New-Object -ComObject WScript.Shell
  $shortcut = $wsh.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $cmdPath
  $shortcut.WorkingDirectory = $RepoRoot
  $shortcut.Description = "Open BOAT School"
  $electronIcon = Join-Path $RepoRoot "node_modules\electron\dist\electron.exe"
  if (Test-Path $electronIcon) {
    $shortcut.IconLocation = $electronIcon
  }
  $shortcut.Save()
  Write-Host "Desktop shortcut created: $shortcutPath"
}

function Write-InstallSummary {
  Write-Step "Install complete"
  Write-Host "Client login icon: $([Environment]::GetFolderPath("Desktop"))\$DesktopShortcutName"
  Write-Host "Local API: $ApiBaseUrl"
  Write-Host "Server status: npm run school-server:status"
  Write-Host "Backups: npm run school-server:backup"
  Write-Host ""
  Write-Host "For other PCs on the LAN, install BOAT Desktop school API mode and point it to this server PC IP on port $ApiPort."
}

if (-not (Test-Path $SchoolServerScript)) {
  throw "Missing $SchoolServerScript. This installer must be run from a complete BOAT release folder."
}

Write-Step "BOAT School Server one-click install"
Write-Host "Install folder: $RepoRoot"
Write-Host "Mode: $Mode"
Write-Host "Backend: $Backend"
Write-Host "API port: $ApiPort"

Ensure-Node
Ensure-Dependencies
Build-Boat

if ($Backend -eq "docker") {
  Ensure-Docker
  Ensure-DockerRunning
  Write-Step "Starting BOAT school server"
  Invoke-SchoolServer -Action "init"
  Invoke-SchoolServer -Action "start"
  if (-not $SkipMigrations) {
    Invoke-SchoolServer -Action "migrate"
  }
  Invoke-SchoolServer -Action "status"
} else {
  $postgresReady = $true
  try {
    Ensure-PostgreSql
    Ensure-PostgresLogin
    Initialize-NativeDatabase
    Write-NativeServerEnv
    Add-BoatFirewallRule -Port $ApiPort
    Start-NativeBoatApi
  } catch {
    $postgresReady = $false
    Write-PostgreSqlPendingSetup -Reason $_.Exception.Message
  }
}

Write-ElectronSettings
Write-BootstrapAdmin
Write-Launchers
Write-InstallSummary
