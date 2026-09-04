param(
  [int]$Port = 0,
  [Parameter(Mandatory = $true)][string]$OperationId,
  [Parameter(Mandatory = $true)][string]$OperationToken
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$lockPath = Join-Path $root '.data\update-staging\update.lock'
$statusPath = Join-Path $root '.data\runtime-restart\status.json'
$drainPath = Join-Path $root '.data\runtime-draining.json'
$backupDir = Join-Path $root ('.data\runtime-restart\previous-' + ($OperationId -replace '[^0-9A-Za-z_-]', '_'))
$script:claimed = $false

function Write-RestartStatus([string]$State, [string]$Error = '', [bool]$RolledBack = $false) {
  try {
    $parent = Split-Path -Parent $statusPath
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $payload = [ordered]@{
      operationId = $OperationId
      state = $State
      updatedAt = (Get-Date).ToUniversalTime().ToString('o')
      rolledBack = $RolledBack
    }
    if ($Error) { $payload.error = $Error }
    $temporary = "$statusPath.$OperationId.tmp"
    $payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $statusPath -Force
  } catch {}
}

function Assert-RestartLock {
  if (-not (Test-Path -LiteralPath $lockPath)) { throw '重启任务锁不存在，操作已取消' }
  $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
  if ([string]$lock.token -ne $OperationToken -or [string]$lock.operationId -ne $OperationId) { throw '重启任务锁校验失败，操作已取消' }
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
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Script @Arguments
  return [int]$LASTEXITCODE
}

try {
  Claim-RestartLock
  Write-RestartStatus 'stopping'
  $stopScript = Join-Path $PSScriptRoot 'stop.ps1'
  $stopArguments = @('-Port', [string]$Port, '-OperationToken', $OperationToken)
  if ((Invoke-SanmaoScript $stopScript $stopArguments) -ne 0) { throw '旧服务未能安全停止' }

  if (Test-Path -LiteralPath $backupDir) { Remove-Item -LiteralPath $backupDir -Recurse -Force }
  $buildDir = Join-Path $root '.next'
  if (Test-Path -LiteralPath $buildDir) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backupDir) | Out-Null
    Move-Item -LiteralPath $buildDir -Destination $backupDir
  }

  Write-RestartStatus 'building'
  $startScript = Join-Path $PSScriptRoot 'start.ps1'
  $startArguments = @('-Port', [string]$Port, '-NonInteractive', '-FreeRelay', '-ForceBuild', '-OperationToken', $OperationToken)
  if ((Invoke-SanmaoScript $startScript $startArguments) -ne 0) { throw '新版本构建或启动失败' }

  if (Test-Path -LiteralPath $backupDir) { Remove-Item -LiteralPath $backupDir -Recurse -Force }
  Remove-Item -LiteralPath $drainPath -Force -ErrorAction SilentlyContinue
  Write-RestartStatus 'completed'
  exit 0
} catch {
  $message = $_.Exception.Message
  Write-RestartStatus 'failed' $message
  $buildDir = Join-Path $root '.next'
  $rollbackSucceeded = $false
  if (Test-Path -LiteralPath $backupDir) {
    try {
      if (Test-Path -LiteralPath $buildDir) { Remove-Item -LiteralPath $buildDir -Recurse -Force }
      Move-Item -LiteralPath $backupDir -Destination $buildDir
      Write-RestartStatus 'rolling-back' $message $true
      $startScript = Join-Path $PSScriptRoot 'start.ps1'
      $rollbackArguments = @('-Port', [string]$Port, '-NonInteractive', '-FreeRelay', '-SkipBuild', '-OperationToken', $OperationToken)
      $rollbackSucceeded = (Invoke-SanmaoScript $startScript $rollbackArguments) -eq 0
    } catch {}
  }
  if ($rollbackSucceeded) { Write-RestartStatus 'failed-rolled-back' $message $true }
  else { Write-RestartStatus 'failed' $message $false }
  exit 1
} finally {
  if ($script:claimed) { Remove-OwnedMarkers }
}
