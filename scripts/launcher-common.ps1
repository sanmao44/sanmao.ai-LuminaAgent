# Shared Windows launcher helpers for SANMAO.AI start.ps1 / stop.ps1.
# This file is dot-sourced. Call Initialize-SanmaoLauncher before using the
# functions below.

function Initialize-SanmaoLauncher {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [int]$PortStart = 3210,
    [int]$PortEnd = 3220,
    [int]$LegacyPortStart = 3000,
    [int]$LegacyPortEnd = 3010,
    [string]$LogPath
  )

  $script:LauncherRoot = $Root.TrimEnd('\', '/')
  $script:LauncherPortStart = $PortStart
  $script:LauncherPortEnd = $PortEnd
  $script:LauncherLegacyPortStart = $LegacyPortStart
  $script:LauncherLegacyPortEnd = $LegacyPortEnd
  $script:LauncherLogPath = $LogPath

  if ($script:LauncherLogPath) {
    try {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $script:LauncherLogPath) | Out-Null
    } catch {}
  }
}

function Write-SanmaoLauncherLog {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [string]$Level = 'INFO'
  )

  if (-not $script:LauncherLogPath) { return }
  try {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff')] [$Level] $Message"
    Add-Content -LiteralPath $script:LauncherLogPath -Value $line -Encoding UTF8
    $lines = @(Get-Content -LiteralPath $script:LauncherLogPath -ErrorAction Stop)
    if ($lines.Count -gt 200) {
      $lines = $lines[($lines.Count - 200)..($lines.Count - 1)]
      $lines | Set-Content -LiteralPath $script:LauncherLogPath -Encoding UTF8
    }
  } catch {}
}

function Get-SanmaoOwningPidsByPort {
  param([int]$Port)

  $pids = @()
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    try {
      $pids = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
        ForEach-Object { [int]$_.OwningProcess } |
        Where-Object { $_ -gt 0 } |
        Sort-Object -Unique)
      return $pids
    } catch {}
  }

  try {
    $lines = @(& netstat.exe -ano -p tcp 2>$null)
    foreach ($line in $lines) {
      if ($line -match 'LISTENING' -and $line -match ":$Port\s") {
        if ($line -match '\s(\d+)\s*$') {
          $pids += [int]$Matches[1]
        }
      }
    }
  } catch {}

  return @($pids | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
}

function Get-SanmaoListeningPorts {
  try {
    return @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty LocalPort -Unique |
      ForEach-Object { [int]$_ })
  } catch {}

  try {
    $ports = @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
      ForEach-Object { [int]$_.Port })
    return @($ports | Sort-Object -Unique)
  } catch {
    return @()
  }
}

function Invoke-SanmaoLocalHttp {
  param(
    [int]$Port,
    [string]$Path = '/api/health',
    [int]$TimeoutMs = 1200
  )

  try {
    $request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port$Path")
    $request.Proxy = $null
    $request.Timeout = $TimeoutMs
    $request.ReadWriteTimeout = $TimeoutMs
    $request.UserAgent = 'SANMAO.AI Launcher'
    $response = $request.GetResponse()
    try {
      $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [System.Text.Encoding]::UTF8)
      $content = $reader.ReadToEnd()
      return @{ Ok = $true; StatusCode = [int]$response.StatusCode; Content = $content }
    } finally {
      if ($response) { $response.Close() }
    }
  } catch {
    return @{ Ok = $false; StatusCode = 0; Content = '' }
  }
}

function Test-SanmaoHealthEndpoint {
  param([int]$Port)

  $health = Invoke-SanmaoLocalHttp -Port $Port -Path '/api/health' -TimeoutMs 1000
  if ($health.Ok -and $health.StatusCode -ge 200 -and $health.StatusCode -lt 500) {
    if ($health.Content -match '"service"\s*:\s*"sanmao-ai-studio"') { return $true }
  }

  $state = Invoke-SanmaoLocalHttp -Port $Port -Path '/api/state' -TimeoutMs 1000
  if ($state.Ok -and $state.StatusCode -ge 200 -and $state.StatusCode -lt 500) {
    if ($state.Content -match '"providers"' -and $state.Content -match '"models"' -and $state.Content -match '"settings"') {
      return $true
    }
  }

  return $false
}

function Test-SanmaoOwnedCommandLine {
  param(
    [int]$Port,
    [string]$CommandLine
  )

  if (-not $CommandLine) { return $false }
  $escapedRoot = [regex]::Escape($script:LauncherRoot)
  $absoluteNextPathPattern = "(?i)$escapedRoot[\\/]node_modules[\\/](?:\.bin[\\/]+\.\.[\\/]+)?next[\\/]dist[\\/]bin[\\/]next"
  $relativeNextPathPattern = '(?i)(?:^|["\s])(?:\.[\\/])?node_modules[\\/](?:\.bin[\\/]+\.\.[\\/]+)?next[\\/]dist[\\/]bin[\\/]next(?=\s|["$]|$)'
  $commandPattern = '(?i)(?:^|\s)(?:start|dev)(?=\s|$)'
  $portPattern = '(?i)(?:^|\s)(?:-p|--port)(?:\s+|=)' + [regex]::Escape("$Port") + '(?=\s|$)'

  if ($CommandLine -notmatch $commandPattern) { return $false }
  if ($CommandLine -notmatch $portPattern) { return $false }
  if ($CommandLine -match $absoluteNextPathPattern) { return $true }

  if ($CommandLine -match $relativeNextPathPattern) {
    if ($Port -ge $script:LauncherPortStart -and $Port -le $script:LauncherPortEnd) { return $true }
    if ($Port -ge $script:LauncherLegacyPortStart -and $Port -le $script:LauncherLegacyPortEnd) {
      return Test-SanmaoHealthEndpoint -Port $Port
    }
  }

  return $false
}

function Get-SanmaoOwnedServerProcesses {
  param([int[]]$Ports)

  if (-not $script:LauncherRoot) { throw 'Initialize-SanmaoLauncher must be called first.' }
  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $seen = @{}
  $result = @()

  foreach ($port in @($Ports | Sort-Object -Unique)) {
    $pids = @(Get-SanmaoOwningPidsByPort -Port $port)
    $healthy = $null
    foreach ($pidValue in $pids) {
      if ($seen.ContainsKey([int]$pidValue)) { continue }
      $seen[[int]$pidValue] = $true

      $processItem = $processes | Where-Object { [int]$_.ProcessId -eq [int]$pidValue } | Select-Object -First 1
      if (-not $processItem) { continue }

      $commandLine = [string]$processItem.CommandLine
      $owned = Test-SanmaoOwnedCommandLine -Port $port -CommandLine $commandLine
      if (-not $owned) {
        $processName = [string]$processItem.Name
        if ($processName -match '^node(\.exe)?$') {
          if ($null -eq $healthy) { $healthy = Test-SanmaoHealthEndpoint -Port $port }
          $owned = $healthy
        }
      }

      if ($owned) {
        $result += [pscustomobject]@{
          ProcessId  = [int]$pidValue
          Name       = [string]$processItem.Name
          CommandLine = $commandLine
          Port       = $port
        }
      }
    }
  }

  return @($result)
}

function Stop-SanmaoOwnedProcess {
  param(
    [Parameter(Mandatory = $true)][object]$Process,
    [int]$GraceMs = 400
  )

  $pidValue = [int]$Process.ProcessId
  try { & taskkill.exe /PID $pidValue /T 2>$null | Out-Null } catch {}
  Start-Sleep -Milliseconds $GraceMs
  try {
    Get-Process -Id $pidValue -ErrorAction Stop | Out-Null
  } catch {
    return $true
  }
  try { & taskkill.exe /PID $pidValue /T /F 2>$null | Out-Null } catch {}
  return $true
}

function Wait-SanmaoPortsReleased {
  param(
    [int[]]$Ports,
    [int]$TimeoutMs = 10000
  )

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  do {
    $listening = @(Get-SanmaoListeningPorts)
    $remaining = @($Ports | Where-Object { $listening -contains [int]$_ })
    if ($remaining.Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)

  return $false
}

function Clear-SanmaoOwnedServers {
  param([int[]]$Ports)

  $targets = @(Get-SanmaoOwnedServerProcesses -Ports $Ports)
  foreach ($target in $targets) {
    Write-SanmaoLauncherLog "清理旧服务 PID $($target.ProcessId) 端口 $($target.Port) 命令 $($target.CommandLine)" 'INFO'
    Stop-SanmaoOwnedProcess -Process $target | Out-Null
  }

  if ($targets.Count -gt 0) {
    $targetPorts = @($targets | Select-Object -ExpandProperty Port -Unique)
    return Wait-SanmaoPortsReleased -Ports $targetPorts -TimeoutMs 10000
  }
  return $true
}
