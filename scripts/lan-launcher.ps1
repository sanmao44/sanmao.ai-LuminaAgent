$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$passwordPath = Join-Path $root '.data\lan-password'
$startScript = Join-Path $PSScriptRoot 'start.ps1'
$launcherLogPath = Join-Path $root '.data\logs\launcher.log'
$script:FormsReady = $false

function Get-SanmaoText([string]$base64) {
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($base64))
}

$ui = @{
  WindowTitle = Get-SanmaoText 'U0FOTUFPLkFJIOWxgOWfn+e9keWFseS6qw=='
  PasswordTitle = Get-SanmaoText '6K6+572u5bGA5Z+f572R566h55CG5ZGY5a+G56CB'
  PasswordDescription = Get-SanmaoText '5YW25LuW55S16ISR5bCG6YCa6L+H5bGA5Z+f572R6K6/6Zeu5ZCM5LiA5Liq5bel5L2c5Yy644CC6K+36K6+572u6Iez5bCRIDgg5L2N5a+G56CB77yM5a+G56CB5Y+q5L+d5a2Y5Zyo5pys5py65bm25LulIFdpbmRvd3Mg5Yqg5a+G5a+G5paH5L+d5a2Y44CC'
  PasswordLabel = Get-SanmaoText '566h55CG5ZGY5a+G56CB77ya'
  ConfirmLabel = Get-SanmaoText '56Gu6K6k5a+G56CB77ya'
  StartButton = Get-SanmaoText '5ZCv5Yqo5YWx5Lqr'
  CancelButton = Get-SanmaoText '5Y+W5raI'
  ShortPassword = Get-SanmaoText '566h55CG5ZGY5a+G56CB6Iez5bCR6ZyA6KaBIDgg5L2N44CC'
  InvalidPasswordTitle = Get-SanmaoText '5a+G56CB5LiN56ym5ZCI6KaB5rGC'
  PasswordMismatch = Get-SanmaoText '5Lik5qyh6L6T5YWl55qE5a+G56CB5LiN5LiA6Ie077yM6K+36YeN5paw56Gu6K6k44CC'
  PasswordMismatchTitle = Get-SanmaoText '5a+G56CB5LiN5LiA6Ie0'
  NoAddress = Get-SanmaoText '5pyq5qOA5rWL5Yiw56eB5pyJ5bGA5Z+f572RIElQdjQg5Zyw5Z2A77yM6K+356Gu6K6k5Li75py65bey6L+e5o6lIFdpRmkg5oiW572R57q/44CC'
  ReadyTitle = Get-SanmaoText '5bGA5Z+f572R5YWx5Lqr5bey5ZCv5Yqo'
  ReadyDescription = Get-SanmaoText '5YW25LuW55S16ISR6L+e5o6l5ZCM5LiAIFdpRmkg5oiW572R57q/572R57uc5ZCO77yM5omT5byA5LiL6Z2i55qE5Zyw5Z2A5Y2z5Y+v6K6/6Zeu44CC5Li75py66ZyA6KaB5L+d5oyBIFNBTk1BTy5BSSDov5DooYzvvIzov5vlhaXnlLvluIPlkI7ovpPlhaXnrqHnkIblkZjlr4bnoIHjgII='
  AddressLabel = Get-SanmaoText '5bGA5Z+f572R55S75biD5Zyw5Z2A77ya'
  CopyButton = Get-SanmaoText '5aSN5Yi25Zyw5Z2A'
  OpenButton = Get-SanmaoText '5omT5byA5pys5py655S75biD'
  CloseButton = Get-SanmaoText '5YWz6Zet5o+Q56S6'
  CopiedMessage = Get-SanmaoText '5bGA5Z+f572R5Zyw5Z2A5bey5aSN5Yi244CC'
  CopiedTitle = Get-SanmaoText '5aSN5Yi25oiQ5Yqf'
  ErrorTitle = Get-SanmaoText 'U0FOTUFPLkFJIOWxgOWfn+e9keWFseS6q+WQr+WKqOWksei0pQ=='
  LogStarted = Get-SanmaoText '5Zu+5b2i5bGA5Z+f572R5ZCv5Yqo5YWl5Y+j5byA5aeL6L+Q6KGM44CC'
  LogPasswordSaved = Get-SanmaoText '5bey6YCa6L+H5Zu+5b2i5o+Q56S65L+d5a2Y5bGA5Z+f572R566h55CG5ZGY5a+G56CB5a+G5paH44CC'
  LogStarting = Get-SanmaoText '5q2j5Zyo5Lul6Z2e5Lqk5LqS5pa55byP5ZCv5Yqo5bGA5Z+f572R5pyN5Yqh6ISa5pys44CC'
  StartFailed = Get-SanmaoText '5pyN5Yqh5ZCv5Yqo5aSx6LSl77yI6YCA5Ye65Luj56CBIHswfe+8ie+8jOivt+afpeeciyAuZGF0YVxcbG9nc1xcbGF1bmNoZXIubG9n44CC'
  ServerNotFound = Get-SanmaoText '5pyN5Yqh5bey6YCA5Ye677yM5L2G5rKh5pyJ5qOA5rWL5Yiw5bGA5Z+f572R5pyN5Yqh56uv5Y+j77yM6K+35p+l55yLIC5kYXRhXFxsb2dzXFxsYXVuY2hlci5sb2fjgII='
  LogReady = Get-SanmaoText '5bGA5Z+f572R5pyN5Yqh5bey5bCx57uq77yM56uv5Y+j77yaezB944CC'
  LogFailed = Get-SanmaoText '5Zu+5b2i5bGA5Z+f572R5ZCv5Yqo5YWl5Y+j5aSx6LSl77yaezB9'
}

function Write-SanmaoLanLauncherLog([string]$message) {
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $launcherLogPath) | Out-Null
    Add-Content -LiteralPath $launcherLogPath -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff')] [LAN-LAUNCHER] $message" -Encoding UTF8
  } catch {}
}

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
  $form.Text = $ui.WindowTitle
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ShowInTaskbar = $true
  $form.ClientSize = New-Object System.Drawing.Size(500, 286)

  $title = New-Object System.Windows.Forms.Label
  $title.Text = $ui.PasswordTitle
  $title.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 14, [System.Drawing.FontStyle]::Bold)
  $title.AutoSize = $true
  $title.Location = New-Object System.Drawing.Point(24, 20)

  $description = New-Object System.Windows.Forms.Label
  $description.Text = $ui.PasswordDescription
  $description.AutoSize = $false
  $description.Size = New-Object System.Drawing.Size(450, 52)
  $description.Location = New-Object System.Drawing.Point(24, 56)

  $passwordLabel = New-Object System.Windows.Forms.Label
  $passwordLabel.Text = $ui.PasswordLabel
  $passwordLabel.AutoSize = $true
  $passwordLabel.Location = New-Object System.Drawing.Point(24, 126)

  $passwordBox = New-Object System.Windows.Forms.TextBox
  $passwordBox.UseSystemPasswordChar = $true
  $passwordBox.Size = New-Object System.Drawing.Size(324, 24)
  $passwordBox.Location = New-Object System.Drawing.Point(130, 121)

  $confirmLabel = New-Object System.Windows.Forms.Label
  $confirmLabel.Text = $ui.ConfirmLabel
  $confirmLabel.AutoSize = $true
  $confirmLabel.Location = New-Object System.Drawing.Point(24, 164)

  $confirmBox = New-Object System.Windows.Forms.TextBox
  $confirmBox.UseSystemPasswordChar = $true
  $confirmBox.Size = New-Object System.Drawing.Size(324, 24)
  $confirmBox.Location = New-Object System.Drawing.Point(130, 159)

  $startButton = New-Object System.Windows.Forms.Button
  $startButton.Text = $ui.StartButton
  $startButton.Size = New-Object System.Drawing.Size(100, 30)
  $startButton.Location = New-Object System.Drawing.Point(270, 216)
  $startButton.DialogResult = [System.Windows.Forms.DialogResult]::None

  $cancelButton = New-Object System.Windows.Forms.Button
  $cancelButton.Text = $ui.CancelButton
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
        $ui.ShortPassword,
        $ui.InvalidPasswordTitle,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
      ) | Out-Null
      $passwordBox.Focus()
      return
    }
    if ($first -ne $second) {
      [System.Windows.Forms.MessageBox]::Show(
        $form,
        $ui.PasswordMismatch,
        $ui.PasswordMismatchTitle,
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
    $ui.NoAddress
  }

  $form = New-Object System.Windows.Forms.Form
  $form.Text = $ui.WindowTitle
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ShowInTaskbar = $true
  $form.ClientSize = New-Object System.Drawing.Size(560, 310)

  $title = New-Object System.Windows.Forms.Label
  $title.Text = $ui.ReadyTitle
  $title.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 14, [System.Drawing.FontStyle]::Bold)
  $title.AutoSize = $true
  $title.Location = New-Object System.Drawing.Point(24, 20)

  $description = New-Object System.Windows.Forms.Label
  $description.Text = $ui.ReadyDescription
  $description.AutoSize = $false
  $description.Size = New-Object System.Drawing.Size(510, 52)
  $description.Location = New-Object System.Drawing.Point(24, 56)

  $addressLabel = New-Object System.Windows.Forms.Label
  $addressLabel.Text = $ui.AddressLabel
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
  $copyButton.Text = $ui.CopyButton
  $copyButton.Size = New-Object System.Drawing.Size(100, 30)
  $copyButton.Location = New-Object System.Drawing.Point(214, 230)
  $copyButton.Enabled = $urls.Count -gt 0

  $openButton = New-Object System.Windows.Forms.Button
  $openButton.Text = $ui.OpenButton
  $openButton.Size = New-Object System.Drawing.Size(120, 30)
  $openButton.Location = New-Object System.Drawing.Point(324, 230)

  $closeButton = New-Object System.Windows.Forms.Button
  $closeButton.Text = $ui.CloseButton
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
      $ui.CopiedMessage,
      $ui.CopiedTitle,
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
      $ui.ErrorTitle,
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  } catch {
    Write-Error $message
  }
}

try {
  Write-SanmaoLanLauncherLog $ui.LogStarted
  $configured = $env:SANMAO_ADMIN_PASSWORD
  $hasConfiguredPassword = $configured -and $configured.Trim().Length -ge 8
  $passwordFileValid = Test-SanmaoLanPasswordFile
  Write-SanmaoLanLauncherLog "密码文件存在：$([bool](Test-Path -LiteralPath $passwordPath))，可解密：$passwordFileValid。"
  if (-not $hasConfiguredPassword -and -not $passwordFileValid) {
    $password = Show-SanmaoLanPasswordDialog
    if ([string]::IsNullOrWhiteSpace($password)) { exit 0 }
    Save-SanmaoLanPassword $password
    Write-SanmaoLanLauncherLog $ui.LogPasswordSaved
  }

  $startArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -Lan -NonInteractive"
  Write-SanmaoLanLauncherLog $ui.LogStarting
  $startProcess = Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList $startArguments `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -Wait `
    -PassThru
  if ($startProcess.ExitCode -ne 0) {
    throw ($ui.StartFailed -f $startProcess.ExitCode)
  }

  $server = $null
  for ($attempt = 0; $attempt -lt 15 -and -not $server; $attempt++) {
    $server = Get-SanmaoLanServerInfo
    if (-not $server) { Start-Sleep -Milliseconds 300 }
  }
  if (-not $server) {
    throw $ui.ServerNotFound
  }

  Start-Process "http://localhost:$($server.Port)/canvas"
  Write-SanmaoLanLauncherLog ($ui.LogReady -f $server.Port)
  Show-SanmaoLanAccessDialog $server.Port
  exit 0
} catch {
  $message = $_.Exception.Message
  Write-SanmaoLanLauncherLog ($ui.LogFailed -f $message)
  Show-SanmaoLanError $message
  exit 1
}
