[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$InstallerUrl = 'https://jimeng.jianying.com/cli'
$ProgramName = 'dreamina'
$InstallDir = Join-Path $env:USERPROFILE 'bin'
$TargetPath = Join-Path $InstallDir "$ProgramName.exe"
$TempDir = Join-Path ([IO.Path]::GetTempPath()) "sanmao-jimeng-$([Guid]::NewGuid().ToString('N'))"
$exitCode = 0

function Write-Info([string]$Message) {
  Write-Host "[即梦 CLI] $Message" -ForegroundColor Cyan
}

function Write-WarningMessage([string]$Message) {
  Write-Host "[即梦 CLI] $Message" -ForegroundColor Yellow
}

try {
  if (-not $env:USERPROFILE) { throw '无法确定当前 Windows 用户目录。' }
  if (-not [Environment]::Is64BitOperatingSystem) {
    throw '当前即梦 CLI 安装器仅支持 Windows 64 位系统。'
  }

  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

  Write-Info '正在读取官方安装信息…'
  $officialScript = (Invoke-WebRequest -UseBasicParsing -Uri $InstallerUrl -TimeoutSec 30).Content
  $readValue = {
    param([string]$Name)
    $pattern = '(?m)^' + [regex]::Escape($Name) + '="([^"]+)"'
    $match = [regex]::Match($officialScript, $pattern)
    if (-not $match.Success) { throw "官方安装信息中缺少 $Name。请稍后重试或使用官方安装说明。" }
    return $match.Groups[1].Value
  }
  $downloadBase = & $readValue 'DOWNLOAD_BASE'
  $skillUrl = & $readValue 'SKILL_URL'
  $versionUrl = & $readValue 'VERSION_URL'
  $skillMd5Match = [regex]::Match($officialScript, '(?m)^SKILL_MD5="([0-9a-fA-F]+)"')

  $binaryUrl = "$downloadBase/dreamina_cli_windows_amd64.exe"
  $binaryTemp = Join-Path $TempDir "$ProgramName.exe"
  $skillTemp = Join-Path $TempDir 'SKILL.md'
  $versionTemp = Join-Path $TempDir 'version.json'

  Write-Info '正在下载 Windows 64 位程序…'
  Invoke-WebRequest -UseBasicParsing -Uri $binaryUrl -OutFile $binaryTemp -TimeoutSec 120
  if (-not (Test-Path -LiteralPath $binaryTemp) -or (Get-Item -LiteralPath $binaryTemp).Length -lt 100KB) {
    throw '官方程序下载内容异常，请检查网络后重试。'
  }

  Write-Info '正在下载即梦 CLI 配套文件…'
  Invoke-WebRequest -UseBasicParsing -Uri $skillUrl -OutFile $skillTemp -TimeoutSec 30
  Invoke-WebRequest -UseBasicParsing -Uri $versionUrl -OutFile $versionTemp -TimeoutSec 30

  if ($skillMd5Match.Success) {
    $actualMd5 = (Get-FileHash -Algorithm MD5 -LiteralPath $skillTemp).Hash.ToLowerInvariant()
    if ($actualMd5 -ne $skillMd5Match.Groups[1].Value.ToLowerInvariant()) {
      Write-WarningMessage 'SKILL.md 校验值与官方提示不一致，已继续安装程序。'
    }
  }

  Write-Info "正在安装到 $InstallDir …"
  Copy-Item -LiteralPath $binaryTemp -Destination $TargetPath -Force
  $skillDir = Join-Path $env:USERPROFILE '.dreamina_cli\dreamina'
  $metadataDir = Split-Path -Parent $skillDir
  New-Item -ItemType Directory -Path $skillDir -Force | Out-Null
  Copy-Item -LiteralPath $skillTemp -Destination (Join-Path $skillDir 'SKILL.md') -Force
  Copy-Item -LiteralPath $versionTemp -Destination (Join-Path $metadataDir 'version.json') -Force

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $pathItems = @($userPath -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if (-not ($pathItems | Where-Object { $_.TrimEnd('\') -ieq $InstallDir.TrimEnd('\') })) {
    [Environment]::SetEnvironmentVariable('Path', (($pathItems + $InstallDir) -join ';'), 'User')
    Write-Info '已将安装目录加入当前用户 PATH。'
  } else {
    Write-Info '当前用户 PATH 已包含安装目录。'
  }

  # Make the command available in this same PowerShell process as well.
  $env:Path = "$InstallDir;$env:Path"
  $version = (& $TargetPath --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $version) { throw '程序已下载，但版本验证失败。请重新运行安装器。' }

  Write-Host ''
  Write-Host "安装完成：$TargetPath" -ForegroundColor Green
  Write-Host "版本：$($version.Split([Environment]::NewLine)[0])" -ForegroundColor Green
  Write-Host '请回到 SANMAO.AI 设置页点击“重新检测”，然后连接即梦。' -ForegroundColor Green
  Write-Host '新打开的终端中也可以直接运行：dreamina --version' -ForegroundColor DarkGray
} catch {
  $exitCode = 1
  Write-Host ''
  Write-Host "安装失败：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host '如果网络受限，请打开官方安装说明，或稍后重新双击此文件。' -ForegroundColor Yellow
} finally {
  if (Test-Path -LiteralPath $TempDir) {
    Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

exit $exitCode
