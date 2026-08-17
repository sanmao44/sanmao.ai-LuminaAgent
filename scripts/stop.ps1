param([switch]$DryRun)

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$legacyMarkerPath = Join-Path $env:TEMP 'sanmao-ai-studio-instance.lock'
$portRange = @(3000..3010) + @(3210..3220)

function Test-SanmaoHealth([int]$port) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/state" -UseBasicParsing -TimeoutSec 1
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 500) { return $false }
    $data = $response.Content | ConvertFrom-Json
    return $null -ne $data.providers -and $null -ne $data.models -and $null -ne $data.settings
  } catch {
    return $false
  }
}

function Get-NextStartPort([string]$commandLine) {
  if (-not $commandLine) { return 0 }
  if ($commandLine -notmatch '(?i)next[\\/]dist[\\/]bin[\\/]next') { return 0 }
  if ($commandLine -notmatch '(?i)(?:^|\s)start(?:\s|$)') { return 0 }
  if ($commandLine -match '(?i)(?:^|\s)(?:-p|--port)(?:\s+|=)(?<port>\d+)(?=\s|$)') {
    $port = [int]$Matches.port
    if ($portRange -contains $port) { return $port }
  }
  return 0
}

function Get-ListeningPorts {
  try {
    return @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Select-Object -ExpandProperty LocalPort -Unique)
  } catch {
    try {
      return @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Select-Object -ExpandProperty Port -Unique)
    } catch {
      return @()
    }
  }
}

$processes = @(Get-CimInstance Win32_Process)
$listeningPorts = @(Get-ListeningPorts | Where-Object { $portRange -contains [int]$_ })
$healthyPorts = @($listeningPorts | Where-Object { Test-SanmaoHealth ([int]$_) })
$targets = @()

# The launcher starts Next with a relative node_modules path. Therefore the
# project root is not always present in CommandLine. A healthy /api/state on
# the configured port is the authoritative ownership signal; the command-line
# check prevents unrelated web processes from being stopped.
foreach ($processItem in $processes) {
  $port = Get-NextStartPort ([string]$processItem.CommandLine)
  if ($port -eq 0) { continue }
  $rootPattern = [regex]::Escape($root.TrimEnd('\'))
  if ($healthyPorts.Count -eq 0 -or $healthyPorts -contains $port) {
    if ([string]$processItem.CommandLine -notmatch "(?i)$rootPattern[\\/]node_modules[\\/]next[\\/]dist[\\/]bin[\\/]next") { continue }
    $targets += $processItem
  }
}

if (-not $targets) {
  Remove-Item -LiteralPath $legacyMarkerPath -Force -ErrorAction SilentlyContinue
  Write-Host 'SANMAO.AI local service is not running.' -ForegroundColor Yellow
  exit 0
}

$targets = @($targets | Sort-Object ProcessId -Unique)
foreach ($target in $targets) {
  if ($DryRun) {
    Write-Host "Would stop PID $($target.ProcessId) on port $(Get-NextStartPort ([string]$target.CommandLine)): $([string]$target.CommandLine)"
    continue
  }

  & taskkill.exe /PID ([int]$target.ProcessId) /T /F 2>$null | Out-Null
}

Remove-Item -LiteralPath $legacyMarkerPath -Force -ErrorAction SilentlyContinue
if ($DryRun) {
  Write-Host 'Dry run complete; no process was stopped.' -ForegroundColor Yellow
} else {
  Write-Host ("SANMAO.AI local service stopped. PID(s): " + (($targets | Select-Object -ExpandProperty ProcessId) -join ', ')) -ForegroundColor Green
}
