$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$passwordPath = Join-Path $root '.data\lan-password'
$startScript = Join-Path $PSScriptRoot 'start.ps1'
$script:FormsReady = $false

function Initialize-SanmaoLanForms {
  if ($script:FormsReady) { return }
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $script:FormsReady = $true
}

function Test-SanmaoLanPasswordFile {
  if (-not (Test-Path -LiteralPath $passwordPath)) { return $false }

  try {
    $encrypted = (Get-Content -LiteralPath $passwordPath -Raw -ErrorAction Stop).Trim()
    if (-not $encrypted) { return $false }
    $secure = ConvertTo-SecureString -String $encrypted -ErrorAction Stop
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
      return -not [string]::IsNullOrWhiteSpace($password) -and $password.Length -ge 8
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
  } catch {
    return $false
  }
}

function Save-SanmaoLanPassword([string]$password) {
  $secure = ConvertTo-SecureString -String $password -AsPlainText -Force
  $encrypted = ConvertFrom-SecureString -SecureString $secure
  $directory = Split-Path -Parent $passwordPath
  $temporaryPath = "$passwordPath.$PID.tmp"

  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  try {
    Set-Content -LiteralPath $temporaryPath -Value $encrypted -Encoding ASCII
    Move-Item -LiteralPath $temporaryPath -Destination $passwordPath -Force
  } catch {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    throw
  }
}

function Show-SanmaoLanPasswordDialog {
  Initialize-SanmaoLanForms

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'SANMAO.AI 局域网共享'
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ShowInTaskbar = $true
  $form.ClientSize = New-Object System.Drawing.Size(500, 286)

  $title = New-Object System.Windows.Forms.Label
  $title.Text = '设置局域网管理员密码'
  $title.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 14, [System.Drawing.FontStyle]::Bold)
  $title.AutoSize = $true
  $title.Location = New-Object System.Drawing.Point(24, 20)

  $description = New-Object System.Windows.Forms.Label
  $description.Text = '其他电脑将通过局域网访问同一个工作区。请设置至少 8 位密码，密码只保存在本机并以 Windows 加密密文保存。'
  $description.AutoSize = $false
  $description.Size = New-Object System.Drawing.Size(450, 52)
  $description.Location = New-Object System.Drawing.Point(24, 56)

  $passwordLabel = New-Object System.Windows.Forms.Label
  $passwordLabel.Text = '管理员密码：'
  $passwordLabel.AutoSize = $true
  $passwordLabel.Location = New-Object System.Drawing.Point(24, 126)

  $passwordBox = New-Object System.Windows.Forms.TextBox
  $passwordBox.UseSystemPasswordChar = $true
  $passwordBox.Size = New-Object System.Drawing.Size(324, 24)
  $passwordBox.Location = New-Object System.Drawing.Point(130, 121)

  $confirmLabel = New-Object System.Windows.Forms.Label
  $confirmLabel.Text = '确认密码：'
  $confirmLabel.AutoSize = $true
  $confirmLabel.Location = New-Object System.Drawing.Point(24, 164)

  $confirmBox = New-Object System.Windows.Forms.TextBox
  $confirmBox.UseSystemPasswordChar = $true
  $confirmBox.Size = New-Object System.Drawing.Size(324, 24)
  $confirmBox.Location = New-Object System.Drawing.Point(130, 159)

  $startButton = New-Object System.Windows.Forms.Button
  $startButton.Text = '启动共享'
  $startButton.Size = New-Object System.Drawing.Size(100, 30)
  $startButton.Location = New-Object System.Drawing.Point(270, 216)
  $startButton.DialogResult = [System.Windows.Forms.DialogResult]::None

  $cancelButton = New-Object System.Windows.Forms.Button
  $cancelButton.Text = '取消'
  $cancelButton.Size = New-Object System.Drawing.Size(100, 30)
  $cancelButton.Location = New-Object System.Drawing.Point(380, 216)
  $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

  $form.AcceptButton = $startButton
  $form.CancelButton = $cancelButton
  $form.Controls.AddRange(@(
    $title, $description, $passwordLabel, $passwordBox,
    $confirmLabel, $confirmBox, $startButton, $cancelButton
  ))

  $startButton.Add_Click({
    $first = $passwordBox.Text
    $second = $confirmBox.Text
    if ([string]::IsNullOrWhiteSpace($first) -or $first.Length -lt 8) {
      [System.Windows.Forms.MessageBox]::Show(
        $form,
        '管理员密码至少需要 8 位。',
        '密码不符合要求',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
      ) | Out-Null
      $passwordBox.Focus()
      return
    }
    if ($first -ne $second) {
      [System.Windows.Forms.MessageBox]::Show(
        $form,
        '两次输入的密码不一致，请重新确认。',
        '密码不一致',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
      ) | Out-Null
      $confirmBox.Focus()
      return
    }

    $form.Tag = $first
    $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Close()
  })

  $passwordBox.Focus()
  $form.ShowDialog() | Out-Null
  $result = [string]$form.Tag
  $form.Dispose()
  return $result
}

function Get-SanmaoLanServerInfo {
  $ports = @()
  if ($env:SANMAO_PORT -match '^\d+$') {
    $ports += [int]$env:SANMAO_PORT
  }
  $ports += 3210..3220

  foreach ($port in @($ports | Sort-Object -Unique)) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2
      if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) { continue }
      $data = $response.Content | ConvertFrom-Json
      if ($data.service -eq 'sanmao-ai-studio' -and $data.networkMode -eq 'lan') {
        return [pscustomobject]@{ Port = $port }
      }
    } catch {}
  }
  return $null
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

function Show-SanmaoLanAccessDialog([int]$port) {
  Initialize-SanmaoLanForms
  $addresses = @(Get-SanmaoLanAddresses)
  $urls = @($addresses | ForEach-Object { "http://$_`:$port/canvas" })
  $urlText = if ($urls.Count -gt 0) {
    $urls -join [Environment]::NewLine
  } else {
    '未检测到私有局域网 IPv4 地址，请确认主机已连接 WiFi 或网线。'
  }

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'SANMAO.AI 局域网共享'
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ShowInTaskbar = $true
  $form.ClientSize = New-Object System.Drawing.Size(560, 310)

  $title = New-Object System.Windows.Forms.Label
  $title.Text = '局域网共享已启动'
  $title.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 14, [System.Drawing.FontStyle]::Bold)
  $title.AutoSize = $true
  $title.Location = New-Object System.Drawing.Point(24, 20)

  $description = New-Object System.Windows.Forms.Label
  $description.Text = '其他电脑连接同一 WiFi 或网线网络后，打开下面的地址即可访问。主机需要保持 SANMAO.AI 运行，进入画布后输入管理员密码。'
  $description.AutoSize = $false
  $description.Size = New-Object System.Drawing.Size(510, 52)
  $description.Location = New-Object System.Drawing.Point(24, 56)

  $addressLabel = New-Object System.Windows.Forms.Label
  $addressLabel.Text = '局域网画布地址：'
  $addressLabel.AutoSize = $true
  $addressLabel.Location = New-Object System.Drawing.Point(24, 120)

  $addressBox = New-Object System.Windows.Forms.TextBox
  $addressBox.Multiline = $true
  $addressBox.ReadOnly = $true
  $addressBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
  $addressBox.Text = $urlText
  $addressBox.Size = New-Object System.Drawing.Size(510, 62)
  $addressBox.Location = New-Object System.Drawing.Point(24, 142)

  $copyButton = New-Object System.Windows.Forms.Button
  $copyButton.Text = '复制地址'
  $copyButton.Size = New-Object System.Drawing.Size(100, 30)
  $copyButton.Location = New-Object System.Drawing.Point(214, 230)
  $copyButton.Enabled = $urls.Count -gt 0

  $openButton = New-Object System.Windows.Forms.Button
  $openButton.Text = '打开本机画布'
  $openButton.Size = New-Object System.Drawing.Size(120, 30)
  $openButton.Location = New-Object System.Drawing.Point(324, 230)

  $closeButton = New-Object System.Windows.Forms.Button
  $closeButton.Text = '关闭提示'
  $closeButton.Size = New-Object System.Drawing.Size(100, 30)
  $closeButton.Location = New-Object System.Drawing.Point(454, 230)
  $closeButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

  $form.CancelButton = $closeButton
  $form.Controls.AddRange(@(
    $title, $description, $addressLabel, $addressBox,
    $copyButton, $openButton, $closeButton
  ))

  $copyButton.Add_Click({
    [System.Windows.Forms.Clipboard]::SetText($urls -join [Environment]::NewLine)
    [System.Windows.Forms.MessageBox]::Show(
      $form,
      '局域网地址已复制。',
      '复制成功',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
  })

  $openButton.Add_Click({ Start-Process "http://localhost:$port/canvas" })
  $form.ShowDialog() | Out-Null
  $form.Dispose()
}

function Show-SanmaoLanError([string]$message) {
  try {
    Initialize-SanmaoLanForms
    [System.Windows.Forms.MessageBox]::Show(
      $message,
      'SANMAO.AI 局域网共享启动失败',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  } catch {
    Write-Error $message
  }
}

try {
  $configured = $env:SANMAO_ADMIN_PASSWORD
  $hasConfiguredPassword = $configured -and $configured.Trim().Length -ge 8
  if (-not $hasConfiguredPassword -and -not (Test-SanmaoLanPasswordFile)) {
    $password = Show-SanmaoLanPasswordDialog
    if ([string]::IsNullOrWhiteSpace($password)) { exit 0 }
    Save-SanmaoLanPassword $password
  }

  $startArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -Lan -NonInteractive"
  $startProcess = Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList $startArguments `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -Wait `
    -PassThru
  if ($startProcess.ExitCode -ne 0) {
    throw "服务启动失败（退出代码 $($startProcess.ExitCode)），请查看 .data\\logs\\launcher.log。"
  }

  $server = $null
  for ($attempt = 0; $attempt -lt 15 -and -not $server; $attempt++) {
    $server = Get-SanmaoLanServerInfo
    if (-not $server) { Start-Sleep -Milliseconds 300 }
  }
  if (-not $server) {
    throw '服务已退出，但没有检测到局域网服务端口，请查看 .data\\logs\\launcher.log。'
  }

  Start-Process "http://localhost:$($server.Port)/canvas"
  Show-SanmaoLanAccessDialog $server.Port
  exit 0
} catch {
  Show-SanmaoLanError $_.Exception.Message
  exit 1
}
