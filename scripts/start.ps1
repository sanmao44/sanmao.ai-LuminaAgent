param(
  [int]$Port = 0,
  [switch]$NonInteractive = $false
)

$ErrorActionPreference = 'Stop'
$script:NonInteractive = $NonInteractive.IsPresent
try { $Host.UI.RawUI.WindowTitle = 'SANMAO.AI 启动器' } catch {}
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
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
$legacyMarkerPath = Join-Path $env:TEMP 'sanmao-ai-studio-instance.lock'
$script:serverProcess = $null
$serverStdoutPath = Join-Path $env:TEMP 'sanmao-ai-studio-server.out.log'
$serverStderrPath = Join-Path $env:TEMP 'sanmao-ai-studio-server.err.log'

. (Join-Path $PSScriptRoot 'launcher-common.ps1')
Initialize-SanmaoLauncher -Root $root -PortStart $portStart -PortEnd $portEnd -LegacyPortStart 3000 -LegacyPortEnd 3010 -LogPath (Join-Path $root '.data\logs\launcher.log')
Write-SanmaoLauncherLog "启动器开始运行，根目录：$root，端口范围：$portStart..$portEnd" 'INFO'

function Test-SanmaoServerAtPort([int]$port) {
  return Test-SanmaoHealthEndpoint -Port $port
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
    if ((Test-SanmaoProcessAtPort $port) -and (Test-SanmaoServerAtPort $port)) { return $port }
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


$existingPort = Find-ExistingServer
if ($existingPort -gt 0) {
  if (Test-SanmaoBuildStale) {
    Write-Host "检测到源码比当前构建更新，正在重启旧服务：http://localhost:$existingPort" -ForegroundColor Yellow
    Stop-SanmaoProcessAtPort $existingPort
    if (-not (Wait-SanmaoPortReleased $existingPort)) {
      Fail "旧服务仍占用端口 $existingPort，已停止启动以避免继续使用旧页面。请运行停止 SANMAO.AI - Windows.cmd 后重试。"
    }
  } else {
    Write-Host "SANMAO.AI 已在运行：http://localhost:$existingPort" -ForegroundColor Green
    Remove-Item -LiteralPath $legacyMarkerPath -Force -ErrorAction SilentlyContinue
    Release-LauncherMutex
    if (-not $script:NonInteractive) { Start-Process "http://localhost:$existingPort" }
    exit 0
  }
}
Remove-Item -LiteralPath $legacyMarkerPath -Force -ErrorAction SilentlyContinue

# Clean stale project-owned Next services before dependency install and again
# before choosing a port. This reclaims hung/legacy/relative-path servers that
# used to make the port range look occupied.
if (-not (Clear-SanmaoOwnedServers -Ports @($legacyPortRange + $portRange))) {
  Write-SanmaoLauncherLog '部分旧服务端口未能释放，将继续使用可用端口。' 'WARN'
}

Write-Host '========================================' -ForegroundColor DarkGray
Write-Host '        SANMAO.AI 一键启动器 0.7.1' -ForegroundColor White
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
      $expectedLockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath '.\package-lock.json').Hash
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
    (Get-FileHash -Algorithm SHA256 -LiteralPath '.\package-lock.json').Hash | Set-Content -LiteralPath $packageLockHashPath -Encoding ASCII
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

$needBuild = ($env:SANMAO_FORCE_BUILD -eq '1') -or (-not (Test-Path -LiteralPath $buildIdPath))
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
  Write-Host '构建完成。' -ForegroundColor Green
} else {
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

Remove-Item Env:SANMAO_LIFECYCLE -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $serverStdoutPath, $serverStderrPath -Force -ErrorAction SilentlyContinue
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$nextCliPath = Join-Path $root 'node_modules\next\dist\bin\next'
$script:serverProcess = Start-Process `
  -FilePath $nodePath `
  -ArgumentList @($nextCliPath, 'start', '-H', '127.0.0.1', '-p', "$port") `
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
  if (Test-SanmaoHealthEndpoint -Port $port) { $ready = $true; break }
}

if (-not $ready) {
  Fail '服务器没有在预期时间内启动。'
}

$url = "http://localhost:$port"
Write-Host "SANMAO.AI 已启动：$url" -ForegroundColor Green
Write-Host '本地服务会保持运行，下一次启动会直接打开已有服务。' -ForegroundColor DarkGray
Write-SanmaoLauncherLog "服务已就绪：http://localhost:$port" 'INFO'
Release-LauncherMutex
if (-not $script:NonInteractive) { Start-Process $url }
Start-Sleep -Milliseconds 300
