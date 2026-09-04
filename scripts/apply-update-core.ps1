param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$TargetPath,
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $false)][string]$LogPath,
  [Parameter(Mandatory = $false)][int]$Port = 0,
  [Parameter(Mandatory = $false)][string]$ProgressPath,
  [Parameter(Mandatory = $false)][string]$OperationToken = ''
)

$ErrorActionPreference = 'Stop'
$stagingPath = Split-Path -Parent $ArchivePath
$extractPath = Join-Path $stagingPath ("extract-" + [guid]::NewGuid().ToString('N'))
$lockPath = Join-Path $stagingPath 'update.lock'
$drainPath = Join-Path $TargetPath '.data\runtime-draining.json'
$backupSuffix = if ($OperationToken) { $OperationToken } else { [string]$PID }
$backupPath = Join-Path $stagingPath ("previous-update-" + $backupSuffix)
$script:programBackedUp = $false
$script:programBackupComplete = $false
$script:launcherProcess = $null
if (-not $LogPath) { $LogPath = Join-Path $stagingPath 'update.log' }

function Write-UpdateLog([string]$Message) {
  try {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff')] $Message"
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
  } catch {}
}

function Write-UpdateProgress([string]$Stage, [string]$Message, [int]$Percent) {
  if (-not $ProgressPath) { return }
  try {
    $progress = if (Test-Path -LiteralPath $ProgressPath) {
      Get-Content -LiteralPath $ProgressPath -Raw | ConvertFrom-Json
    } else { [pscustomobject]@{} }
    $progress.stage = $Stage
    $progress.message = $Message
    $progress.percent = $Percent
    $progress.updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    $temporaryProgressPath = "$ProgressPath.$PID.tmp"
    $progress | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporaryProgressPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryProgressPath -Destination $ProgressPath -Force
  } catch {}
}

function PowerShellLiteral([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

function Claim-UpdateLock {
  if (-not $OperationToken) { return }
  if (-not (Test-Path -LiteralPath $lockPath)) { throw '更新任务锁不存在，操作已取消' }
  $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
  if ([string]$lock.token -ne $OperationToken) { throw '更新任务锁校验失败，操作已取消' }
  $lock.pid = $PID
  $temporaryLockPath = "$lockPath.$PID.tmp"
  $lock | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporaryLockPath -Encoding UTF8
  Move-Item -LiteralPath $temporaryLockPath -Destination $lockPath -Force
}

function Remove-OwnedUpdateLock {
  if (-not (Test-Path -LiteralPath $lockPath)) { return }
  if (-not $OperationToken) {
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    return
  }
  try {
    $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
    if ([string]$lock.token -eq $OperationToken) {
      Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}

function Backup-CurrentProgram {
  if (Test-Path -LiteralPath $backupPath) { Remove-Item -LiteralPath $backupPath -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $backupPath | Out-Null
  $script:programBackedUp = $true
  $script:programBackupComplete = $false
  try {
    Get-ChildItem -LiteralPath $TargetPath -Force |
      Where-Object { $_.Name -ne '.data' -and $_.Name -ne 'node_modules' -and $_.Name -ne '.git' -and $_.Name -notlike '.env*' } |
      ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination $backupPath -Force }
    $script:programBackupComplete = $true
  } catch {
    # Leave the still-unmoved old files in place. Restore-PreviousProgram has
    # a partial-backup path that puts only the moved entries back.
    throw
  }
}

function Restore-PreviousProgram {
  if (-not $script:programBackedUp -or -not (Test-Path -LiteralPath $backupPath)) { return $false }
  if ($script:programBackupComplete) {
    Get-ChildItem -LiteralPath $TargetPath -Force |
      Where-Object { $_.Name -ne '.data' -and $_.Name -ne 'node_modules' -and $_.Name -ne '.git' -and $_.Name -notlike '.env*' } |
      Remove-Item -Recurse -Force
  }
  Get-ChildItem -LiteralPath $backupPath -Force | ForEach-Object {
    Move-Item -LiteralPath $_.FullName -Destination $TargetPath -Force
  }
  return $true
}

function Stop-CurrentTargetService {
  $stopScript = Join-Path $TargetPath 'scripts\stop.ps1'
  if (-not (Test-Path -LiteralPath $stopScript)) { return }
  try {
    $stopArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $stopScript, '-Port', [string]$Port)
    if ($OperationToken) { $stopArguments += @('-OperationToken', $OperationToken) }
    & powershell.exe @stopArguments | Out-Null
  } catch {}
}

function Start-RolledBackService {
  $launcher = Join-Path $TargetPath 'scripts\start.ps1'
  if (-not (Test-Path -LiteralPath $launcher)) { return $false }
  $oldPort = $env:SANMAO_PORT
  $oldToken = $env:SANMAO_OPERATION_TOKEN
  try {
    if ($Port -ge 1024 -and $Port -le 65525) { $env:SANMAO_PORT = [string]$Port }
    if ($OperationToken) { $env:SANMAO_OPERATION_TOKEN = $OperationToken }
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $launcher, '-NonInteractive')
    if ($OperationToken -and ((Get-Content -LiteralPath $launcher -Raw -ErrorAction SilentlyContinue) -match '\$OperationToken')) {
      $arguments += @('-OperationToken', $OperationToken)
    }
    $script:launcherProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $TargetPath -WindowStyle Hidden -PassThru
    $ports = if ($Port -ge 1024 -and $Port -le 65525) { @($Port) } else { @(3210..3220) }
    $deadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $deadline) {
      foreach ($probePort in $ports) {
        if (Test-SanmaoHealthEndpoint -Port $probePort) { return $true }
      }
      if ($script:launcherProcess.HasExited -and $script:launcherProcess.ExitCode -ne 0) { return $false }
      Start-Sleep -Milliseconds 500
    }
    return $false
  } catch {
    return $false
  } finally {
    if ($null -eq $oldPort) { Remove-Item Env:SANMAO_PORT -ErrorAction SilentlyContinue } else { $env:SANMAO_PORT = $oldPort }
    if ($null -eq $oldToken) { Remove-Item Env:SANMAO_OPERATION_TOKEN -ErrorAction SilentlyContinue } else { $env:SANMAO_OPERATION_TOKEN = $oldToken }
  }
}

function Remove-UpdateDrainMarker {
  if (-not $OperationToken -or -not (Test-Path -LiteralPath $drainPath) -or -not (Test-Path -LiteralPath $lockPath)) { return }
  try {
    $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
    $drain = Get-Content -LiteralPath $drainPath -Raw | ConvertFrom-Json
    if ([string]$lock.token -eq $OperationToken -and [string]$drain.operationId -eq [string]$lock.jobId) {
      Remove-Item -LiteralPath $drainPath -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}

function Stop-CurrentServer {
  Write-UpdateLog "正在停止旧服务进程 PID $ProcessId"
  Start-Sleep -Milliseconds 900
  try { Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  for ($i = 0; $i -lt 60; $i++) {
    try {
      Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
      Start-Sleep -Milliseconds 250
    } catch { return }
  }
  throw "旧服务进程 PID $ProcessId 未能在 15 秒内退出"
}

try {
  Claim-UpdateLock
  Write-UpdateLog "开始应用 SANMAO.AI $Version，目标目录：$TargetPath"
  Write-UpdateProgress 'starting' '正在替换程序文件并准备重启…' 98
  New-Item -ItemType Directory -Force -Path $extractPath | Out-Null
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $extractPath -Force
  Write-UpdateLog '更新包已解压'

  $packageRoot = $extractPath
  if (-not (Test-Path -LiteralPath (Join-Path $packageRoot 'package.json'))) {
    $packageRoot = Get-ChildItem -LiteralPath $extractPath -Directory -Force |
      Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'package.json') } |
      Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $packageRoot -or -not (Test-Path -LiteralPath (Join-Path $packageRoot 'package.json'))) {
    throw '更新包中没有找到有效的 SANMAO.AI 项目文件'
  }

  $package = Get-Content -LiteralPath (Join-Path $packageRoot 'package.json') -Raw | ConvertFrom-Json
  if ([string]$package.version -ne $Version.TrimStart('v')) {
    throw "更新包版本不匹配：期望 $Version，实际 $($package.version)"
  }
  Write-UpdateLog "更新包版本校验通过：$($package.version)"

  Stop-CurrentServer

  # 只替换程序文件；用户数据、环境变量和已安装依赖保留不动。
  # Keep the old program outside the target so a failed build/start can restore
  # a runnable version before releasing the shared operation lock.
  Backup-CurrentProgram

  Get-ChildItem -LiteralPath $packageRoot -Force | ForEach-Object {
    $destination = Join-Path $TargetPath $_.Name
    # Copying a file onto the process' executing script aborts PowerShell.
    # The restarted launcher restores the tiny fixed bootstrap immediately.
    if ($destination -eq $PSCommandPath) { return }
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
  }
  # The verified archive is the only source of installed program files.
  # Do not copy the running updater or any old runtime back into this version.
  Write-UpdateLog '程序文件替换完成'
  Write-UpdateProgress 'starting' '程序文件已替换，正在重新构建并启动…' 99

    # 让启动器重新构建生产产物，并根据 package-lock.json 检查依赖。
  Remove-Item -LiteralPath (Join-Path $TargetPath '.next') -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $ArchivePath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $extractPath -Recurse -Force -ErrorAction SilentlyContinue
  # Use the newly installed launcher helpers for the readiness probe.
  . (Join-Path $TargetPath 'scripts\launcher-common.ps1')
  Initialize-SanmaoLauncher -Root $TargetPath -PortStart 3210 -PortEnd 3220 -LegacyPortStart 3000 -LegacyPortEnd 3010 -LogPath (Join-Path $TargetPath '.data\logs\launcher.log')

  $launcher = Join-Path $TargetPath 'scripts\start.ps1'
  if (-not (Test-Path -LiteralPath $launcher)) { throw '更新后找不到 Windows 启动器' }
  $launcherArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $launcher, '-NonInteractive')
  $lanArgument = if ($env:SANMAO_NETWORK_MODE -eq 'lan') { ' -Lan' } else { '' }
  $relayArgument = ' -FreeRelay'
  $operationTokenArgument = if ($OperationToken) { " -OperationToken $(PowerShellLiteral $OperationToken)" } else { '' }
  if ($Port -ge 1024 -and $Port -le 65525) {
    # Keep this compatible with older releases whose start.ps1 did not yet
    # declare a -Port parameter; all supported launchers already honor the
    # SANMAO_PORT environment variable.
    $launcherCommand = "`$env:SANMAO_PORT=$(PowerShellLiteral ([string]$Port)); `$env:SANMAO_OPERATION_TOKEN=$(PowerShellLiteral $OperationToken); & $(PowerShellLiteral $launcher) -NonInteractive$lanArgument$relayArgument$operationTokenArgument"
    $launcherArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $launcherCommand)
  } elseif ($lanArgument) {
    $launcherArguments += @('-Lan', '-FreeRelay')
    if ($OperationToken) { $launcherArguments += @('-OperationToken', $OperationToken) }
  } else {
    $launcherArguments += '-FreeRelay'
    if ($OperationToken) { $launcherArguments += @('-OperationToken', $OperationToken) }
  }
  $launcherProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $launcherArguments -WorkingDirectory $TargetPath -WindowStyle Hidden -PassThru
  Write-UpdateLog "已启动更新后启动器 PID $($launcherProcess.Id)"

  $restartPorts = @()
  if ($Port -ge 1024 -and $Port -le 65525) {
    $restartPorts = @($Port)
  } else {
    $restartPorts = 3210..3220
  }
  $deadline = (Get-Date).AddSeconds(180)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    foreach ($probePort in $restartPorts) {
      if (Test-SanmaoHealthEndpoint -Port $probePort) { $ready = $true; break }
    }
    if ($ready) { break }
    if ($launcherProcess.HasExited -and $launcherProcess.ExitCode -ne 0) {
      throw "更新后启动器异常退出（退出码 $($launcherProcess.ExitCode)）"
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    throw '更新后服务未在 180 秒内就绪，请查看 .data/logs/launcher.log 与更新日志后重试。'
  }
  Write-UpdateLog '更新流程完成，新服务已就绪'
  if (Test-Path -LiteralPath $backupPath) { Remove-Item -LiteralPath $backupPath -Recurse -Force -ErrorAction SilentlyContinue }
  Remove-UpdateDrainMarker
  Remove-OwnedUpdateLock
  Write-UpdateProgress 'completed' '更新完成，服务已恢复。' 100
} catch {
  Write-UpdateLog "更新失败：$($_.Exception.Message)"
  $rollbackSucceeded = $false
  if ($script:programBackedUp) {
    try {
      Stop-CurrentTargetService
      if (Restore-PreviousProgram) {
        Write-UpdateLog '新版本未能启动，正在恢复上一份程序文件'
        $rollbackSucceeded = Start-RolledBackService
      }
    } catch {}
  }
  if ($rollbackSucceeded) {
    Write-UpdateLog '旧版本服务已恢复'
    Write-UpdateProgress 'failed' '更新失败，已自动恢复旧服务。' 0
  } else {
    Write-UpdateProgress 'failed' '更新失败，请检查更新日志后重试' 0
  }
  Remove-UpdateDrainMarker
  Remove-Item -LiteralPath $extractPath -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $backupPath) { Remove-Item -LiteralPath $backupPath -Recurse -Force -ErrorAction SilentlyContinue }
  Remove-OwnedUpdateLock
  throw
}
