param(
  [switch]$DryRun,
  [int]$Port = 0
)

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$legacyMarkerPath = Join-Path $env:TEMP 'sanmao-ai-studio-instance.lock'
. (Join-Path $PSScriptRoot 'free-relay-common.ps1')
if (-not $DryRun) { Stop-SanmaoFreeRelayTunnel -Root $root }

$requestedPort = 0
if ($Port -ge 1024 -and $Port -le 65525) {
  $requestedPort = $Port
} elseif ($env:SANMAO_PORT -match '^\d+$') {
  $requestedPort = [int]$env:SANMAO_PORT
}
$portStart = if ($requestedPort -ge 1024 -and $requestedPort -le 65525) { $requestedPort } else { 3210 }
$portEnd = $portStart + 10
$portRange = $portStart..$portEnd
$legacyPortRange = 3000..3010

. (Join-Path $PSScriptRoot 'launcher-common.ps1')
Initialize-SanmaoLauncher -Root $root -PortStart $portStart -PortEnd $portEnd -LegacyPortStart 3000 -LegacyPortEnd 3010 -LogPath (Join-Path $root '.data\logs\launcher.log')
Write-SanmaoLauncherLog "停止器开始运行，端口范围：$portStart..$portEnd" 'INFO'

function Stop-SanmaoLanLauncherProcesses {
  $rootPattern = [regex]::Escape($root)
  $launchers = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -and
      $_.CommandLine -match '(?i)lan-launcher\.ps1' -and
      $_.CommandLine -match $rootPattern
    })
  foreach ($launcher in $launchers) {
    Write-SanmaoLauncherLog "停止局域网图形启动器 PID $($launcher.ProcessId)。" 'INFO'
    try { & taskkill.exe /PID ([int]$launcher.ProcessId) /T /F 2>$null | Out-Null } catch {}
  }
  return $launchers.Count
}

$targets = @(Get-SanmaoOwnedServerProcesses -Ports @($legacyPortRange + $portRange))

if (-not $targets) {
  if (-not $DryRun) { Stop-SanmaoLanLauncherProcesses | Out-Null }
  Remove-Item -LiteralPath $legacyMarkerPath -Force -ErrorAction SilentlyContinue
  Write-Host 'SANMAO.AI local service is not running.' -ForegroundColor Yellow
  Write-SanmaoLauncherLog '没有发现正在运行的 SANMAO.AI 本地服务。' 'INFO'
  exit 0
}

$targets = @($targets | Sort-Object ProcessId -Unique)
foreach ($target in $targets) {
  if ($DryRun) {
    Write-Host "Would stop PID $($target.ProcessId) on port $($target.Port): $($target.CommandLine)"
    continue
  }

  Write-SanmaoLauncherLog "停止 PID $($target.ProcessId) 端口 $($target.Port) 命令 $($target.CommandLine)" 'INFO'
  Stop-SanmaoOwnedProcess -Process $target | Out-Null
}

if (-not $DryRun) { Stop-SanmaoLanLauncherProcesses | Out-Null }

$portsToVerify = @($targets | Select-Object -ExpandProperty Port -Unique)
if ($DryRun) {
  Write-Host 'Dry run complete; no process was stopped.' -ForegroundColor Yellow
  exit 0
}

if ($portsToVerify.Count -gt 0 -and -not (Wait-SanmaoPortsReleased -Ports $portsToVerify -TimeoutMs 10000)) {
  Remove-Item -LiteralPath $legacyMarkerPath -Force -ErrorAction SilentlyContinue
  $remaining = @($portsToVerify | Where-Object { @(Get-SanmaoOwningPidsByPort -Port $_).Count -gt 0 })
  Write-SanmaoLauncherLog ("停止失败，端口仍被占用：" + ($remaining -join ', ')) 'ERROR'
  Write-Host ("停止失败：端口仍被占用：" + ($remaining -join ', ')) -ForegroundColor Red
  exit 1
}

Remove-Item -LiteralPath $legacyMarkerPath -Force -ErrorAction SilentlyContinue
Write-Host ("SANMAO.AI local service stopped. PID(s): " + (($targets | Select-Object -ExpandProperty ProcessId) -join ', ')) -ForegroundColor Green
Write-SanmaoLauncherLog ("已停止 SANMAO.AI 本地服务 PID(s): " + (($targets | Select-Object -ExpandProperty ProcessId) -join ', ')) 'INFO'
