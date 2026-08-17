$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'SANMAO.AI 启动器'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$requestedPort = 0
if ($env:SANMAO_PORT -match '^\d+$') { $requestedPort = [int]$env:SANMAO_PORT }
$portStart = if ($requestedPort -ge 1024 -and $requestedPort -le 65525) { $requestedPort } else { 3210 }
$portEnd = $portStart + 10
$portRange = $portStart..$portEnd
$legacyPortRange = 3000..3010
$legacyMarkerPath = Join-Path $env:TEMP 'sanmao-ai-studio-instance.lock'
$script:serverProcess = $null
$serverStdoutPath = Join-Path $env:TEMP 'sanmao-ai-studio-server.out.log'
$serverStderrPath = Join-Path $env:TEMP 'sanmao-ai-studio-server.err.log'

function Test-SanmaoServerAtPort([int]$port) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/state" -UseBasicParsing -TimeoutSec 1
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 500) { return $false }
    $data = $response.Content | ConvertFrom-Json
    return $null -ne $data.providers -and $null -ne $data.models -and $null -ne $data.settings
  } catch { return $false }
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

function Test-SanmaoProcessAtPort([int]$port) {
  $escapedRoot = [regex]::Escape($root.TrimEnd('\'))
  $portPattern = '(?i)(?:^|\s)(?:-p|--port)(?:\s+|=)' + [regex]::Escape("$port") + '(?=\s|$)'
  foreach ($processItem in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
    $commandLine = [string]$processItem.CommandLine
    if (-not $commandLine) { continue }
    if ($commandLine -notmatch "(?i)$escapedRoot[\\/]node_modules[\\/]next[\\/]dist[\\/]bin[\\/]next") { continue }
    if ($commandLine -notmatch '(?i)(?:^|\s)start(?:\s|$)') { continue }
    if ($commandLine -match $portPattern) { return $true }
  }
  return $false
}

function Stop-SanmaoProcessAtPort([int]$port) {
  $escapedRoot = [regex]::Escape($root.TrimEnd('\'))
  $portPattern = '(?i)(?:^|\s)(?:-p|--port)(?:\s+|=)' + [regex]::Escape("$port") + '(?=\s|$)'
  foreach ($processItem in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
    $commandLine = [string]$processItem.CommandLine
    if (-not $commandLine) { continue }
    if ($commandLine -notmatch "(?i)$escapedRoot[\\/]node_modules[\\/]next[\\/]dist[\\/]bin[\\/]next") { continue }
    if ($commandLine -notmatch '(?i)(?:^|\s)start(?:\s|$)') { continue }
    if ($commandLine -match $portPattern) {
      & taskkill.exe /PID ([int]$processItem.ProcessId) /T /F 2>$null | Out-Null
    }
  }
}

# The running service itself is the source of truth. There is deliberately no
# lock file: a stale launcher PID must not prevent a later launch.
function Find-ExistingServer {
  $listeningPorts = Get-ListeningPortSnapshot
  for ($port = $portStart; $port -le $portEnd; $port++) {
    # A closed localhost port can make Invoke-WebRequest wait for its full
    # timeout on some Windows installations. Check TCP first so unused ports
    # are skipped immediately instead of costing roughly one second each.
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
  Write-Host ""
  Read-Host '按回车键关闭窗口'
  exit 1
}

# Migrate a service started by the old launcher so it cannot keep occupying
# the common 3000 port after this version switches to its dedicated range.
foreach ($legacyPort in $legacyPortRange) {
  if (Test-SanmaoProcessAtPort $legacyPort) { Stop-SanmaoProcessAtPort $legacyPort }
}

$existingPort = Find-ExistingServer
if ($existingPort -gt 0) {
  Write-Host "SANMAO.AI 已在运行：http://localhost:$existingPort" -ForegroundColor Green
  Remove-Item -LiteralPath $legacyMarkerPath -Force -ErrorAction SilentlyContinue
  Start-Process "http://localhost:$existingPort"
  exit 0
}
Remove-Item -LiteralPath $legacyMarkerPath -Force -ErrorAction SilentlyContinue

Write-Host '========================================' -ForegroundColor DarkGray
Write-Host '        SANMAO.AI 一键启动器 0.5.2' -ForegroundColor White
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
$installedLockPath = '.\node_modules\.package-lock.json'
$packageLockChanged = (Test-Path '.\package-lock.json') -and ((-not (Test-Path $installedLockPath)) -or ((Get-Item '.\package-lock.json').LastWriteTimeUtc -gt (Get-Item $installedLockPath).LastWriteTimeUtc))
if (($installedNext -ne $requiredNext) -or (-not $nextCmdExists) -or $packageLockChanged) {
  Write-Host '首次运行或依赖不完整，正在执行 npm install。这个过程通常需要 1～5 分钟。' -ForegroundColor Yellow
  if (Test-Path '.\package-lock.json') { & npm ci --no-audit --no-fund } else { & npm install --no-audit --no-fund }
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'npm 安装失败。常见原因是网络或 npm 源不可用。' -ForegroundColor Yellow
    Write-Host '你可以先在命令行运行：npm config get registry' -ForegroundColor Yellow
    Fail '依赖安装失败，请检查网络后再次运行启动器。'
  }
} else {
  Write-Host "依赖已安装，Next.js：$installedNext" -ForegroundColor Green
}

if (-not (Test-Path '.\node_modules\.bin\next.cmd')) {
  Fail '依赖安装完成后仍找不到 Next.js。请删除 node_modules 文件夹后重新运行启动器。'
}

# 3. Build production bundle（智能构建：代码没变就跳过，中文路径自动改用 webpack）
Write-Step '检查构建产物是否最新'

# 路径含中文等非 ASCII 字符时，Turbopack 会崩溃（start byte index is not a char boundary），自动改用 webpack
$hasNonAscii = $false
foreach ($ch in $root.ToCharArray()) { if ([int]$ch -gt 127) { $hasNonAscii = $true; break } }

$nextCmd = Join-Path $root 'node_modules\.bin\next.cmd'
$buildIdPath = Join-Path $root '.next\BUILD_ID'

# 需要重新构建的情况：强制构建（SANMAO_FORCE_BUILD=1）、没有构建产物、或源码比构建产物新
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
  if ($hasNonAscii) {
    Write-Host '检测到路径含中文，已自动使用 webpack 构建（Turbopack 不支持中文路径）。' -ForegroundColor Yellow
    & $nextCmd build --webpack
  } else {
    & $nextCmd build
  }
  if ($LASTEXITCODE -ne 0) {
    Fail '网页构建失败。请把本窗口中“构建失败”上方的报错截图发给我。'
  }
  Write-Host '构建完成。' -ForegroundColor Green
} else {
  Write-Host '构建产物已是最新，跳过构建，直接启动。' -ForegroundColor Green
}
# 4. Choose a free port
Write-Step '启动 SANMAO.AI'
function Test-Port([int]$port) {
  return Test-LocalPortOpen $port
}

$port = $portStart
while (($port -le $portEnd) -and (Test-Port $port)) { $port++ }
if ($port -gt $portEnd) { Fail "$($portStart)～$($portEnd) 端口都被占用，请关闭旧的 SANMAO.AI/开发服务器后再试。" }

# Keep the service independent of browser tabs. The launcher only starts it
# once and reuses it on later runs; this avoids stale PID/heartbeat state.
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
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 200
  if ($script:serverProcess.HasExited) { break }
  if (-not (Test-LocalPortOpen $port)) { continue }
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/state" -UseBasicParsing -TimeoutSec 1
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { $ready = $true; break }
  } catch {}
}

if (-not $ready) {
  Fail '服务器没有在预期时间内启动。'
}

$url = "http://localhost:$port"
Write-Host "SANMAO.AI 已启动：$url" -ForegroundColor Green
Write-Host '本地服务会保持运行，下一次启动会直接打开已有服务。' -ForegroundColor DarkGray
Start-Process $url
Start-Sleep -Milliseconds 300
