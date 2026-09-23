param(
  [int]$Port = 0,
  [Parameter(Mandatory = $true)][string]$OperationId,
  [Parameter(Mandatory = $true)][string]$OperationToken
)

# 把局域网共享切回本地模式：网络模式由启动参数决定，所以必须让启动器以不带 -Lan 的
# 方式重新拉起服务。start.ps1 会先停掉当前局域网服务，再以 127.0.0.1 启动。
# 与 restart.ps1 的区别是不搬移 .next、不强制重新构建，切模式通常几秒到一分钟即可。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'launcher-common.ps1')
$dataDir = Resolve-SanmaoDataDir -Root $root
$lockPath = Join-Path $dataDir 'update-staging\update.lock'
$statusPath = Join-Path $dataDir 'runtime-restart\status.json'
$drainPath = Join-Path $dataDir 'runtime-draining.json'
$script:claimed = $false

function Write-RestartStatus([string]$State, [string]$Error = '') {
  try {
    $parent = Split-Path -Parent $statusPath
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $payload = [ordered]@{
      operationId = $OperationId
      state = $State
      updatedAt = (Get-Date).ToUniversalTime().ToString('o')
      targetMode = 'local'
    }
    if ($Error) { $payload.error = $Error }
    $temporary = "$statusPath.$OperationId.tmp"
    # Windows PowerShell 的 UTF8 编码写入会带 BOM，Node 的 JSON.parse 不接受，因此写无 BOM。
    $json = $payload | ConvertTo-Json -Depth 5
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($temporary, $json, $utf8NoBom)
    Move-Item -LiteralPath $temporary -Destination $statusPath -Force
  } catch {}
}

function Assert-RestartLock {
  if (-not (Test-Path -LiteralPath $lockPath)) { throw '切换任务锁不存在，操作已取消' }
  $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
  if ([string]$lock.token -ne $OperationToken -or [string]$lock.operationId -ne $OperationId) { throw '切换任务锁校验失败，操作已取消' }
}

function Claim-RestartLock {
  Assert-RestartLock
  $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
  $lock.pid = $PID
  $temporary = "$lockPath.$PID.tmp"
  $lock | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporary -Encoding UTF8
  Move-Item -LiteralPath $temporary -Destination $lockPath -Force
  $script:claimed = $true
}

function Remove-OwnedMarkers {
  try {
    if (Test-Path -LiteralPath $lockPath) {
      $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
      if ([string]$lock.token -eq $OperationToken -and [string]$lock.operationId -eq $OperationId) {
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {}
  try {
    if (Test-Path -LiteralPath $drainPath) {
      $drain = Get-Content -LiteralPath $drainPath -Raw | ConvertFrom-Json
      if ([string]$drain.operationId -eq $OperationId) {
        Remove-Item -LiteralPath $drainPath -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {}
}

function Invoke-SanmaoScript([string]$Script, [string[]]$Arguments) {
  # 与 restart.ps1 一致：用独立句柄启动，避免常驻看门狗继承重定向句柄导致等待卡死。
  $argumentList = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$Script) + $Arguments
  $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentList -WorkingDirectory $root -WindowStyle Hidden -PassThru
  $proc.WaitForExit()
  return [int]$proc.ExitCode
}

try {
  Claim-RestartLock
  Write-RestartStatus 'stopping'
  $startScript = Join-Path $PSScriptRoot 'start.ps1'
  $portArguments = @()
  if ($Port -gt 0) { $portArguments = @('-Port', [string]$Port) }
  # -OperationToken 让 start.ps1 认领本次切换拿到的锁，否则它会以为已有重启任务在进行。
  $startArguments = $portArguments + @('-NonInteractive', '-FreeRelay', '-OperationToken', $OperationToken)
  if ((Invoke-SanmaoScript $startScript $startArguments) -ne 0) { throw '本地模式服务启动失败，请使用桌面启动器重试' }
  Remove-Item -LiteralPath $drainPath -Force -ErrorAction SilentlyContinue
  Write-RestartStatus 'completed'
  exit 0
} catch {
  Write-RestartStatus 'failed' $_.Exception.Message
  exit 1
} finally {
  if ($script:claimed) { Remove-OwnedMarkers }
}
