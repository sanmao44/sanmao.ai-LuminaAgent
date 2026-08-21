param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$TargetPath,
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $false)][string]$LogPath,
  [Parameter(Mandatory = $false)][int]$Port = 0,
  [Parameter(Mandatory = $false)][string]$ProgressPath
)

$ErrorActionPreference = 'Stop'
$corePath = Join-Path $TargetPath 'scripts\apply-update-core.ps1'
if (-not (Test-Path -LiteralPath $corePath)) {
  throw 'Updater core file is missing. Please download the complete package and try again.'
}

# This stable entry point is restored by start.ps1 after migrations from old
# releases, whose updater used to overwrite scripts/apply-update.ps1.
& $corePath @PSBoundParameters
