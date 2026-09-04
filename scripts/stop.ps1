param(
  [switch]$DryRun,
  [int]$Port = 0,
  [string]$OperationToken = ''
)

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$legacyMarkerPath = Join-Path $env:TEMP 'sanmao-ai-studio-instance.lock'
. (Join-Path $PSScriptRoot 'free-relay-common.ps1')

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

$operationLockPath = Join-Path $root '.data\update-staging\update.lock'
if (Test-Path -LiteralPath $operationLockPath) {
  $allow = $false
  try {
    $lock = Get-Content -LiteralPath $operationLockPath -Raw -ErrorAction Stop | ConvertFrom-Json
    $allow = $OperationToken -and [string]$lock.token -eq $OperationToken
    if (-not $allow) {
      $ownerPid = [int]$lock.pid
      $ownerAlive = $ownerPid -gt 0 -and (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue)
      $ageMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - ([DateTimeOffset]$lock.startedAt).ToUnixTimeMilliseconds()
      if (-not $ownerAlive -and $ageMs -gt 10 * 60 * 1000) {
        Remove-Item -LiteralPath $operationLockPath -Force -ErrorAction SilentlyContinue
        $allow = $true
      }
    }
  } catch {
    if (Test-SanmaoOperationLockStale -Path $operationLockPath) {
      Remove-Item -LiteralPath $operationLockPath -Force -ErrorAction SilentlyContinue
      $allow = $true
    }
  }
  if (-not $allow -and (Test-SanmaoOperationLockStale -Path $operationLockPath)) {
    Remove-Item -LiteralPath $operationLockPath -Force -ErrorAction SilentlyContinue
    $allow = $true
  }
  if (-not $allow) {
    Write-SanmaoLauncherLog '已有更新或重启任务，拒绝并发停止服务。' 'WARN'
    Write-Host '已有更新或重启任务正在进行，请稍候再试。' -ForegroundColor Yellow
    exit 1
  }
}

if (-not $DryRun) { Stop-SanmaoFreeRelayWatch -Root $root | Out-Null }
if (-not $DryRun) { Stop-SanmaoFreeRelayTunnel -Root $root }
if (-not $DryRun) {
  # 清理旧的免费中继看门狗日志文件。
  Get-ChildItem -LiteralPath (Join-Path $root '.data\logs') -Filter 'free-relay-watch-*.log' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
}

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

$released = $true
if ($portsToVerify.Count -gt 0) { $released = Wait-SanmaoPortsReleased -Ports $portsToVerify -TimeoutMs 8000 }
if (-not $released) {
  # 旧服务进程没有在期限内释放端口。再次停止看门狗，并强制回收仍占用目标端口的进程。
  Write-SanmaoLauncherLog '端口未及时释放，强制回收占用端口 3210 的进程。' 'WARN'
  Stop-SanmaoFreeRelayWatch -Root $root | Out-Null
  Stop-SanmaoPortOwners -Ports $portsToVerify | Out-Null
  $released = Wait-SanmaoPortsReleased -Ports $portsToVerify -TimeoutMs 8000
}
if (-not $released) {
  Remove-Item -LiteralPath $legacyMarkerPath -Force -ErrorAction SilentlyContinue
  $remaining = @($portsToVerify | Where-Object { @(Get-SanmaoOwningPidsByPort -Port $_).Count -gt 0 })
  Write-SanmaoLauncherLog ("停止失败，端口仍被占用：" + ($remaining -join ', ')) 'ERROR'
  Write-Host ("停止失败：端口仍被占用：" + ($remaining -join ', ')) -ForegroundColor Red
  exit 1
}

Remove-Item -LiteralPath $legacyMarkerPath -Force -ErrorAction SilentlyContinue
Write-Host ("SANMAO.AI local service stopped. PID(s): " + (($targets | Select-Object -ExpandProperty ProcessId) -join ', ')) -ForegroundColor Green
Write-SanmaoLauncherLog ("已停止 SANMAO.AI 本地服务 PID(s): " + (($targets | Select-Object -ExpandProperty ProcessId) -join ', ')) 'INFO'
