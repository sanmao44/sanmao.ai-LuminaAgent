param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$TargetPath,
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $false)][string]$LogPath
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
    Where-Object { $_.Name -ne '.data' -and $_.Name -ne 'node_modules' -and $_.Name -notlike '.env*' } |
    Remove-Item -Recurse -Force

  Get-ChildItem -LiteralPath $packageRoot -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $TargetPath $_.Name) -Recurse -Force
  }
  # Keep the updater fixes in the installed app even when an older release
  # archive contains an outdated copy of this script.
  $installedUpdater = Join-Path $TargetPath 'scripts\apply-update.ps1'
  if (Test-Path -LiteralPath $installedUpdater) {
    Copy-Item -LiteralPath $PSCommandPath -Destination $installedUpdater -Force
  }
  $runtimePatchPath = Join-Path $stagingPath 'local-update-runtime.ts'
  $runtimeTargetPath = Join-Path $TargetPath 'lib\local-update.ts'
  if (Test-Path -LiteralPath $runtimePatchPath) {
    if (-not (Test-Path -LiteralPath (Split-Path -Parent $runtimeTargetPath))) {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $runtimeTargetPath) | Out-Null
    }
    Copy-Item -LiteralPath $runtimePatchPath -Destination $runtimeTargetPath -Force
    Write-UpdateLog '已保留本地更新运行时修复'
  }
  Write-UpdateLog '程序文件替换完成'

  # 让启动器重新构建生产产物，并根据 package-lock.json 检查依赖。
  Remove-Item -LiteralPath (Join-Path $TargetPath '.next') -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $ArchivePath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $runtimePatchPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $extractPath -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue

  $launcher = Join-Path $TargetPath 'scripts\start.ps1'
  if (-not (Test-Path -LiteralPath $launcher)) { throw '更新后找不到 Windows 启动器' }
  $launcherProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $launcher) -WorkingDirectory $TargetPath -WindowStyle Hidden -PassThru
  Write-UpdateLog "已启动更新后启动器 PID $($launcherProcess.Id)"
  Start-Sleep -Milliseconds 1200
  if ($launcherProcess.HasExited -and $launcherProcess.ExitCode -ne 0) {
    throw "更新后启动器异常退出（退出码 $($launcherProcess.ExitCode)）"
  }
  Write-UpdateLog '更新流程完成，等待新服务就绪'
} catch {
  Write-UpdateLog "更新失败：$($_.Exception.Message)"
  Remove-Item -LiteralPath (Join-Path $stagingPath 'local-update-runtime.ts') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $extractPath -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
  throw
}
