[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Keep this project launcher aligned with the public installer documented for
# the canvas CLI. The upstream script owns binary, Skill and PATH installation.
$InstallerUrl = 'https://jimeng.jianying.com/canvas-cli/install.ps1'
$TempDir = Join-Path ([IO.Path]::GetTempPath()) "sanmao-jimeng-canvas-$([Guid]::NewGuid().ToString('N'))"
$InstallerPath = Join-Path $TempDir 'install.ps1'

try {
  if (-not $env:USERPROFILE) { throw '无法确定当前 Windows 用户目录。' }
  if (-not [Environment]::Is64BitOperatingSystem) { throw '即梦画布 CLI 当前仅支持 Windows 64 位系统。' }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

  Write-Host '[即梦画布 CLI] 正在读取官方安装器…' -ForegroundColor Cyan
  Invoke-WebRequest -UseBasicParsing -Uri $InstallerUrl -OutFile $InstallerPath -TimeoutSec 60
  if (-not (Test-Path -LiteralPath $InstallerPath) -or (Get-Item -LiteralPath $InstallerPath).Length -lt 1KB) {
    throw '官方安装器下载内容异常，请检查网络后重试。'
  }

  Write-Host '[即梦画布 CLI] 正在运行官方安装器…' -ForegroundColor Cyan
  & $InstallerPath
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "官方安装器退出码：$LASTEXITCODE" }

  $command = Get-Command dreamina-canvas.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $command) {
    $candidate = Join-Path $env:USERPROFILE 'bin\dreamina-canvas.exe'
    if (Test-Path -LiteralPath $candidate) { $command = [pscustomobject]@{ Source = $candidate } }
  }
  if (-not $command) { throw '安装完成后没有找到 dreamina-canvas.exe，请重新打开终端后重试。' }
  $version = (& $command.Source --format json version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $version) { throw '程序已安装，但版本验证失败。' }

  Write-Host ''
  Write-Host "安装完成：$($command.Source)" -ForegroundColor Green
  Write-Host "版本：$($version.Split([Environment]::NewLine)[0])" -ForegroundColor Green
  Write-Host '请回到 SANMAO.AI 设置页点击“重新检测”，然后连接即梦画布。' -ForegroundColor Green
  Write-Host '新打开的终端中可以运行：dreamina-canvas --format json version' -ForegroundColor DarkGray
} catch {
  Write-Host ''
  Write-Host "安装失败：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host '请打开官方安装说明，或稍后重新运行此安装器。' -ForegroundColor Yellow
  exit 1
} finally {
  if (Test-Path -LiteralPath $TempDir) { Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue }
}

exit 0
