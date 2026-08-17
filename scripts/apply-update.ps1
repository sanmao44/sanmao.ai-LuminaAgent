param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$TargetPath,
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = 'Stop'
$stagingPath = Split-Path -Parent $ArchivePath
$extractPath = Join-Path $stagingPath ("extract-" + [guid]::NewGuid().ToString('N'))
$lockPath = Join-Path $stagingPath 'update.lock'

function Stop-CurrentServer {
  Start-Sleep -Milliseconds 900
  try { Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  for ($i = 0; $i -lt 60; $i++) {
    try {
      Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
      Start-Sleep -Milliseconds 250
    } catch { return }
  }
}

try {
  New-Item -ItemType Directory -Force -Path $extractPath | Out-Null
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $extractPath -Force

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

  Stop-CurrentServer

  # 只替换程序文件；用户数据、环境变量和已安装依赖保留不动。
  Get-ChildItem -LiteralPath $TargetPath -Force |
    Where-Object { $_.Name -ne '.data' -and $_.Name -ne 'node_modules' -and $_.Name -notlike '.env*' } |
    Remove-Item -Recurse -Force

  Get-ChildItem -LiteralPath $packageRoot -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $TargetPath $_.Name) -Recurse -Force
  }

  # 让启动器重新构建生产产物，并根据 package-lock.json 检查依赖。
  Remove-Item -LiteralPath (Join-Path $TargetPath '.next') -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $ArchivePath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $extractPath -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue

  $launcher = Join-Path $TargetPath 'scripts\start.ps1'
  if (-not (Test-Path -LiteralPath $launcher)) { throw '更新后找不到 Windows 启动器' }
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $launcher) -WorkingDirectory $TargetPath -WindowStyle Hidden
} catch {
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
  throw
}
