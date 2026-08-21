param(
  [int]$Port = 0,
  [switch]$NonInteractive = $false
)

$ErrorActionPreference = 'Stop'
$script:NonInteractive = $NonInteractive.IsPresent
try { $Host.UI.RawUI.WindowTitle = 'SANMAO.AI ???' } catch {}
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
Write-SanmaoLauncherLog "????????????$root??????$portStart..$portEnd" 'INFO'

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
  Write-SanmaoLauncherLog "?????$text" 'ERROR'
  Write-Host ""
  Write-Host "?????$text" -ForegroundColor Red
  if (Test-Path -LiteralPath $serverStderrPath) {
    $details = Get-Content -LiteralPath $serverStderrPath -Tail 12 -ErrorAction SilentlyContinue
    if ($details) {
      Write-Host ""
      Write-Host '?????????' -ForegroundColor Yellow
      $details | Write-Host
    }
  }
  Write-Host "??????$serverStderrPath" -ForegroundColor DarkGray
  if (-not $script:NonInteractive) {
    Write-Host ""
    Read-Host '????????'
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
  Fail '?????????????????'
}


$existingPort = Find-ExistingServer
if ($existingPort -gt 0) {
  if (Test-SanmaoBuildStale) {
    Write-Host "?????????????????????http://localhost:$existingPort" -ForegroundColor Yellow
    Stop-SanmaoProcessAtPort $existingPort
    if (-not (Wait-SanmaoPortReleased $existingPort)) {
      Fail "???????? $existingPort?????????????????????? SANMAO.AI - Windows.cmd ????"
    }
  } else {
    Write-Host "SANMAO.AI ?????http://localhost:$existingPort" -ForegroundColor Green
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
  Write-SanmaoLauncherLog '??????????????????????' 'WARN'
}

Write-Host '========================================' -ForegroundColor DarkGray
Write-Host '        SANMAO.AI ????? 0.7.2' -ForegroundColor White
Write-Host '========================================' -ForegroundColor DarkGray

# 1. Check Node.js
Write-Step '?? Node.js'
try {
  $nodeVersionText = (& node --version 2>$null).Trim()
} catch {
  Fail '????? Node.js????? Node.js 20.9 ???????????????'
}
if (-not $nodeVersionText) {
  Fail '????? Node.js????? Node.js 20.9 ??????'
}
$ver = $nodeVersionText.TrimStart('v').Split('.')
$major = [int]$ver[0]
$minor = if ($ver.Length -gt 1) { [int]$ver[1] } else { 0 }
if (($major -lt 20) -or ($major -eq 20 -and $minor -lt 9)) {
  Fail "?? Node.js ? $nodeVersionText?SANMAO.AI ?? Node.js 20.9 ??????"
}
Write-Host "Node.js?$nodeVersionText" -ForegroundColor Green

# Node.js ????? Windows?Internet ??????????????????
# ??????????Node 22+ ???? HTTP(S)_PROXY???????????
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
    if ($env:HTTPS_PROXY -or $env:HTTP_PROXY) { Write-Host '?????????????????????????' -ForegroundColor Green }
  } catch {}
}
Enable-NodeSystemProxy

try {
  $npmVersion = (& npm --version 2>$null).Trim()
} catch {
  Fail '????? npm?????? Node.js?????????? npm?'
}
Write-Host "npm?$npmVersion" -ForegroundColor Green

# 2. Install/repair dependencies
Write-Step '?????????'
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
  Write-Host '??????????????? npm install????????? 1?5 ???' -ForegroundColor Yellow
  foreach ($repairPort in $portRange) {
    if (Test-SanmaoProcessAtPort $repairPort) { Stop-SanmaoProcessAtPort $repairPort }
  }
  Start-Sleep -Milliseconds 500
  if (Test-Path '.\package-lock.json') { & npm ci --include=dev --no-audit --no-fund } else { & npm install --include=dev --no-audit --no-fund }
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'npm ????????????? npm ?????' -ForegroundColor Yellow
    Write-Host '???????????npm config get registry' -ForegroundColor Yellow
    Fail '?????????????????????'
  }
  if (Test-Path '.\package-lock.json') {
    (Get-FileHash -Algorithm SHA256 -LiteralPath '.\package-lock.json').Hash | Set-Content -LiteralPath $packageLockHashPath -Encoding ASCII
  }
} else {
  Write-Host "??????Next.js?$installedNext" -ForegroundColor Green
}

if (-not (Test-Path '.\node_modules\.bin\next.cmd')) {
  Fail '??????????? Next.js???? node_modules ????????????'
}

# 3. Build production bundle?????????????????? webpack?
Write-Step '??????????'

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
  Write-Host '??????????????????????????????????????' -ForegroundColor Yellow
  Write-Host '?? webpack ????? Turbopack ??????????????' -ForegroundColor Yellow
  & $nextCmd build --webpack
  if ($LASTEXITCODE -ne 0) {
    Fail '??????????????????????????????'
  }
  Write-Host '?????' -ForegroundColor Green
} else {
  Write-Host '???????????????????' -ForegroundColor Green
}

# 4. Choose a free port after reclaiming any owned stale listeners again.
Write-Step '?? SANMAO.AI'
if (-not (Clear-SanmaoOwnedServers -Ports @($legacyPortRange + $portRange))) {
  Write-SanmaoLauncherLog '??????????????' 'WARN'
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
      $details += "?? $p?PID $($pids -join ', ')"
    }
  }
  if ($details.Count -gt 0) {
    Fail ("$($portStart)?$($portEnd) ???????" + ($details -join '?') + '????????????')
  } else {
    Fail "$($portStart)?$($portEnd) ???????????? SANMAO.AI/?????????"
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

Write-Host "???? http://localhost:$port ??..." -ForegroundColor Yellow
Write-SanmaoLauncherLog "??????? PID $($script:serverProcess.Id)????? $port ???" 'INFO'
$ready = $false
for ($i = 0; $i -lt 150; $i++) {
  Start-Sleep -Milliseconds 200
  if ($script:serverProcess.HasExited) { break }
  if (-not (Test-LocalPortOpen $port)) { continue }
  if (Test-SanmaoHealthEndpoint -Port $port) { $ready = $true; break }
}

if (-not $ready) {
  Fail '??????????????'
}

$url = "http://localhost:$port"
Write-Host "SANMAO.AI ????$url" -ForegroundColor Green
Write-Host '?????????????????????????' -ForegroundColor DarkGray
Write-SanmaoLauncherLog "??????http://localhost:$port" 'INFO'
Release-LauncherMutex
if (-not $script:NonInteractive) { Start-Process $url }
Start-Sleep -Milliseconds 300
