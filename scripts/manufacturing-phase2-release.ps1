# One-time release for the manufacturing migrations dated 2026-09-15.
# Default is a read-only dry run. -Apply explicitly opts into the live push.
param([switch]$Apply, [switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$releaseRepo = Split-Path $PSScriptRoot -Parent
$releaseSource = Join-Path $releaseRepo 'supabase'
$releaseNames = @(
  '20260915100000_validate_manufacturing_order_boms.sql',
  '20260915103000_snapshot_manufacturing_work_order_bom.sql',
  '20260915110000_manufacturing_material_reservations.sql',
  '20260915120000_manufacturing_routings_and_job_cards.sql',
  '20260915130000_manufacturing_lots_and_quality.sql',
  '20260915133000_link_production_output_lots.sql',
  '20260915134500_apply_output_lot_to_stock_receipts.sql',
  '20260915140000_manufacturing_material_lot_issues.sql',
  '20260915143000_manufacturing_quality_rework.sql',
  '20260915150000_manufacturing_sales_lot_allocation.sql',
  '20260915153000_use_work_order_bom_snapshot_for_consumption.sql',
  '20260915160000_manufacturing_shop_floor_controls.sql'
)
$releaseStage = Join-Path ([System.IO.Path]::GetTempPath()) ('boat-manufacturing-phase2-' + [guid]::NewGuid().ToString('N'))
$releaseMigrations = Join-Path $releaseStage 'supabase\migrations'
$releaseLink = Join-Path $releaseStage 'supabase\.temp'
New-Item -ItemType Directory -Path $releaseMigrations -Force | Out-Null
New-Item -ItemType Directory -Path $releaseLink -Force | Out-Null
foreach ($releaseFile in Get-ChildItem -LiteralPath (Join-Path $releaseSource 'migrations') -Filter '*.sql') {
  # Keep the history already applied at the reviewed release baseline and the
  # explicit manufacturing set. A newer remote history will fail closed.
  if ($releaseFile.Name.Substring(0, 14) -lt '20260912000000' -or $releaseNames -contains $releaseFile.Name) {
    Copy-Item -LiteralPath $releaseFile.FullName -Destination $releaseMigrations
  }
}
foreach ($releaseName in $releaseNames) {
  if (-not (Test-Path -LiteralPath (Join-Path $releaseMigrations $releaseName))) { throw "Missing release migration: $releaseName" }
}
foreach ($releaseMetadata in @('project-ref', 'pooler-url')) {
  Copy-Item -LiteralPath (Join-Path $releaseSource ('.temp\' + $releaseMetadata)) -Destination $releaseLink
}
Write-Host "Prepared manufacturing-only release: $releaseStage"
if ($PrepareOnly) { return }
$releaseArguments = @('supabase@latest', '--workdir', $releaseStage, 'db', 'push', '--linked')
if ($Apply) { $releaseArguments += '--yes' } else { $releaseArguments += '--dry-run' }
& npx.cmd @releaseArguments
if ($LASTEXITCODE -ne 0) { throw "Manufacturing release command failed (exit $LASTEXITCODE)." }
