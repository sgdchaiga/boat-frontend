#Requires -Version 5.1
<#
  Creates a single self-extracting BOAT school server installer.

  The generated .ps1 contains a zipped BOAT release payload. On the client
  server PC it extracts to C:\BOAT-School by default and runs
  deploy/install-school-server-oneclick.ps1. Pass -OfflineOnly to make the
  generated installer use bundled prerequisites by default.

  Use -IncludeNodeModules and -IncludeDockerImages on the packaging machine
  to create a larger, more complete offline installer.
  Run from repo root:
    npm run pack:school-server-onefile

  Output:
    release/school-server-installer/BOAT-School-Server-Installer-*.ps1
#>

param(
  [string]$OutputDir = "",
  [string]$InstallDir = "C:\BOAT-School",
  [switch]$SkipBuild,
  [switch]$OfflineOnly,
  [switch]$IncludeNodeModules,
  [switch]$IncludeDockerImages,
  [switch]$IncludePostgreSqlInstaller
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not $OutputDir.Trim()) {
  $OutputDir = Join-Path $RepoRoot "release\school-server-installer"
}
if (-not (Test-Path $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$Staging = Join-Path $env:TEMP "boat-school-server-payload-$Stamp"
$ZipPath = Join-Path $env:TEMP "boat-school-server-payload-$Stamp.zip"
$InstallerPath = Join-Path $OutputDir "BOAT-School-Server-Installer-$Stamp.ps1"
$ExeInstallerPath = Join-Path $OutputDir "BOAT-School-Server-Setup-$Stamp.exe"

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

function Invoke-Robocopy {
  param(
    [string]$Source,
    [string]$Dest,
    [string[]]$ExtraExcludeDirs = @()
  )
  if (-not (Test-Path $Source)) {
    return
  }
  $excludeDirs = @(
    "node_modules",
    ".git",
    ".runtime",
    "release",
    "release-desktop",
    "dist",
    "dist-ssr",
    "out",
    ".vite"
  ) + $ExtraExcludeDirs
  $xdArgs = $excludeDirs | ForEach-Object { "/XD"; $_ }
  $args = @($Source, $Dest, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS") + $xdArgs
  & robocopy @args | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed ($LASTEXITCODE): $Source -> $Dest"
  }
}

function Invoke-RobocopyIncludingNodeModules {
  param([string]$Source, [string]$Dest)
  if (-not (Test-Path $Source)) {
    return
  }
  $excludeDirs = @(".git", ".runtime", "release", "release-desktop", "dist-ssr", "out", ".vite")
  $xdArgs = $excludeDirs | ForEach-Object { "/XD"; $_ }
  $args = @($Source, $Dest, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS") + $xdArgs
  & robocopy @args | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed ($LASTEXITCODE): $Source -> $Dest"
  }
}

function Copy-RootFile {
  param([string]$Name)
  $source = Join-Path $RepoRoot $Name
  if (Test-Path $source) {
    Copy-Item $source (Join-Path $Staging $Name) -Force
  }
}

function Add-TextFile {
  param(
    [string]$Path,
    [string[]]$Lines
  )
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
  }
  Set-Content -Path $Path -Value $Lines -Encoding ASCII
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name not found on PATH."
  }
}

function Add-DockerImageBundle {
  $imageDir = Join-Path $Staging "deploy\docker-images"
  if (-not (Test-Path $imageDir)) {
    New-Item -ItemType Directory -Path $imageDir | Out-Null
  }
  $tarPath = Join-Path $imageDir "boat-school-docker-images.tar"
  Assert-Command "docker"

  Write-Host "Preparing offline Docker image bundle..."
  Push-Location $RepoRoot
  try {
    & docker pull postgres:16-alpine
    if ($LASTEXITCODE -ne 0) {
      throw "docker pull postgres:16-alpine failed."
    }
    & docker build -t boat-api:school-offline .\server
    if ($LASTEXITCODE -ne 0) {
      throw "docker build boat-api:school-offline failed."
    }
    & docker save -o $tarPath postgres:16-alpine boat-api:school-offline
    if ($LASTEXITCODE -ne 0) {
      throw "docker save failed."
    }
  } finally {
    Pop-Location
  }
  Write-Host "Bundled Docker images: $tarPath"
}

function New-IExpressInstaller {
  param(
    [string]$PayloadZipPath,
    [string]$TargetExePath
  )

  $iexpress = Get-Command "iexpress.exe" -ErrorAction SilentlyContinue
  if (-not $iexpress) {
    Write-Warning "iexpress.exe was not found. Skipping .exe wrapper creation."
    return $false
  }

  $wrapperDir = Join-Path $env:TEMP "boat-school-server-exe-$Stamp"
  $payloadPath = Join-Path $wrapperDir "payload.zip"
  $runnerPath = Join-Path $wrapperDir "run-installer.ps1"
  $cmdPath = Join-Path $wrapperDir "install.cmd"
  $sedPath = Join-Path $wrapperDir "boat-school-server.sed"
  if (Test-Path $wrapperDir) {
    Remove-Item -Recurse -Force $wrapperDir
  }
  New-Item -ItemType Directory -Path $wrapperDir | Out-Null

  Copy-Item -Path $PayloadZipPath -Destination $payloadPath -Force
  $offlineDefault = if ($OfflineOnly) { "`$true" } else { "`$false" }
  Set-Content -Path $runnerPath -Encoding ASCII -Value @"
param(
  [ValidateSet("lan", "wan")]
  [string]`$Mode = "lan",
  [string]`$InstallDir = "$InstallDir",
  [int]`$ApiPort = 3001,
  [int]`$PostgresPort = 5432,
  [string]`$CorsOrigin = "",
  [switch]`$SkipMigrations,
  [switch]`$SkipDependencyInstall,
  [switch]`$NoFirewall,
  [switch]`$OfflineOnly,
  [switch]`$ExtractOnly
)

`$ErrorActionPreference = "Stop"
`$offlineByDefault = $offlineDefault
if (`$offlineByDefault) {
  `$OfflineOnly = `$true
}

function Write-Step {
  param([string]`$Message)
  Write-Host ""
  Write-Host "== `$Message ==" -ForegroundColor Cyan
}

function Invoke-Checked {
  param([string]`$FilePath, [string[]]`$Arguments, [string]`$WorkingDirectory)
  Push-Location `$WorkingDirectory
  try {
    & `$FilePath @Arguments
    if (`$LASTEXITCODE -ne 0) {
      throw "`$FilePath `$(`$Arguments -join ' ') failed with exit code `$LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

Write-Step "Extracting BOAT School Server"
if (-not (Test-Path `$InstallDir)) {
  New-Item -ItemType Directory -Path `$InstallDir | Out-Null
}
`$archive = Join-Path `$PSScriptRoot "payload.zip"
if (-not (Test-Path `$archive)) {
  throw "Missing installer payload: `$archive"
}
Expand-Archive -Path `$archive -DestinationPath `$InstallDir -Force

Write-Host "Installed files extracted to: `$InstallDir"
if (`$ExtractOnly) {
  Write-Host "ExtractOnly was provided; installer did not start services."
  exit 0
}

`$innerInstaller = Join-Path `$InstallDir "deploy\install-school-server-oneclick.ps1"
if (-not (Test-Path `$innerInstaller)) {
  throw "Missing inner installer: `$innerInstaller"
}

Write-Step "Running BOAT School Server installer"
`$args = @(
  "-ExecutionPolicy", "Bypass",
  "-File", `$innerInstaller,
  "-Mode", `$Mode,
  "-ApiPort", "`$ApiPort",
  "-PostgresPort", "`$PostgresPort"
)
if (`$Mode -eq "wan") {
  if (-not `$CorsOrigin.Trim()) {
    throw "WAN mode requires -CorsOrigin, for example https://school.example.com"
  }
  `$args += @("-CorsOrigin", `$CorsOrigin.Trim())
}
if (`$SkipMigrations) { `$args += "-SkipMigrations" }
if (`$SkipDependencyInstall) { `$args += "-SkipDependencyInstall" }
if (`$NoFirewall) { `$args += "-NoFirewall" }
if (`$OfflineOnly) { `$args += "-OfflineOnly" }

Invoke-Checked -FilePath "powershell" -Arguments `$args -WorkingDirectory `$InstallDir

Write-Step "Done"
Write-Host "BOAT School Server is installed at: `$InstallDir"
Write-Host "The client should use the BOAT School desktop icon to log in."
"@
  Set-Content -Path $cmdPath -Encoding ASCII -Value @(
    "@echo off",
    "setlocal",
    "powershell -NoProfile -ExecutionPolicy Bypass -File ""%~dp0run-installer.ps1"" %*",
    "set ""code=%ERRORLEVEL%""",
    "if not ""%code%""==""0"" (",
    "  echo.",
    "  echo BOAT School Server installer failed with exit code %code%.",
    "  pause",
    ")",
    "exit /b %code%"
  )

  $cscCandidates = @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
  )
  $csc = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($csc) {
    $sourcePath = Join-Path $wrapperDir "BoatSchoolInstallerLauncher.cs"
    $manifestPath = Join-Path $wrapperDir "BoatSchoolInstallerLauncher.manifest"
    Set-Content -Path $manifestPath -Encoding ASCII -Value @'
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="1.0.0.0" name="BOAT.School.Server.Installer" />
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v2">
    <security>
      <requestedPrivileges xmlns="urn:schemas-microsoft-com:asm.v3">
        <requestedExecutionLevel level="requireAdministrator" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
'@
    Set-Content -Path $sourcePath -Encoding ASCII -Value @'
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

internal static class BoatSchoolInstallerLauncher
{
    private static int Main(string[] args)
    {
        Console.Title = "BOAT School Server Installer";
        Console.WriteLine("BOAT School Server Installer");
        Console.WriteLine("============================");
        Console.WriteLine();

        try
        {
            string tempDir = Path.Combine(Path.GetTempPath(), "boat-school-server-installer-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempDir);
            string payloadPath = Path.Combine(tempDir, "payload.zip");
            string runnerPath = Path.Combine(tempDir, "run-installer.ps1");

            ExtractResource("payload.zip", payloadPath);
            ExtractResource("run-installer.ps1", runnerPath);

            Console.WriteLine("Installer files extracted to:");
            Console.WriteLine("  " + tempDir);
            Console.WriteLine();
            Console.WriteLine("Starting BOAT setup...");
            Console.WriteLine();

            string arguments =
                "-NoProfile -ExecutionPolicy Bypass -File " +
                Quote(runnerPath) +
                BuildForwardedArgs(args);

            using (Process process = new Process())
            {
                process.StartInfo.FileName = "powershell.exe";
                process.StartInfo.Arguments = arguments;
                process.StartInfo.UseShellExecute = false;
                process.Start();
                process.WaitForExit();

                Console.WriteLine();
                if (process.ExitCode == 0)
                {
                    Console.WriteLine("BOAT School Server installer finished.");
                }
                else
                {
                    Console.WriteLine("BOAT School Server installer failed with exit code " + process.ExitCode + ".");
                }
                Console.WriteLine("Press any key to close this window.");
                Console.ReadKey(true);
                return process.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("Installer could not start.");
            Console.WriteLine(ex.Message);
            Console.WriteLine();
            Console.WriteLine("Press any key to close this window.");
            Console.ReadKey(true);
            return 1;
        }
    }

    private static void ExtractResource(string resourceName, string destinationPath)
    {
        Assembly assembly = Assembly.GetExecutingAssembly();
        using (Stream input = assembly.GetManifestResourceStream(resourceName))
        {
            if (input == null)
            {
                throw new InvalidOperationException("Missing embedded resource: " + resourceName);
            }
            using (FileStream output = File.Create(destinationPath))
            {
                input.CopyTo(output);
            }
        }
    }

    private static string BuildForwardedArgs(string[] args)
    {
        if (args == null || args.Length == 0)
        {
            return "";
        }

        StringBuilder builder = new StringBuilder();
        foreach (string arg in args)
        {
            builder.Append(' ');
            builder.Append(Quote(arg));
        }
        return builder.ToString();
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
'@
    & $csc /nologo /target:exe "/out:$TargetExePath" "/win32manifest:$manifestPath" "/resource:$payloadPath,payload.zip" "/resource:$runnerPath,run-installer.ps1" $sourcePath
    if ($LASTEXITCODE -eq 0 -and (Test-Path $TargetExePath)) {
      return $true
    }
    Write-Warning "Compiled installer launcher failed; falling back to IExpress wrapper."
  } else {
    Write-Warning ".NET Framework C# compiler was not found; falling back to IExpress wrapper."
  }

  $sedLines = @(
    "[Version]",
    "Class=IEXPRESS",
    "SEDVersion=3",
    "",
    "[Options]",
    "PackagePurpose=InstallApp",
    "ShowInstallProgramWindow=1",
    "HideExtractAnimation=1",
    "UseLongFileName=1",
    "InsideCompressed=0",
    "CAB_FixedSize=0",
    "CAB_ResvCodeSigning=0",
    "RebootMode=N",
    "InstallPrompt=",
    "DisplayLicense=",
    "FinishMessage=BOAT School Server installer has finished.",
    "TargetName=$TargetExePath",
    "FriendlyName=BOAT School Server Installer",
    "AppLaunched=install.cmd",
    "PostInstallCmd=<None>",
    "AdminQuietInstCmd=install.cmd",
    "UserQuietInstCmd=install.cmd",
    "SourceFiles=SourceFiles",
    "",
    "[Strings]",
    "FILE0=""payload.zip""",
    "FILE1=""run-installer.ps1""",
    "FILE2=""install.cmd""",
    "",
    "[SourceFiles]",
    "SourceFiles0=$wrapperDir\",
    "",
    "[SourceFiles0]",
    "%FILE0%=",
    "%FILE1%=",
    "%FILE2%="
  )
  Set-Content -Path $sedPath -Value $sedLines -Encoding ASCII

  try {
    if (-not (Test-Path $TargetExePath)) {
      & $iexpress.Source /N /Q $sedPath
      $exitCode = $LASTEXITCODE
      $deadline = (Get-Date).AddSeconds(60)
      while (-not (Test-Path $TargetExePath)) {
        if ((Get-Date) -ge $deadline) {
          break
        }
        Start-Sleep -Milliseconds 500
      }

      if (-not (Test-Path $TargetExePath)) {
        if ($exitCode -ne 0) {
          Write-Warning "iexpress.exe failed with exit code $exitCode. Keeping the .ps1 installer fallback."
        } else {
          Write-Warning "iexpress.exe did not create the expected file: $TargetExePath"
        }
        Write-Warning "IExpress wrapper files were kept for troubleshooting: $wrapperDir"
        return $false
      }
    }
    return $true
  } finally {
    if ((Test-Path $TargetExePath) -and (Test-Path $wrapperDir)) {
      Remove-Item -Recurse -Force $wrapperDir
    }
  }
}

if (-not $SkipBuild) {
  Write-Host "Verifying BOAT builds before packaging..."
  Invoke-Checked -FilePath "npm.cmd" -Arguments @("run", "typecheck")
  Invoke-Checked -FilePath "npm.cmd" -Arguments @("run", "build") -WorkingDirectory (Join-Path $RepoRoot "server")
  Invoke-Checked -FilePath "npm.cmd" -Arguments @("run", "build:desktop:school-api")
}

if (Test-Path $Staging) {
  Remove-Item -Recurse -Force $Staging
}
if (Test-Path $ZipPath) {
  Remove-Item -Force $ZipPath
}
New-Item -ItemType Directory -Path $Staging | Out-Null

Write-Host "Staging payload: $Staging"
if ($IncludeNodeModules) {
  Write-Host "Including node_modules in installer payload. This can make the installer very large."
  Invoke-RobocopyIncludingNodeModules $RepoRoot $Staging
} else {
  foreach ($dir in @("src", "public", "server", "deploy", "scripts", "supabase", "desktop")) {
    Invoke-Robocopy (Join-Path $RepoRoot $dir) (Join-Path $Staging $dir)
  }
}

if ($IncludeDockerImages) {
  Add-DockerImageBundle
}

if (-not $IncludePostgreSqlInstaller) {
  $stagedPrereqDir = Join-Path $Staging "deploy\prerequisites"
  if (Test-Path $stagedPrereqDir) {
    Get-ChildItem -Path $stagedPrereqDir -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like "postgresql*.exe" -or $_.Name -like "postgres*.exe" } |
      Remove-Item -Force
  }
}

foreach ($file in @(
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
  "eslint.config.js",
  "components.json",
  "README.md"
)) {
  Copy-RootFile $file
}

Add-TextFile -Path (Join-Path $Staging "INSTALL-BOAT-SCHOOL-SERVER.txt") -Lines @(
  "BOAT School Server Installer Payload",
  "",
  "Preferred technician flow:",
  "  powershell -ExecutionPolicy Bypass -File .\deploy\install-school-server-oneclick.ps1",
  "  Add -OfflineOnly to require bundled Node/Docker installers.",
  "  Repack with -IncludeNodeModules to avoid npm install at the client site.",
  "  Repack with -IncludeDockerImages to avoid Docker image pulls/builds at the client site.",
  "",
  "If you received the self-extracting one-file installer, run that file instead.",
  "It extracts this payload and starts the same installer automatically."
)

Write-Host "Compressing payload..."
Compress-Archive -Path (Join-Path $Staging "*") -DestinationPath $ZipPath -CompressionLevel Optimal -ErrorAction Stop
$prereqDir = Join-Path $Staging "deploy\prerequisites"
$bundledPrereqs = @()
if (Test-Path $prereqDir) {
  $bundledPrereqs = @(Get-ChildItem -Path $prereqDir -File | Where-Object {
    $_.Name -notin @("README.md", ".gitkeep")
  })
}
if ($bundledPrereqs.Count -gt 0) {
  Write-Host "Bundled offline prerequisite(s):"
  foreach ($file in $bundledPrereqs) {
    Write-Host "  - $($file.Name)"
  }
} else {
  Write-Host "No bundled offline prerequisites found in deploy\prerequisites."
}
$payloadBytes = [System.IO.File]::ReadAllBytes($ZipPath)
$payloadBase64 = [Convert]::ToBase64String($payloadBytes)
$chunks = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt $payloadBase64.Length; $i += 7600) {
  $len = [Math]::Min(7600, $payloadBase64.Length - $i)
  $chunks.Add($payloadBase64.Substring($i, $len))
}

Write-Host "Writing self-extracting installer: $InstallerPath"
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("#Requires -Version 5.1")
$lines.Add("<#")
$lines.Add("  BOAT School Server self-extracting installer.")
$lines.Add("  Generated: $Stamp")
$lines.Add("#>")
$lines.Add("")
$lines.Add("param(")
$lines.Add("  [ValidateSet(""lan"", ""wan"")]")
$lines.Add("  [string]`$Mode = ""lan"",")
$lines.Add("  [string]`$InstallDir = ""$InstallDir"",")
$lines.Add("  [int]`$ApiPort = 3001,")
$lines.Add("  [int]`$PostgresPort = 5432,")
$lines.Add("  [string]`$CorsOrigin = """",")
$lines.Add("  [switch]`$SkipMigrations,")
$lines.Add("  [switch]`$SkipDependencyInstall,")
$lines.Add("  [switch]`$NoFirewall,")
$lines.Add("  [switch]`$OfflineOnly,")
$lines.Add("  [switch]`$ExtractOnly")
$lines.Add(")")
$lines.Add("")
$lines.Add("`$ErrorActionPreference = ""Stop""")
$lines.Add("if (""$($OfflineOnly.IsPresent)"" -eq ""True"") { `$OfflineOnly = `$true }")
$lines.Add("`$PayloadBase64Chunks = @(")
foreach ($chunk in $chunks) {
  $lines.Add("  ""$chunk""")
}
$lines.Add(")")
$lines.Add(@'
$PayloadBase64 = $PayloadBase64Chunks -join ""

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Invoke-Checked {
  param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory)
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

Write-Step "Extracting BOAT School Server"
if (-not (Test-Path $InstallDir)) {
  New-Item -ItemType Directory -Path $InstallDir | Out-Null
}
$tempZip = Join-Path $env:TEMP ("boat-school-server-" + [Guid]::NewGuid().ToString("N") + ".zip")
try {
  [System.IO.File]::WriteAllBytes($tempZip, [Convert]::FromBase64String($PayloadBase64))
  Expand-Archive -Path $tempZip -DestinationPath $InstallDir -Force
} finally {
  if (Test-Path $tempZip) {
    Remove-Item -Force $tempZip
  }
}

Write-Host "Installed files extracted to: $InstallDir"
if ($ExtractOnly) {
  Write-Host "ExtractOnly was provided; installer did not start services."
  exit 0
}

$innerInstaller = Join-Path $InstallDir "deploy\install-school-server-oneclick.ps1"
if (-not (Test-Path $innerInstaller)) {
  throw "Missing inner installer: $innerInstaller"
}

Write-Step "Running BOAT School Server installer"
$args = @(
  "-ExecutionPolicy", "Bypass",
  "-File", $innerInstaller,
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
if ($SkipMigrations) { $args += "-SkipMigrations" }
if ($SkipDependencyInstall) { $args += "-SkipDependencyInstall" }
if ($NoFirewall) { $args += "-NoFirewall" }
if ($OfflineOnly) { $args += "-OfflineOnly" }

Invoke-Checked -FilePath "powershell" -Arguments $args -WorkingDirectory $InstallDir

Write-Step "Done"
Write-Host "BOAT School Server is installed at: $InstallDir"
Write-Host "The client should use the BOAT School desktop icon to log in."
'@)

Set-Content -Path $InstallerPath -Value $lines -Encoding ASCII

$createdExe = New-IExpressInstaller -PayloadZipPath $ZipPath -TargetExePath $ExeInstallerPath

Remove-Item -Recurse -Force $Staging
Remove-Item -Force $ZipPath

Write-Host ""
if ($createdExe) {
  Write-Host "Created Windows installer:"
  Write-Host "  $ExeInstallerPath"
  Write-Host ""
  Write-Host "Carry this one .exe file to the client server and double-click it."
} else {
  Write-Host "Created PowerShell installer:"
  Write-Host "  $InstallerPath"
  Write-Host ""
  Write-Host "Carry this one .ps1 file to the client server and run:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File `"$InstallerPath`""
}
Write-Host ""
Write-Host "Fallback PowerShell installer:"
Write-Host "  $InstallerPath"
