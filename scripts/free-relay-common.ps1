function Get-SanmaoFreeRelayStateRoot {
  param([Parameter(Mandatory = $true)][string]$Root)
  return (Join-Path $Root '.data\free-relay')
}

function Stop-SanmaoFreeRelayTunnel {
  param([Parameter(Mandatory = $true)][string]$Root)

  $stateRoot = Get-SanmaoFreeRelayStateRoot -Root $Root
  $pidPath = Join-Path $stateRoot 'cloudflared.pid'
  $pidValue = 0
  try { $pidValue = [int](Get-Content -LiteralPath $pidPath -Raw -ErrorAction Stop).Trim() } catch {}

  if ($pidValue -gt 0) {
    $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -match '^cloudflared') {
      try { Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
  Remove-Item -LiteralPath (Join-Path $stateRoot 'cloudflared.pid'), (Join-Path $stateRoot 'public-url.txt') -Force -ErrorAction SilentlyContinue
}

function Get-SanmaoFreeRelayPublicUrl {
  param([Parameter(Mandatory = $true)][string]$Root)

  $urlPath = Join-Path (Get-SanmaoFreeRelayStateRoot -Root $Root) 'public-url.txt'
  try {
    $value = (Get-Content -LiteralPath $urlPath -Raw -ErrorAction Stop).Trim().TrimEnd('/')
    if ($value -match '^https://[a-z0-9-]+\.trycloudflare\.com$') { return $value }
  } catch {}
  return ''
}

function Test-SanmaoFreeRelayTunnel {
  param([Parameter(Mandatory = $true)][string]$Root)

  $stateRoot = Get-SanmaoFreeRelayStateRoot -Root $Root
  $pidPath = Join-Path $stateRoot 'cloudflared.pid'
  $urlPath = Join-Path $stateRoot 'public-url.txt'
  $pidValue = 0
  try { $pidValue = [int](Get-Content -LiteralPath $pidPath -Raw -ErrorAction Stop).Trim() } catch { return $false }
  if ($pidValue -le 0 -or -not (Test-Path -LiteralPath $urlPath)) { return $false }
  $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  return [bool]($process -and $process.ProcessName -match '^cloudflared' -and (Get-SanmaoFreeRelayPublicUrl -Root $Root))
}

function Test-SanmaoFreeRelayReachable {
  param([Parameter(Mandatory = $true)][string]$Root)

  $publicUrl = Get-SanmaoFreeRelayPublicUrl -Root $Root
  if (-not $publicUrl) { return $false }
  $response = $null
  $reader = $null
  try {
    $request = [System.Net.HttpWebRequest]::Create("$publicUrl/api/health")
    $request.Proxy = $null
    $request.Timeout = 5000
    $request.ReadWriteTimeout = 5000
    $response = $request.GetResponse()
    if ([int]$response.StatusCode -lt 200 -or [int]$response.StatusCode -ge 300) { return $false }
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [System.Text.Encoding]::UTF8)
    $content = $reader.ReadToEnd()
    return $content -match '"service"\s*:\s*"sanmao-ai-studio"' -and $content -match '"ok"\s*:\s*true'
  } catch {
    return $false
  } finally {
    if ($reader) { $reader.Dispose() }
    if ($response) { $response.Close() }
  }
}

function Get-SanmaoCloudflaredExecutable {
  param([Parameter(Mandatory = $true)][string]$Root)

  $binaryRoot = Join-Path $Root '.data\bin'
  $localPath = Join-Path $binaryRoot 'cloudflared.exe'
  if (Test-Path -LiteralPath $localPath) { return $localPath }
  $installed = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($installed) { return $installed.Source }

  New-Item -ItemType Directory -Force -Path $binaryRoot | Out-Null
  $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  $asset = if ($architecture -match 'ARM64') { 'cloudflared-windows-arm64.exe' } elseif ($architecture -match '86$|x86') { 'cloudflared-windows-386.exe' } else { 'cloudflared-windows-amd64.exe' }
  $downloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/$asset"
  $downloadUrls = @(
    "https://ghfast.top/$downloadUrl",
    $downloadUrl,
    "https://ghproxy.net/$downloadUrl"
  )
  $temporary = "$localPath.download"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  foreach ($candidate in $downloadUrls) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $candidate -OutFile $temporary -TimeoutSec 45
      if (-not (Test-Path -LiteralPath $temporary) -or (Get-Item -LiteralPath $temporary).Length -lt 1MB) { throw 'download incomplete' }
      Move-Item -LiteralPath $temporary -Destination $localPath -Force
      return $localPath
    } catch {
      Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    }
  }
  Write-Warning "免费临时通道组件下载失败；文本和普通图片功能仍可使用。($downloadUrl)"
  return $null
}

function Start-SanmaoFreeRelayTunnel {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][int]$OriginPort
  )

  Stop-SanmaoFreeRelayTunnel -Root $Root
  $stateRoot = Get-SanmaoFreeRelayStateRoot -Root $Root
  New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
  $cloudflared = Get-SanmaoCloudflaredExecutable -Root $Root
  if (-not $cloudflared) { return $null }

  $stdoutPath = Join-Path $stateRoot 'cloudflared.out.log'
  $stderrPath = Join-Path $stateRoot 'cloudflared.err.log'
  Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  # QUIC is unreliable on a number of Windows networks. HTTP/2 over TCP is a
  # little less aggressive, but keeps the quick tunnel reachable instead of
  # repeatedly returning a URL whose edge connection is dead.
  try {
    $process = Start-Process `
      -FilePath $cloudflared `
      -ArgumentList @('tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', "http://127.0.0.1:$OriginPort") `
      -WorkingDirectory $Root `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -PassThru
    Set-Content -LiteralPath (Join-Path $stateRoot 'cloudflared.pid') -Value ([string]$process.Id) -Encoding ASCII
  } catch {
    Write-Warning '免费临时通道启动失败；文本和普通图片功能仍可使用。'
    return $null
  }

  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    if ($process.HasExited) { break }
    $log = @(
      (Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue),
      (Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue)
    ) -join "`n"
    $match = [regex]::Match($log, 'https://[a-z0-9-]+\.trycloudflare\.com', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($match.Success) {
      $publicUrl = $match.Value.TrimEnd('/')
      Set-Content -LiteralPath (Join-Path $stateRoot 'public-url.txt') -Value $publicUrl -Encoding ASCII
      # cloudflared prints the quick-tunnel URL before the edge is ready. Do
      # not publish that address to the app until the public health endpoint
      # proves that the tunnel reaches the local service.
      $reachable = $false
      for ($probeAttempt = 0; $probeAttempt -lt 40; $probeAttempt++) {
        if ($process.HasExited) { break }
        if (Test-SanmaoFreeRelayReachable -Root $Root) { $reachable = $true; break }
        Start-Sleep -Milliseconds 500
      }
      if ($reachable) {
        return [pscustomobject]@{ ProcessId = $process.Id; PublicUrl = $publicUrl }
      }
      try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch {}
      Remove-Item -LiteralPath (Join-Path $stateRoot 'cloudflared.pid'), (Join-Path $stateRoot 'public-url.txt') -Force -ErrorAction SilentlyContinue
      Write-Warning '免费临时通道地址不可达；正在重新尝试。'
      return $null
    }
    Start-Sleep -Milliseconds 500
  }

  try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch {}
  Remove-Item -LiteralPath (Join-Path $stateRoot 'cloudflared.pid'), (Join-Path $stateRoot 'public-url.txt') -Force -ErrorAction SilentlyContinue
  Write-Warning '免费临时通道没有返回地址；文本和普通图片功能仍可使用。'
  return $null
}
