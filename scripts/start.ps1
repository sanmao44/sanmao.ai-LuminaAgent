param(
  [int]$Port = 0,
  [switch]$NonInteractive = $false,
  [switch]$Lan = $false,
  [switch]$ForceRestart = $false,
  [switch]$FreeRelay = $false
)

$ErrorActionPreference = 'Stop'
# Load the Windows security cmdlets explicitly before reading the DPAPI-backed
# LAN password. Prefer the inbox Windows PowerShell module by absolute path:
# Codex can add a PowerShell 7 compatibility module to PSModulePath, and that
# module conflicts with the Windows PowerShell type data during auto-loading.
$securityModulePath = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
if (Test-Path -LiteralPath $securityModulePath) {
  Import-Module -Name $securityModulePath -ErrorAction Stop
} else {
  Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
}
$script:NonInteractive = $NonInteractive.IsPresent
try { $Host.UI.RawUI.WindowTitle = 'SANMAO.AI 启动器' } catch {}
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$script:MediaRelayRequired = $false
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
$networkMode = if ($Lan.IsPresent) { 'lan' } else { 'local' }
$bindHost = if ($Lan.IsPresent) { '0.0.0.0' } else { '127.0.0.1' }
$lanPasswordPath = Join-Path $root '.data\lan-password'
$legacyMarkerPath = Join-Path $env:TEMP 'sanmao-ai-studio-instance.lock'
$script:serverProcess = $null
$serverStdoutPath = Join-Path $env:TEMP 'sanmao-ai-studio-server.out.log'
$serverStderrPath = Join-Path $env:TEMP 'sanmao-ai-studio-server.err.log'

. (Join-Path $PSScriptRoot 'launcher-common.ps1')
. (Join-Path $PSScriptRoot 'free-relay-common.ps1')
Initialize-SanmaoLauncher -Root $root -PortStart $portStart -PortEnd $portEnd -LegacyPortStart 3000 -LegacyPortEnd 3010 -LogPath (Join-Path $root '.data\logs\launcher.log')

function Get-SanmaoSha256([string]$Path) {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
      return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '')
    } finally {
      $stream.Dispose()
    }
  } finally {
    $sha256.Dispose()
  }
}

# Releases before 0.7.5 overwrote apply-update.ps1 with their running updater
# after copying a new archive. Restore the versioned bootstrap from the new
# archive as soon as the restarted launcher runs, so the following update uses
# the fixed core updater instead of the legacy one.
try {
  $updaterBootstrap = Join-Path $PSScriptRoot 'apply-update-bootstrap.ps1'
  $updaterEntry = Join-Path $PSScriptRoot 'apply-update.ps1'
  if (Test-Path -LiteralPath $updaterBootstrap) {
    $bootstrapHash = Get-SanmaoSha256 $updaterBootstrap
    $entryHash = if (Test-Path -LiteralPath $updaterEntry) { Get-SanmaoSha256 $updaterEntry } else { '' }
    if ($bootstrapHash -ne $entryHash) {
      Copy-Item -LiteralPath $updaterBootstrap -Destination $updaterEntry -Force
      Write-SanmaoLauncherLog '已恢复当前版本的更新器入口。' 'INFO'
    }
  }
} catch {
  Write-SanmaoLauncherLog "恢复更新器入口失败：$($_.Exception.Message)" 'WARN'
}
Write-SanmaoLauncherLog "启动器开始运行，根目录：$root，端口范围：$portStart..$portEnd" 'INFO'

function Test-SanmaoServerAtPort([int]$port) {
  return Test-SanmaoHealthEndpoint -Port $port
}

function Test-SanmaoMediaRelayRequired {
  $dataRoot = [string]$env:SANMAO_DATA_DIR
  if ([string]::IsNullOrWhiteSpace($dataRoot)) {
    $dataRoot = Join-Path $root '.data'
  } elseif (-not [System.IO.Path]::IsPathRooted($dataRoot)) {
    $dataRoot = Join-Path $root $dataRoot
  }
  $statePath = Join-Path $dataRoot 'state.json'
  if (-not (Test-Path -LiteralPath $statePath)) { return $false }
  try {
    $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $hasUpscaleConnection = @($state.upscaleConnections | Where-Object {
        $_.status -eq 'healthy' -and (
          (-not [string]::IsNullOrWhiteSpace([string]$_.encryptedSecretId) -and -not [string]::IsNullOrWhiteSpace([string]$_.encryptedSecretKey)) -or
          (-not [string]::IsNullOrWhiteSpace([string]$_.encryptedAccessKeyId) -and -not [string]::IsNullOrWhiteSpace([string]$_.encryptedAccessKeySecret))
        )
      }).Count -gt 0
    if ($hasUpscaleConnection) { return $true }
    foreach ($provider in @($state.providers)) {
      $transport = ([string]$provider.videoTransport).ToLowerInvariant()
      $hasCredential = -not [string]::IsNullOrWhiteSpace([string]$provider.encryptedApiKey) -or -not [string]::IsNullOrWhiteSpace([string]$provider.encryptedVideoApiKey) -or -not [string]::IsNullOrWhiteSpace([string]$provider.apiKey)
      if (-not $hasCredential) { continue }
      if ($transport -eq 'agnes-videos' -or $transport -eq 'openai-videos') { return $true }
      if ($transport -eq 'native-task' -or $transport -eq 'jimeng-cli') { continue }
      if ($transport -eq 'auto' -or -not $transport) {
        $hasVideoModel = @($state.models | Where-Object { $_.providerId -eq $provider.id -and ($_.kind -eq 'video' -or @($_.capabilities) -contains 'video-generate') }).Count -gt 0
        if ($hasVideoModel) { return $true }
      }
    }
  } catch {}
  return $false
}

$script:MediaRelayRequired = Test-SanmaoMediaRelayRequired

function Get-SanmaoServerInfo([int]$port) {
  $health = Invoke-SanmaoLocalHttp -Port $port -Path '/api/health' -TimeoutMs 1000
  if (-not $health.Ok -or $health.StatusCode -lt 200 -or $health.StatusCode -ge 500) { return $null }
  try {
    $data = $health.Content | ConvertFrom-Json
    if ($data.service -ne 'sanmao-ai-studio') { return $null }
    $relayMode = 'unknown'
    $relay = Invoke-SanmaoLocalHttp -Port $port -Path '/api/relay/status' -TimeoutMs 1000
    if ($relay.Ok -and $relay.StatusCode -ge 200 -and $relay.StatusCode -lt 300) {
      try {
        $relayData = $relay.Content | ConvertFrom-Json
        if ($relayData.mode -in @('relay', 'self-hosted', 'unavailable')) { $relayMode = [string]$relayData.mode }
      } catch {}
    }
    return [pscustomobject]@{
      Port = $port
      NetworkMode = if ($data.networkMode -eq 'lan') { 'lan' } else { 'local' }
      LifecycleEnabled = [bool]$data.lifecycleEnabled
      MediaRelayMode = $relayMode
    }
  } catch { return $null }
}

function Get-SanmaoLanAddresses {
  $values = @()
  try {
    if (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue) {
      $values = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Select-Object -ExpandProperty IPAddress)
    }
  } catch {}
  if ($values.Count -eq 0) {
    try {
      $values = @([System.Net.Dns]::GetHostEntry([System.Net.Dns]::GetHostName()).AddressList |
        Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } |
        ForEach-Object { $_.IPAddressToString })
    } catch {}
  }
  return @($values |
    Where-Object { $_ -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' } |
    Sort-Object -Unique)
}

function Test-SanmaoPrivateFirewallRule([int]$port) {
  try {
    if (-not (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue)) { return $null }
    $rules = @(Get-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Private -ErrorAction Stop)
    foreach ($rule in $rules) {
      $filters = @(Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue)
      foreach ($filter in $filters) {
        $localPort = [string]$filter.LocalPort
        if ($localPort -eq 'Any' -or @($localPort -split ',' | Where-Object { $_.Trim() -eq [string]$port }).Count -gt 0) { return $true }
      }
    }
    return $false
  } catch { return $null }
}

function Show-SanmaoLanAccess([int]$port) {
  $addresses = @(Get-SanmaoLanAddresses)
  if ($addresses.Count -eq 0) {
    Write-Host '没有检测到私有局域网 IPv4 地址，请确认主机已连接 WiFi 或网线。' -ForegroundColor Yellow
  } else {
    Write-Host '其他电脑请访问以下局域网画布地址：' -ForegroundColor Green
    foreach ($address in $addresses) { Write-Host "  http://$address`:$port/canvas" -ForegroundColor White }
  }
  $firewall = Test-SanmaoPrivateFirewallRule $port
  if ($firewall -eq $false) {
    Write-Host 'Windows 防火墙可能尚未允许此端口。若其他电脑打不开，请在“管理员 PowerShell”执行：' -ForegroundColor Yellow
    Write-Host "New-NetFirewallRule -DisplayName 'SANMAO.AI LAN $port' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Private" -ForegroundColor DarkGray
  } elseif ($null -eq $firewall) {
    Write-Host '如其他电脑打不开，请确认 Windows 防火墙已允许此端口的“专用网络”入站访问。' -ForegroundColor Yellow
  }
  Write-Host '局域网模式仅建议在可信网络使用，不要将端口转发到公网。' -ForegroundColor DarkGray
}

function Test-LocalPortOpen([int]$port) {
  try {
    $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    return [bool]($listeners | Where-Object { $_.Port -eq $port })
  } catch {
    try {
      $client = New-Object System.Net.Sockets.TcpClient
      $task = $client.ConnectAsync('127.0.0.1', $port)
      if ($task.Wait(180)) {
        $open = $client.Connected
        $client.Dispose()
        return $open
      }
      $client.Dispose()
    } catch {}
    return $false
  }
}

function Get-ListeningPortSnapshot {
  try {
    $ports = @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | ForEach-Object { [int]$_.Port })
    if ($ports.Count -eq 0) { return -1 }
    return $ports
  } catch {
    return $null
  }
}

function Get-SanmaoNextProcessesAtPort([int]$port) {
  return @(Get-SanmaoOwnedServerProcesses -Ports @($port))
}

function Test-SanmaoProcessAtPort([int]$port) {
  return @((Get-SanmaoNextProcessesAtPort $port)).Count -gt 0
}

function Stop-SanmaoProcessAtPort([int]$port) {
  foreach ($processItem in @(Get-SanmaoNextProcessesAtPort $port)) {
    Stop-SanmaoOwnedProcess -Process $processItem | Out-Null
  }
}

function Wait-SanmaoPortReleased([int]$port) {
  return Wait-SanmaoPortsReleased -Ports @($port) -TimeoutMs 10000
}

function Test-SanmaoBuildStale {
  if ($env:SANMAO_FORCE_BUILD -eq '1') { return $true }
  $buildIdPath = Join-Path $root '.next\BUILD_ID'
  if (-not (Test-Path -LiteralPath $buildIdPath)) { return $true }
  $buildTime = (Get-Item -LiteralPath $buildIdPath).LastWriteTimeUtc
  $files = @()
  foreach ($directory in @('app', 'components', 'lib', 'public')) {
    $path = Join-Path $root $directory
    if (Test-Path -LiteralPath $path) {
      $files += Get-ChildItem -LiteralPath $path -Recurse -File -Force -ErrorAction SilentlyContinue
    }
  }
  foreach ($fileName in @('next.config.ts', 'next.config.js', 'tsconfig.json', 'package.json', 'package-lock.json')) {
    $path = Join-Path $root $fileName
    if (Test-Path -LiteralPath $path) { $files += Get-Item -LiteralPath $path }
  }
  $newest = $files | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  return $null -ne $newest -and $newest.LastWriteTimeUtc -gt $buildTime
}

function Get-SanmaoBuildId {
  $buildIdPath = Join-Path $root '.next\BUILD_ID'
  if (-not (Test-Path -LiteralPath $buildIdPath -PathType Leaf)) { return '' }
  try { return (Get-Content -LiteralPath $buildIdPath -Raw -ErrorAction Stop).Trim() } catch { return '' }
}

function Test-SanmaoServedBuildStale {
  $buildId = Get-SanmaoBuildId
  $servedBuildIdPath = Join-Path $root '.next\.sanmao-running-build-id'
  if ([string]::IsNullOrWhiteSpace($buildId) -or -not (Test-Path -LiteralPath $servedBuildIdPath -PathType Leaf)) { return $true }
  try {
    $servedBuildId = (Get-Content -LiteralPath $servedBuildIdPath -Raw -ErrorAction Stop).Trim()
    return $servedBuildId -ne $buildId
  } catch { return $true }
}

function Test-SanmaoBuildArtifacts {
  $requiredPaths = @(
    (Join-Path $root '.next\BUILD_ID'),
    (Join-Path $root '.next\prerender-manifest.json'),
    (Join-Path $root '.next\routes-manifest.json')
  )
  foreach ($path in $requiredPaths) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
  }

  # next start can report Ready and then exit if a manifest is still being
  # written. Read both JSON files so the launcher never starts against a
  # partially materialized production build.
  foreach ($path in $requiredPaths[1..2]) {
    try {
      $content = Get-Content -LiteralPath $path -Raw -ErrorAction Stop
      if ([string]::IsNullOrWhiteSpace($content)) { return $false }
      $null = $content | ConvertFrom-Json -ErrorAction Stop
    } catch {
      return $false
    }
  }
  return $true
}

function Wait-SanmaoBuildArtifacts([int]$TimeoutMs = 15000) {
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  do {
    if (Test-SanmaoBuildArtifacts) { return $true }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)
  return $false
}

# The running service itself is the source of truth. There is deliberately no
# lock file for service lifetime: a stale launcher PID must not prevent a later
# launch. The preflight mutex below only serializes setup and startup.
function Find-ExistingServer {
  $listeningPorts = Get-ListeningPortSnapshot
  for ($port = $portStart; $port -le $portEnd; $port++) {
    if ($null -ne $listeningPorts) {
      if ($listeningPorts -notcontains $port) { continue }
    } elseif (-not (Test-LocalPortOpen $port)) {
      continue
    }
    $info = Get-SanmaoServerInfo $port
    if ((Test-SanmaoProcessAtPort $port) -and $info) { return $info }
  }
  return 0
}

function Write-Step([string]$text) {
  Write-Host ""
  Write-Host "==> $text" -ForegroundColor Cyan
}
function Stop-StartedServer {
  if ($script:serverProcess -and -not $script:serverProcess.HasExited) {
    Stop-Process -Id $script:serverProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
function Fail([string]$text) {
  Stop-StartedServer
  Stop-SanmaoFreeRelayTunnel -Root $root
  Write-SanmaoLauncherLog "启动失败：$text" 'ERROR'
  Write-Host ""
  Write-Host "启动失败：$text" -ForegroundColor Red
  if (Test-Path -LiteralPath $serverStderrPath) {
    $details = Get-Content -LiteralPath $serverStderrPath -Tail 12 -ErrorAction SilentlyContinue
    if ($details) {
      Write-Host ""
      Write-Host '服务端最后的错误：' -ForegroundColor Yellow
      $details | Write-Host
    }
  }
  Write-Host "服务端日志：$serverStderrPath" -ForegroundColor DarkGray
  if (-not $script:NonInteractive) {
    Write-Host ""
    Read-Host '按回车键关闭窗口'
  }
  exit 1
}

function Read-SanmaoSecret {
  $secure = Read-Host -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Load-SanmaoLanPassword {
  if (Test-Path -LiteralPath $lanPasswordPath) {
    try {
      $encrypted = (Get-Content -LiteralPath $lanPasswordPath -Raw -ErrorAction Stop).Trim()
      if (-not $encrypted) { return }
      $secure = ConvertTo-SecureString -String $encrypted -ErrorAction Stop
      $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      try { $env:SANMAO_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
      finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    } catch {
      Write-SanmaoLauncherLog '读取局域网管理员密码密文失败，将重新要求输入。' 'WARN'
    }
  }
}

function Save-SanmaoLanPassword([string]$password) {
  try {
    $secure = ConvertTo-SecureString -String $password -AsPlainText -Force
    $encrypted = ConvertFrom-SecureString -SecureString $secure
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lanPasswordPath) | Out-Null
    Set-Content -LiteralPath $lanPasswordPath -Value $encrypted -Encoding ASCII
  } catch {
    Write-SanmaoLauncherLog '保存局域网管理员密码密文失败，后续启动可能需要再次输入。' 'WARN'
  }
}

function Ensure-SanmaoLanPassword {
  Load-SanmaoLanPassword
  $configured = $env:SANMAO_ADMIN_PASSWORD
  if ($configured -and $configured.Trim().Length -ge 8) {
    $env:SANMAO_ADMIN_PASSWORD = $configured.Trim()
    return
  }
  if ($configured) {
    Fail '局域网模式要求 SANMAO_ADMIN_PASSWORD 至少 8 位。'
  }
  if ($script:NonInteractive) {
    Fail '局域网模式需要管理员密码。请设置 SANMAO_ADMIN_PASSWORD 后重试，或直接双击局域网启动器。'
  }
  Write-Host '局域网模式需要设置管理员密码（至少 8 位，仅用于本次服务，不会写入项目文件）。' -ForegroundColor Yellow
  Write-Host '请输入管理员密码：' -ForegroundColor Yellow
  $first = Read-SanmaoSecret
  if (-not $first -or $first.Length -lt 8) { Fail '管理员密码至少需要 8 位。' }
  Write-Host '请再次输入管理员密码：' -ForegroundColor Yellow
  $second = Read-SanmaoSecret
  if ($first -ne $second) { Fail '两次输入的管理员密码不一致。' }
  $env:SANMAO_ADMIN_PASSWORD = $first
  Save-SanmaoLanPassword $first
}

function Release-LauncherMutex {
  if ($script:LauncherMutex) {
    try { $script:LauncherMutex.ReleaseMutex() } catch {}
    try { $script:LauncherMutex.Dispose() } catch {}
    $script:LauncherMutex = $null
  }
}

# Serialize preflight only. If a previous hidden updater launcher is still
# building/starting, a second double-click waits and then reuses the service.
$script:LauncherMutex = New-Object System.Threading.Mutex($false, 'SanmaoAILauncherPreflight')
$acquired = $false
try {
  $acquired = $script:LauncherMutex.WaitOne(90000)
} catch {
  # An abandoned mutex is still acquired by the current process.
  $acquired = $true
}
if (-not $acquired) {
  Fail '另一个启动器正在运行，请稍候再试。'
}


$existing = Find-ExistingServer
if ($existing) {
  $existingPort = [int]$existing.Port
  $modeMismatch = $existing.NetworkMode -ne $networkMode
  $lifecycleMismatch = $existing.LifecycleEnabled -ne (-not $Lan.IsPresent)
  $buildStale = (Test-SanmaoBuildStale -or Test-SanmaoServedBuildStale)
  if (($modeMismatch -or $lifecycleMismatch -or $buildStale -or $ForceRestart.IsPresent) -and $Lan.IsPresent) { Ensure-SanmaoLanPassword }
  $freeRelayMismatch =
    ($FreeRelay.IsPresent -and $script:MediaRelayRequired -and (
      $existing.MediaRelayMode -in @('unknown', 'unavailable') -or
      ($existing.MediaRelayMode -eq 'relay' -and (
        -not (Test-SanmaoFreeRelayTunnel -Root $root) -or
        -not (Test-SanmaoFreeRelayReachable -Root $root)
      ))
    )) -or
    (-not $script:MediaRelayRequired -and $existing.MediaRelayMode -eq 'relay')
  if ($modeMismatch -or $lifecycleMismatch -or $buildStale -or $ForceRestart.IsPresent -or $freeRelayMismatch) {
    $reason = if ($freeRelayMismatch -and $script:MediaRelayRequired) { '正在准备免费媒体中转通道' } elseif ($freeRelayMismatch) { '正在关闭不需要的临时通道' } elseif ($ForceRestart.IsPresent) { '正在应用新的局域网管理员密码' } elseif ($modeMismatch) { '正在切换网络共享模式' } elseif ($lifecycleMismatch) { '正在更新本地服务生命周期设置' } else { '检测到源码比当前构建更新' }
    Write-Host "$reason，正在重启旧服务：http://localhost:$existingPort" -ForegroundColor Yellow
    Stop-SanmaoProcessAtPort $existingPort
    if (-not (Wait-SanmaoPortReleased $existingPort)) {
      Fail "旧服务仍占用端口 $existingPort，已停止启动以避免继续使用旧页面。请运行停止 SANMAO.AI - Windows.cmd 后重试。"
    }
  } else {
    if ($existing.NetworkMode -eq 'lan') {
      Write-Host "SANMAO.AI 局域网共享已在运行（本机：http://localhost:$existingPort）" -ForegroundColor Green
      Show-SanmaoLanAccess $existingPort
      $openUrl = "http://localhost:$existingPort/canvas"
    } else {
      Write-Host "SANMAO.AI 已在运行：http://localhost:$existingPort" -ForegroundColor Green
      $openUrl = "http://localhost:$existingPort"
    }
    Remove-Item -LiteralPath $legacyMarkerPath -Force -ErrorAction SilentlyContinue
    Release-LauncherMutex
    if (-not $script:NonInteractive) { Start-Process $openUrl }
    exit 0
  }
}
Remove-Item -LiteralPath $legacyMarkerPath -Force -ErrorAction SilentlyContinue

if ($Lan.IsPresent) { Ensure-SanmaoLanPassword }

# Clean stale project-owned Next services before dependency install and again
# before choosing a port. This reclaims hung/legacy/relative-path servers that
# used to make the port range look occupied.
if (-not (Clear-SanmaoOwnedServers -Ports @($legacyPortRange + $portRange))) {
  Write-SanmaoLauncherLog '部分旧服务端口未能释放，将继续使用可用端口。' 'WARN'
}

Write-Host '========================================' -ForegroundColor DarkGray
Write-Host '        SANMAO.AI 一键启动器 0.7.19' -ForegroundColor White
Write-Host '========================================' -ForegroundColor DarkGray

# 1. Check Node.js
Write-Step '检查 Node.js'
try {
  $nodeVersionText = (& node --version 2>$null).Trim()
} catch {
  Fail '没有检测到 Node.js。请先安装 Node.js 20.9 或更高版本，然后重新双击启动。'
}
if (-not $nodeVersionText) {
  Fail '没有检测到 Node.js。请先安装 Node.js 20.9 或更高版本。'
}
$ver = $nodeVersionText.TrimStart('v').Split('.')
$major = [int]$ver[0]
$minor = if ($ver.Length -gt 1) { [int]$ver[1] } else { 0 }
if (($major -lt 20) -or ($major -eq 20 -and $minor -lt 9)) {
  Fail "当前 Node.js 是 $nodeVersionText，SANMAO.AI 需要 Node.js 20.9 或更高版本。"
}
Write-Host "Node.js：$nodeVersionText" -ForegroundColor Green

# Node.js 默认不读取 Windows“Internet 选项”的静态代理；部分网络下会因此让
# 服务端接口请求超时。Node 22+ 支持读取 HTTP(S)_PROXY，启动时自动补齐即可。
function Enable-NodeSystemProxy {
  if ($major -lt 22) { return }
  if (-not $env:NODE_USE_ENV_PROXY) { $env:NODE_USE_ENV_PROXY = '1' }
  if ($env:HTTPS_PROXY -or $env:HTTP_PROXY) { return }
  try {
    $settings = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
    if (-not $settings.ProxyEnable -or -not $settings.ProxyServer) { return }
    $proxyMap = @{}
    foreach ($part in ([string]$settings.ProxyServer -split ';')) {
      $item = $part.Trim()
      if (-not $item) { continue }
      if ($item -match '^(?<scheme>https?|socks)=(?<address>.+)$') { $proxyMap[$Matches.scheme] = $Matches.address.Trim(); continue }
      if (-not $proxyMap.default) { $proxyMap.default = $item }
    }
    $httpProxy = $proxyMap.http
    if (-not $httpProxy) { $httpProxy = $proxyMap.default }
    if (-not $httpProxy) { $httpProxy = $proxyMap.https }
    $httpsProxy = $proxyMap.https
    if (-not $httpsProxy) { $httpsProxy = $proxyMap.default }
    if (-not $httpsProxy) { $httpsProxy = $proxyMap.http }
    if ($httpProxy) {
      $env:HTTP_PROXY = $httpProxy
      if ($httpProxy -notmatch '^[a-z]+://') { $env:HTTP_PROXY = "http://$httpProxy" }
    }
    if ($httpsProxy) {
      $env:HTTPS_PROXY = $httpsProxy
      if ($httpsProxy -notmatch '^[a-z]+://') { $env:HTTPS_PROXY = "http://$httpsProxy" }
    }
    if ($env:HTTPS_PROXY -or $env:HTTP_PROXY) { Write-Host '已启用系统代理，服务端接口请求会使用当前网络设置。' -ForegroundColor Green }
  } catch {}
}
Enable-NodeSystemProxy

try {
  $npmVersion = (& npm --version 2>$null).Trim()
} catch {
  Fail '没有检测到 npm。请重新安装 Node.js，并确保安装程序勾选 npm。'
}
Write-Host "npm：$npmVersion" -ForegroundColor Green

# 2. Install/repair dependencies
Write-Step '检查并安装程序依赖'
$requiredNext = '16.2.12'
$installedNext = ''
if (Test-Path '.\node_modules\next\package.json') {
  try { $installedNext = (& node -p "require('./node_modules/next/package.json').version").Trim() } catch { $installedNext = '' }
}
$nextCmdExists = Test-Path '.\node_modules\.bin\next.cmd'
$typescriptExists = Test-Path '.\node_modules\typescript\package.json'
$nodeTypesExists = Test-Path '.\node_modules\@types\node\package.json'
$reactTypesExists = Test-Path '.\node_modules\@types\react\package.json'
$reactDomTypesExists = Test-Path '.\node_modules\@types\react-dom\package.json'
$packageLockHashPath = '.\node_modules\.sanmao-package-lock.sha256'
$packageLockChanged = $false
if (Test-Path '.\package-lock.json') {
  if (-not (Test-Path $packageLockHashPath)) {
    $packageLockChanged = $true
  } else {
    try {
      $expectedLockHash = Get-SanmaoSha256 '.\package-lock.json'
      $installedLockHash = (Get-Content -LiteralPath $packageLockHashPath -Raw -ErrorAction Stop).Trim()
      $packageLockChanged = $expectedLockHash -ne $installedLockHash
    } catch {
      $packageLockChanged = $true
    }
  }
}
if (($installedNext -ne $requiredNext) -or (-not $nextCmdExists) -or (-not $typescriptExists) -or (-not $nodeTypesExists) -or (-not $reactTypesExists) -or (-not $reactDomTypesExists) -or $packageLockChanged) {
  Write-Host '首次运行或依赖不完整，正在执行 npm install。这个过程通常需要 1～5 分钟。' -ForegroundColor Yellow
  foreach ($repairPort in $portRange) {
    if (Test-SanmaoProcessAtPort $repairPort) { Stop-SanmaoProcessAtPort $repairPort }
  }
  Start-Sleep -Milliseconds 500
  if (Test-Path '.\package-lock.json') { & npm ci --include=dev --no-audit --no-fund } else { & npm install --include=dev --no-audit --no-fund }
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'npm 安装失败。常见原因是网络或 npm 源不可用。' -ForegroundColor Yellow
    Write-Host '你可以先在命令行运行：npm config get registry' -ForegroundColor Yellow
    Fail '依赖安装失败，请检查网络后再次运行启动器。'
  }
  if (Test-Path '.\package-lock.json') {
    (Get-SanmaoSha256 '.\package-lock.json') | Set-Content -LiteralPath $packageLockHashPath -Encoding ASCII
  }
} else {
  Write-Host "依赖已安装，Next.js：$installedNext" -ForegroundColor Green
}

if (-not (Test-Path '.\node_modules\.bin\next.cmd')) {
  Fail '依赖安装完成后仍找不到 Next.js。请删除 node_modules 文件夹后重新运行启动器。'
}

# 3. Build production bundle（智能构建：代码没变就跳过，固定使用 webpack）
Write-Step '检查构建产物是否最新'

$nextCmd = Join-Path $root 'node_modules\.bin\next.cmd'
$buildIdPath = Join-Path $root '.next\BUILD_ID'

$needBuild = ($env:SANMAO_FORCE_BUILD -eq '1') -or (-not (Test-SanmaoBuildArtifacts))
if (-not $needBuild) {
  $buildTime = (Get-Item -LiteralPath $buildIdPath).LastWriteTimeUtc
  $files = @()
  foreach ($d in @('app', 'components', 'lib', 'public')) {
    $dir = Join-Path $root $d
    if (Test-Path -LiteralPath $dir) { $files += Get-ChildItem -LiteralPath $dir -Recurse -File -Force -ErrorAction SilentlyContinue }
  }
  foreach ($f in @('next.config.ts', 'next.config.js', 'tsconfig.json', 'package.json', 'package-lock.json')) {
    $p = Join-Path $root $f
    if (Test-Path -LiteralPath $p) { $files += Get-Item -LiteralPath $p }
  }
  $files += Get-ChildItem -LiteralPath $root -Filter '.env*' -File -Force -ErrorAction SilentlyContinue
  $newest = $files | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  $needBuild = $true
  if ($newest -and $newest.LastWriteTimeUtc -lt $buildTime) { $needBuild = $false }
}

if ($needBuild) {
  Write-Host '需要重新构建（首次运行或代码有更新）。只需等这一次，之后启动会直接跳过构建。' -ForegroundColor Yellow
  Write-Host '使用 webpack 构建，避免 Turbopack 在中文内容中的字符边界崩溃。' -ForegroundColor Yellow
  & $nextCmd build --webpack
  if ($LASTEXITCODE -ne 0) {
    Fail '网页构建失败。请把本窗口中“构建失败”上方的报错截图发给我。'
  }
  if (-not (Wait-SanmaoBuildArtifacts)) {
    Fail '网页构建完成但构建产物不完整，请再次运行启动器。'
  }
  Write-Host '构建完成。' -ForegroundColor Green
} else {
  if (-not (Wait-SanmaoBuildArtifacts)) {
    Fail '检测到网页构建产物不完整，请再次运行启动器。'
  }
  Write-Host '构建产物已是最新，跳过构建，直接启动。' -ForegroundColor Green
}

# 4. Choose a free port after reclaiming any owned stale listeners again.
Write-Step '启动 SANMAO.AI'
if (-not (Clear-SanmaoOwnedServers -Ports @($legacyPortRange + $portRange))) {
  Write-SanmaoLauncherLog '启动前仍有旧服务端口未释放。' 'WARN'
}
function Test-Port([int]$port) {
  return Test-LocalPortOpen $port
}

$port = $portStart
while (($port -le $portEnd) -and (Test-Port $port)) { $port++ }
if ($port -gt $portEnd) {
  $details = @()
  foreach ($p in $portRange) {
    $pids = @(Get-SanmaoOwningPidsByPort -Port $p)
    if ($pids.Count -gt 0) {
      $details += "端口 $p：PID $($pids -join ', ')"
    }
  }
  if ($details.Count -gt 0) {
    Fail ("$($portStart)～$($portEnd) 端口都被占用。" + ($details -join '；') + '。请关闭对应进程后重试。')
  } else {
    Fail "$($portStart)～$($portEnd) 端口都被占用，请关闭旧的 SANMAO.AI/开发服务器后再试。"
  }
}

$freeRelayRequested = $FreeRelay.IsPresent -and $script:MediaRelayRequired
if ($FreeRelay.IsPresent -and $script:MediaRelayRequired) {
  # Set relay mode before the Next process starts. The tunnel itself is
  # created after the local health endpoint is ready; otherwise cloudflared
  # can publish an address that points at a service which is not listening yet.
  Remove-Item Env:SANMAO_RELAY_MODE, Env:SANMAO_RELAY_PUBLIC_BASE_URL -ErrorAction SilentlyContinue
  $env:SANMAO_RELAY_MODE = '1'
  if ($env:SANMAO_MEDIA_RELAY_URL -match '^https://[a-z0-9-]+\.trycloudflare\.com/?$') {
    Remove-Item Env:SANMAO_MEDIA_RELAY_URL -ErrorAction SilentlyContinue
  }
} elseif (-not $script:MediaRelayRequired) {
  Remove-Item Env:SANMAO_RELAY_MODE, Env:SANMAO_RELAY_PUBLIC_BASE_URL -ErrorAction SilentlyContinue
  if ($env:SANMAO_MEDIA_RELAY_URL -match '^https://[a-z0-9-]+\.trycloudflare\.com/?$') {
    Remove-Item Env:SANMAO_MEDIA_RELAY_URL -ErrorAction SilentlyContinue
  }
  Stop-SanmaoFreeRelayTunnel -Root $root
}

if ($Lan.IsPresent) {
  Remove-Item Env:SANMAO_LIFECYCLE -ErrorAction SilentlyContinue
} else {
  $env:SANMAO_LIFECYCLE = '1'
}
$env:SANMAO_NETWORK_MODE = $networkMode
Remove-Item -LiteralPath $serverStdoutPath, $serverStderrPath -Force -ErrorAction SilentlyContinue
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$nextCliPath = Join-Path $root 'node_modules\next\dist\bin\next'
$script:serverProcess = Start-Process `
  -FilePath $nodePath `
  -ArgumentList @($nextCliPath, 'start', '-H', $bindHost, '-p', "$port") `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $serverStdoutPath `
  -RedirectStandardError $serverStderrPath `
  -PassThru

Write-Host "正在等待 http://localhost:$port 启动..." -ForegroundColor Yellow
Write-SanmaoLauncherLog "已启动服务进程 PID $($script:serverProcess.Id)，等待端口 $port 就绪。" 'INFO'
$ready = $false
for ($i = 0; $i -lt 150; $i++) {
  Start-Sleep -Milliseconds 200
  if ($script:serverProcess.HasExited) { break }
  if (-not (Test-LocalPortOpen $port)) { continue }
  $serverInfo = Get-SanmaoServerInfo $port
  if ($serverInfo -and $serverInfo.NetworkMode -eq $networkMode) { $ready = $true; break }
}

if (-not $ready) {
  Fail '服务器没有在预期时间内启动。'
}

$runningBuildId = Get-SanmaoBuildId
if ($runningBuildId) {
  Set-Content -LiteralPath (Join-Path $root '.next\.sanmao-running-build-id') -Value $runningBuildId -Encoding ASCII
}

if ($freeRelayRequested) {
  Write-Host '正在准备免费媒体中转通道…' -ForegroundColor Yellow
  $freeRelayInfo = Start-SanmaoFreeRelayTunnel -Root $root -OriginPort $port
  if ($freeRelayInfo) {
    # The server reads the current URL from public-url.txt on each upload, so
    # recovery does not require restarting the Next process.
    $env:SANMAO_RELAY_MODE = '1'
    $env:SANMAO_RELAY_PUBLIC_BASE_URL = $freeRelayInfo.PublicUrl
    $env:SANMAO_MEDIA_RELAY_URL = $freeRelayInfo.PublicUrl
    Write-SanmaoLauncherLog "已启动免费临时通道：$($freeRelayInfo.PublicUrl)" 'INFO'
  } else {
    Write-SanmaoLauncherLog '免费临时通道首次启动失败，监视器将自动重试。' 'WARN'
  }
  try {
    $watchScript = Join-Path $PSScriptRoot 'free-relay-watch.ps1'
    Start-Process -FilePath 'powershell.exe' `
      -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $watchScript, '-Root', $root, '-TargetProcessId', [string]$script:serverProcess.Id, '-OriginPort', [string]$port) `
      -WorkingDirectory $root `
      -WindowStyle Hidden | Out-Null
  } catch {
    Write-SanmaoLauncherLog "免费临时通道自动清理监视器启动失败：$($_.Exception.Message)" 'WARN'
  }
}

$url = "http://localhost:$port"
if ($Lan.IsPresent) {
  Write-Host "SANMAO.AI 局域网共享已启动（本机：$url）" -ForegroundColor Green
  Show-SanmaoLanAccess $port
  $openUrl = "$url/canvas"
} else {
  Write-Host "SANMAO.AI 已启动：$url" -ForegroundColor Green
  $openUrl = $url
}
Write-Host '本地服务会保持运行，下一次启动会直接打开已有服务。' -ForegroundColor DarkGray
Write-SanmaoLauncherLog "服务已就绪：http://localhost:$port，网络模式：$networkMode" 'INFO'
Release-LauncherMutex
if (-not $script:NonInteractive) { Start-Process $openUrl }
Start-Sleep -Milliseconds 300
