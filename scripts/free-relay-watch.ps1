param(
  [Parameter(Mandatory = $true)][string]$Root,
  [Parameter(Mandatory = $true)][int]$TargetProcessId
)

$ErrorActionPreference = 'SilentlyContinue'
. (Join-Path (Split-Path -Parent $PSCommandPath) 'free-relay-common.ps1')

try {
  while ($true) {
    $target = Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue
    if (-not $target) { break }
    Start-Sleep -Seconds 2
  }
} finally {
  Stop-SanmaoFreeRelayTunnel -Root $Root
}
