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
$stagingPath = Split-Path -Parent $ArchivePath
$extractPath = Join-Path $stagingPath ("extract-" + [guid]::NewGuid().ToString('N'))
$lockPath = Join-Path $stagingPath 'update.lock'
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
  Get-ChildItem -LiteralPath $TargetPath -Force |
    # Keep the staged updater executable until it has finished. It is an old
    # trusted script that is already running outside the signed archive; every
    # other program file is replaced from the verified archive below.
    Where-Object { $_.Name -ne '.data' -and $_.Name -ne 'node_modules' -and $_.Name -ne '.git' -and $_.Name -notlike '.env*' -and $_.FullName -ne $PSCommandPath } |
    Remove-Item -Recurse -Force

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
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue

  # Use the newly installed launcher helpers for the readiness probe.
  . (Join-Path $TargetPath 'scripts\launcher-common.ps1')
  Initialize-SanmaoLauncher -Root $TargetPath -PortStart 3210 -PortEnd 3220 -LegacyPortStart 3000 -LegacyPortEnd 3010 -LogPath (Join-Path $TargetPath '.data\logs\launcher.log')

  $launcher = Join-Path $TargetPath 'scripts\start.ps1'
  if (-not (Test-Path -LiteralPath $launcher)) { throw '更新后找不到 Windows 启动器' }
  $launcherArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $launcher, '-NonInteractive')
  if ($Port -ge 1024 -and $Port -le 65525) {
    # Keep this compatible with older releases whose start.ps1 did not yet
    # declare a -Port parameter; all supported launchers already honor the
    # SANMAO_PORT environment variable.
    $launcherCommand = "`$env:SANMAO_PORT=$(PowerShellLiteral ([string]$Port)); & $(PowerShellLiteral $launcher) -NonInteractive"
    $launcherArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $launcherCommand)
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
  Write-UpdateProgress 'completed' '更新完成，服务已恢复。' 100
} catch {
  Write-UpdateLog "更新失败：$($_.Exception.Message)"
  Write-UpdateProgress 'failed' '更新失败，请检查更新日志后重试' 0
  Remove-Item -LiteralPath $extractPath -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
  throw
}
