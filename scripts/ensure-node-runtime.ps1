param(
  [Parameter(Mandatory = $true)][string]$DataDir,
  [switch]$PrintBin
)

$ErrorActionPreference = 'Stop'
$nodeVersion = '22.13.0'

function Test-SanmaoNode([string]$NodePath) {
  if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { return $false }
  try { $versionText = (& $NodePath --version 2>$null).Trim() } catch { return $false }
  if ($versionText -notmatch '^v(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)') { return $false }
  $major = [int]$Matches.major
  $minor = [int]$Matches.minor
  return $major -gt 22 -or ($major -eq 22 -and $minor -ge 13)
}

function Test-SanmaoNpm([string]$NodeRoot) {
  # A PATH entry can expose a valid node.exe without npm (for example a
  # hand-copied portable runtime). The launcher installs dependencies with npm,
  # so treat that runtime as unusable and fall back to the complete app runtime.
  $npmPath = Join-Path $NodeRoot 'npm.cmd'
  if (-not (Test-Path -LiteralPath $npmPath -PathType Leaf)) { return $false }
  try {
    & $npmPath --version 1>$null 2>$null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Get-SanmaoArchitecture {
  $value = [string]$env:PROCESSOR_ARCHITECTURE
  if ($value -ieq 'ARM64' -or [string]$env:PROCESSOR_ARCHITEW6432 -ieq 'ARM64') { return 'arm64' }
  if ($value -ieq 'x86' -and -not [string]$env:PROCESSOR_ARCHITEW6432) { return 'x86' }
  return 'x64'
}

function Get-SanmaoNodeUrls([string]$FileName) {
  $urls = [System.Collections.Generic.List[string]]::new()
  $explicit = [string]$env:SANMAO_NODE_DOWNLOAD_URL
  if (-not [string]::IsNullOrWhiteSpace($explicit)) { [void]$urls.Add($explicit.Trim()) }
  $mirror = [string]$env:SANMAO_NODE_MIRROR_URL
  if (-not [string]::IsNullOrWhiteSpace($mirror)) { [void]$urls.Add(($mirror.TrimEnd('/') + '/' + $FileName)) }
  [void]$urls.Add(('https://nodejs.org/dist/v{0}/{1}' -f $nodeVersion, $FileName))
  [void]$urls.Add(('https://npmmirror.com/mirrors/node/v{0}/{1}' -f $nodeVersion, $FileName))
  return @($urls | Select-Object -Unique)
}

$systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
$systemNodeRoot = if ($systemNode) { Split-Path -Parent $systemNode.Source } else { '' }
if ($systemNode -and (Test-SanmaoNode $systemNode.Source) -and (Test-SanmaoNpm $systemNodeRoot)) {
  if ($PrintBin) { Write-Output (Split-Path -Parent $systemNode.Source); exit 0 }
  Write-Host "Node.js 已可用：$($systemNode.Source)"
  exit 0
}

# A stale PATH entry can point to an older system Node.js. Check the durable
# app runtime before downloading a replacement, and use that runtime whenever
# it satisfies the minimum version.

$architecture = Get-SanmaoArchitecture
$fileName = "node-v$nodeVersion-win-$architecture.zip"
$runtimeRoot = Join-Path ([System.IO.Path]::GetFullPath($DataDir)) 'runtime'
$runtimePath = Join-Path $runtimeRoot ("node-v$nodeVersion-win-$architecture")
$runtimeNode = Join-Path $runtimePath 'node.exe'
if ((Test-SanmaoNode $runtimeNode) -and (Test-SanmaoNpm $runtimePath)) {
  if ($PrintBin) { Write-Output $runtimePath }
  else { Write-Host "应用内 Node.js 已就绪：$runtimeNode" }
  exit 0
}

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$partial = Join-Path $runtimeRoot ("$fileName.partial-$PID.zip")
$extract = Join-Path $runtimeRoot (".node-extract-$PID")
$lastError = $null
try {
  foreach ($url in (Get-SanmaoNodeUrls $fileName)) {
    try {
      Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
      Write-Verbose "下载 Node.js：$url"
      Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $partial -TimeoutSec 300
      if (-not (Test-Path -LiteralPath $partial -PathType Leaf) -or (Get-Item -LiteralPath $partial).Length -lt 10MB) { throw 'Node.js 下载文件过小' }
      Expand-Archive -LiteralPath $partial -DestinationPath $extract -Force
      $candidate = Join-Path $extract ("node-v$nodeVersion-win-$architecture")
      if (-not (Test-SanmaoNode (Join-Path $candidate 'node.exe')) -or -not (Test-SanmaoNpm $candidate)) { throw 'Node.js 下载文件不完整或无法运行' }
      Remove-Item -LiteralPath $runtimePath -Recurse -Force -ErrorAction SilentlyContinue
      Move-Item -LiteralPath $candidate -Destination $runtimePath -Force
      if ($PrintBin) { Write-Output $runtimePath }
      else { Write-Host "已自动准备应用内 Node.js：$runtimeNode" }
      exit 0
    } catch {
      $lastError = $_.Exception.Message
    }
  }
} finally {
  Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
}

$message = '没有可用下载源'
if ($lastError) { $message = $lastError }
if ($PrintBin) { Write-Error ("Node.js 自动准备失败：{0}" -f $message) }
else { Write-Host ("Node.js 自动准备失败：{0}" -f $message) -ForegroundColor Yellow }
exit 1
