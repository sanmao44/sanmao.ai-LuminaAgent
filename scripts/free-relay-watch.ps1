param(
  [Parameter(Mandatory = $true)][string]$Root,
  [Parameter(Mandatory = $true)][int]$TargetProcessId,
  [Parameter(Mandatory = $true)][int]$OriginPort
)

$ErrorActionPreference = 'SilentlyContinue'
. (Join-Path (Split-Path -Parent $PSCommandPath) 'free-relay-common.ps1')

function Write-SanmaoFreeRelayWatchLog([string]$Message, [string]$Level = 'INFO') {
  try {
    $logPath = Join-Path $Root '.data\logs\launcher.log'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null
    Add-Content -LiteralPath $logPath -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff')] [$Level] $Message" -Encoding UTF8
  } catch {}
}

$unhealthyChecks = 0
$startupDeadline = (Get-Date).AddSeconds(45)
while ($true) {
  $target = Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue
  if (-not $target) {
    Stop-SanmaoFreeRelayTunnel -Root $Root
    break
  }

  $relayRunning = Test-SanmaoFreeRelayTunnel -Root $Root
  if (-not $relayRunning) {
    Write-SanmaoFreeRelayWatchLog 'Media relay process exited; rebuilding the tunnel.' 'WARN'
    $newRelay = Start-SanmaoFreeRelayTunnel -Root $Root -OriginPort $OriginPort
    if ($newRelay) {
      $unhealthyChecks = 0
      Write-SanmaoFreeRelayWatchLog "Media relay recovered: $($newRelay.PublicUrl)" 'INFO'
    } else {
      $unhealthyChecks = 0
      Write-SanmaoFreeRelayWatchLog 'Media relay recovery failed; retrying.' 'WARN'
    }
  } elseif ((Get-Date) -ge $startupDeadline -and -not (Test-SanmaoFreeRelayReachable -Root $Root)) {
    $unhealthyChecks += 1
    if ($unhealthyChecks -ge 3) {
      Write-SanmaoFreeRelayWatchLog 'Media relay public URL is unreachable; replacing the tunnel.' 'WARN'
      $newRelay = Start-SanmaoFreeRelayTunnel -Root $Root -OriginPort $OriginPort
      if ($newRelay) {
        $unhealthyChecks = 0
        Write-SanmaoFreeRelayWatchLog "Media relay recovered: $($newRelay.PublicUrl)" 'INFO'
      } else {
        $unhealthyChecks = 0
        Write-SanmaoFreeRelayWatchLog 'Media relay recovery failed; retrying.' 'WARN'
      }
    }
  } else {
    $unhealthyChecks = 0
  }

  Start-Sleep -Seconds 10
}
