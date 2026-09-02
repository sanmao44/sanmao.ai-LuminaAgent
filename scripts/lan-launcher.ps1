$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$passwordPath = Join-Path $root '.data\lan-password'
$startScript = Join-Path $PSScriptRoot 'start.ps1'
$launcherLogPath = Join-Path $root '.data\logs\launcher.log'
$script:FormsReady = $false
$script:StartingForm = $null
$script:StartingStatus = $null
$script:LanLauncherMutex = New-Object System.Threading.Mutex($false, 'SanmaoAILanLauncher')
$script:LanLauncherMutexAcquired = $false
try {
  $script:LanLauncherMutexAcquired = $script:LanLauncherMutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
  $script:LanLauncherMutexAcquired = $true
}
if (-not $script:LanLauncherMutexAcquired) { exit 0 }

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
  StartingTitle = Get-SanmaoText 'U0FOTUFPLkFJIOato+WcqOWQr+WKqA=='
  StartingPasswordDone = Get-SanmaoText '5a+G56CB5bey6K6+572u5oiQ5Yqf77yM5q2j5Zyo5ZCv5Yqo5bGA5Z+f572R5pyN5Yqh4oCm4oCm'
  StartingService = Get-SanmaoText '5q2j5Zyo5ZCv5Yqo5bGA5Z+f572R5pyN5Yqh77yM6K+356iN5YCZ4oCm4oCm'
  StartingReady = Get-SanmaoText '5pyN5Yqh5bey5ZCv5Yqo77yM5q2j5Zyo5omT5byA55S75biD4oCm4oCm'
  StartingNote = Get-SanmaoText '6aaW5qyh5ZCv5Yqo5Y+v6IO96ZyA6KaBIDEw4oCTMzAg56eS77yM6K+35LiN6KaB6YeN5aSN54K55Ye75ZCv5Yqo5Zmo44CC'
}

function Write-SanmaoLanLauncherLog([string]$message) {
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $launcherLogPath) | Out-Null
    Add-Content -LiteralPath $launcherLogPath -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff')] [LAN-LAUNCHER] $message" -Encoding UTF8
  } catch {}
}

function Use-SanmaoWindowsPowerShellModules {
  $modulePaths = @(
    (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\Modules'),
    (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules'),
    (Join-Path $env:USERPROFILE 'Documents\WindowsPowerShell\Modules')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  if ($modulePaths.Count -gt 0) { $env:PSModulePath = $modulePaths -join ';' }
}

function Initialize-SanmaoLanForms {
  if ($script:FormsReady) { return }
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $script:FormsReady = $true
}

$script:LanColors = @{
  Window = [System.Drawing.Color]::FromArgb(246, 249, 252)
  Header = [System.Drawing.Color]::FromArgb(11, 28, 50)
  HeaderMuted = [System.Drawing.Color]::FromArgb(164, 190, 211)
  Accent = [System.Drawing.Color]::FromArgb(14, 165, 183)
  AccentHover = [System.Drawing.Color]::FromArgb(9, 133, 151)
  Success = [System.Drawing.Color]::FromArgb(24, 166, 105)
  SuccessHover = [System.Drawing.Color]::FromArgb(18, 135, 84)
  Ink = [System.Drawing.Color]::FromArgb(19, 37, 61)
  Muted = [System.Drawing.Color]::FromArgb(91, 111, 133)
  Border = [System.Drawing.Color]::FromArgb(210, 221, 232)
  Track = [System.Drawing.Color]::FromArgb(225, 235, 242)
}

function Set-SanmaoLanFormStyle([System.Windows.Forms.Form]$form, [int]$width, [int]$height) {
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ShowIcon = $false
  $form.ShowInTaskbar = $true
  $form.BackColor = $script:LanColors.Window
  $form.Font = New-Object System.Drawing.Font('Segoe UI', 9)
  $form.ClientSize = New-Object System.Drawing.Size($width, $height)
}

function New-SanmaoLanHeader([int]$width, [string]$section, [string]$state, [System.Drawing.Color]$stateColor) {
  $header = New-Object System.Windows.Forms.Panel
  $header.Size = New-Object System.Drawing.Size($width, 76)
  $header.Dock = 'Top'
  $header.BackColor = $script:LanColors.Header

  $accentLine = New-Object System.Windows.Forms.Panel
  $accentLine.Dock = 'Bottom'
  $accentLine.Height = 3
  $accentLine.BackColor = $script:LanColors.Accent

  $brand = New-Object System.Windows.Forms.Label
  $brand.Text = 'SANMAO.AI'
  $brand.ForeColor = [System.Drawing.Color]::White
  $brand.Font = New-Object System.Drawing.Font('Segoe UI', 17, [System.Drawing.FontStyle]::Bold)
  $brand.AutoSize = $true
  $brand.Location = New-Object System.Drawing.Point(28, 12)

  $subtitle = New-Object System.Windows.Forms.Label
  $subtitle.Text = "LOCAL AI CREATIVE STUDIO  /  $section"
  $subtitle.ForeColor = $script:LanColors.HeaderMuted
  $subtitle.Font = New-Object System.Drawing.Font('Segoe UI', 8.5)
  $subtitle.AutoSize = $true
  $subtitle.Location = New-Object System.Drawing.Point(30, 48)

  $badge = New-Object System.Windows.Forms.Label
  $badge.Text = $state
  $badge.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
  $badge.ForeColor = [System.Drawing.Color]::White
  $badge.BackColor = $stateColor
  $badge.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
  $badge.Size = New-Object System.Drawing.Size(88, 25)
  $badge.Location = New-Object System.Drawing.Point(($width - 116), 25)

  $header.Controls.AddRange(@($accentLine, $brand, $subtitle, $badge))
  return $header
}

function Set-SanmaoLanButton([System.Windows.Forms.Button]$button, [bool]$primary) {
  $button.FlatStyle = 'Flat'
  $button.FlatAppearance.BorderSize = 0
  $button.UseVisualStyleBackColor = $false
  $button.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
  $button.Cursor = [System.Windows.Forms.Cursors]::Hand
  if ($primary) {
    $button.BackColor = $script:LanColors.Accent
    $button.ForeColor = [System.Drawing.Color]::White
    $button.FlatAppearance.MouseOverBackColor = $script:LanColors.AccentHover
    $button.FlatAppearance.MouseDownBackColor = $script:LanColors.AccentHover
  } else {
    $button.BackColor = [System.Drawing.Color]::White
    $button.ForeColor = $script:LanColors.Ink
    $button.FlatAppearance.BorderSize = 1
    $button.FlatAppearance.BorderColor = $script:LanColors.Border
    $button.FlatAppearance.MouseOverBackColor = $script:LanColors.Track
    $button.FlatAppearance.MouseDownBackColor = $script:LanColors.Border
  }
}

function Set-SanmaoLanTextBox([System.Windows.Forms.TextBox]$box) {
  $box.BackColor = [System.Drawing.Color]::White
  $box.ForeColor = $script:LanColors.Ink
  $box.BorderStyle = 'FixedSingle'
  $box.Font = New-Object System.Drawing.Font('Segoe UI', 10)
}

function Test-SanmaoLanPasswordFile {
  if (-not (Test-Path -LiteralPath $passwordPath)) { return $false }

  try {
    Use-SanmaoWindowsPowerShellModules
    Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
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
  Use-SanmaoWindowsPowerShellModules
  Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
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
  Set-SanmaoLanFormStyle $form 560 360

  $header = New-SanmaoLanHeader 560 'SECURE ACCESS' 'SETUP' $script:LanColors.Accent

  $eyebrow = New-Object System.Windows.Forms.Label
  $eyebrow.Text = 'PRIVATE NETWORK ACCESS'
  $eyebrow.ForeColor = $script:LanColors.Accent
  $eyebrow.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
  $eyebrow.AutoSize = $true
  $eyebrow.Location = New-Object System.Drawing.Point(30, 96)

  $title = New-Object System.Windows.Forms.Label
  $title.Text = $ui.PasswordTitle
  $title.ForeColor = $script:LanColors.Ink
  $title.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 15, [System.Drawing.FontStyle]::Bold)
  $title.AutoSize = $true
  $title.Location = New-Object System.Drawing.Point(30, 113)

  $description = New-Object System.Windows.Forms.Label
  $description.Text = $ui.PasswordDescription
  $description.ForeColor = $script:LanColors.Muted
  $description.AutoSize = $false
  $description.Size = New-Object System.Drawing.Size(500, 48)
  $description.Location = New-Object System.Drawing.Point(30, 145)

  $passwordLabel = New-Object System.Windows.Forms.Label
  $passwordLabel.Text = $ui.PasswordLabel
  $passwordLabel.ForeColor = $script:LanColors.Ink
  $passwordLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
  $passwordLabel.AutoSize = $true
  $passwordLabel.Location = New-Object System.Drawing.Point(30, 214)

  $passwordBox = New-Object System.Windows.Forms.TextBox
  $passwordBox.UseSystemPasswordChar = $true
  $passwordBox.Size = New-Object System.Drawing.Size(390, 26)
  $passwordBox.Location = New-Object System.Drawing.Point(140, 208)
  Set-SanmaoLanTextBox $passwordBox

  $confirmLabel = New-Object System.Windows.Forms.Label
  $confirmLabel.Text = $ui.ConfirmLabel
  $confirmLabel.ForeColor = $script:LanColors.Ink
  $confirmLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
  $confirmLabel.AutoSize = $true
  $confirmLabel.Location = New-Object System.Drawing.Point(30, 253)

  $confirmBox = New-Object System.Windows.Forms.TextBox
  $confirmBox.UseSystemPasswordChar = $true
  $confirmBox.Size = New-Object System.Drawing.Size(390, 26)
  $confirmBox.Location = New-Object System.Drawing.Point(140, 247)
  Set-SanmaoLanTextBox $confirmBox

  $startButton = New-Object System.Windows.Forms.Button
  $startButton.Text = $ui.StartButton
  $startButton.Size = New-Object System.Drawing.Size(120, 34)
  $startButton.Location = New-Object System.Drawing.Point(290, 304)
  $startButton.DialogResult = [System.Windows.Forms.DialogResult]::None
  Set-SanmaoLanButton $startButton $true

  $cancelButton = New-Object System.Windows.Forms.Button
  $cancelButton.Text = $ui.CancelButton
  $cancelButton.Size = New-Object System.Drawing.Size(100, 34)
  $cancelButton.Location = New-Object System.Drawing.Point(420, 304)
  $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  Set-SanmaoLanButton $cancelButton $false

  $form.AcceptButton = $startButton
  $form.CancelButton = $cancelButton
  $form.Controls.AddRange(@(
    $header, $eyebrow, $title, $description, $passwordLabel, $passwordBox,
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

  $passwordBox.Focus() | Out-Null
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
  try {
    $ports += @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
      Where-Object { $_.LocalPort -ge 3210 -and $_.LocalPort -le 3220 } |
      Select-Object -ExpandProperty LocalPort)
  } catch {
    $ports += 3210..3220
  }

  foreach ($port in @($ports | Sort-Object -Unique)) {
    $request = $null
    $response = $null
    $reader = $null
    try {
      $request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$port/api/health")
      $request.Proxy = $null
      $request.Timeout = 2000
      $request.ReadWriteTimeout = 2000
      $response = $request.GetResponse()
      if ([int]$response.StatusCode -lt 200 -or [int]$response.StatusCode -ge 300) { continue }
      $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [System.Text.Encoding]::UTF8)
      $data = $reader.ReadToEnd() | ConvertFrom-Json
      if ($data.service -eq 'sanmao-ai-studio' -and $data.networkMode -eq 'lan') {
        return [pscustomobject]@{ Port = $port }
      }
    } catch {} finally {
      if ($reader) { $reader.Dispose() }
      if ($response) { $response.Close() }
    }
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
  Set-SanmaoLanFormStyle $form 600 380

  $header = New-SanmaoLanHeader 600 'SECURE ACCESS' 'READY' $script:LanColors.Success

  $eyebrow = New-Object System.Windows.Forms.Label
  $eyebrow.Text = 'SHARE WITH YOUR LOCAL NETWORK'
  $eyebrow.ForeColor = $script:LanColors.Success
  $eyebrow.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
  $eyebrow.AutoSize = $true
  $eyebrow.Location = New-Object System.Drawing.Point(30, 96)

  $title = New-Object System.Windows.Forms.Label
  $title.Text = $ui.ReadyTitle
  $title.ForeColor = $script:LanColors.Ink
  $title.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 15, [System.Drawing.FontStyle]::Bold)
  $title.AutoSize = $true
  $title.Location = New-Object System.Drawing.Point(30, 113)

  $description = New-Object System.Windows.Forms.Label
  $description.Text = $ui.ReadyDescription
  $description.ForeColor = $script:LanColors.Muted
  $description.AutoSize = $false
  $description.Size = New-Object System.Drawing.Size(540, 60)
  $description.Location = New-Object System.Drawing.Point(30, 145)

  $addressLabel = New-Object System.Windows.Forms.Label
  $addressLabel.Text = $ui.AddressLabel
  $addressLabel.ForeColor = $script:LanColors.Ink
  $addressLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9, [System.Drawing.FontStyle]::Bold)
  $addressLabel.AutoSize = $true
  $addressLabel.Location = New-Object System.Drawing.Point(30, 216)

  $addressBox = New-Object System.Windows.Forms.TextBox
  $addressBox.Multiline = $true
  $addressBox.ReadOnly = $true
  $addressBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
  $addressBox.Text = $urlText
  $addressBox.Size = New-Object System.Drawing.Size(540, 62)
  $addressBox.Location = New-Object System.Drawing.Point(30, 239)
  Set-SanmaoLanTextBox $addressBox

  $copyButton = New-Object System.Windows.Forms.Button
  $copyButton.Text = $ui.CopyButton
  $copyButton.Size = New-Object System.Drawing.Size(110, 34)
  $copyButton.Location = New-Object System.Drawing.Point(240, 326)
  $copyButton.Enabled = $urls.Count -gt 0
  Set-SanmaoLanButton $copyButton $false

  $openButton = New-Object System.Windows.Forms.Button
  $openButton.Text = $ui.OpenButton
  $openButton.Size = New-Object System.Drawing.Size(130, 34)
  $openButton.Location = New-Object System.Drawing.Point(360, 326)
  Set-SanmaoLanButton $openButton $true

  $closeButton = New-Object System.Windows.Forms.Button
  $closeButton.Text = $ui.CloseButton
  $closeButton.Size = New-Object System.Drawing.Size(100, 34)
  $closeButton.Location = New-Object System.Drawing.Point(500, 326)
  $closeButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  Set-SanmaoLanButton $closeButton $false

  $form.CancelButton = $closeButton
  $form.Controls.AddRange(@(
    $header, $eyebrow, $title, $description, $addressLabel, $addressBox,
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

function Show-SanmaoLanStartingForm([string]$message) {
  Initialize-SanmaoLanForms

  $form = New-Object System.Windows.Forms.Form
  $form.Text = $ui.WindowTitle
  Set-SanmaoLanFormStyle $form 560 260
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ControlBox = $false

  $header = New-SanmaoLanHeader 560 'LOCAL SERVICE' 'STARTING' $script:LanColors.Accent

  $eyebrow = New-Object System.Windows.Forms.Label
  $eyebrow.Text = 'LOCAL NETWORK SERVICE'
  $eyebrow.ForeColor = $script:LanColors.Accent
  $eyebrow.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
  $eyebrow.AutoSize = $true
  $eyebrow.Location = New-Object System.Drawing.Point(30, 96)

  $title = New-Object System.Windows.Forms.Label
  $title.Text = $ui.StartingTitle
  $title.ForeColor = $script:LanColors.Ink
  $title.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 16, [System.Drawing.FontStyle]::Bold)
  $title.AutoSize = $true
  $title.Location = New-Object System.Drawing.Point(30, 113)

  $status = New-Object System.Windows.Forms.Label
  $status.Text = $message
  $status.ForeColor = $script:LanColors.Muted
  $status.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
  $status.AutoSize = $false
  $status.Size = New-Object System.Drawing.Size(500, 28)
  $status.Location = New-Object System.Drawing.Point(30, 148)

  $progressTrack = New-Object System.Windows.Forms.Panel
  $progressTrack.BackColor = $script:LanColors.Track
  $progressTrack.Size = New-Object System.Drawing.Size(500, 10)
  $progressTrack.Location = New-Object System.Drawing.Point(30, 185)

  $progressFill = New-Object System.Windows.Forms.Panel
  $progressFill.BackColor = $script:LanColors.Accent
  $progressFill.Size = New-Object System.Drawing.Size(150, 10)
  $progressFill.Location = New-Object System.Drawing.Point(-150, 0)
  $progressTrack.Controls.Add($progressFill)

  $note = New-Object System.Windows.Forms.Label
  $note.Text = $ui.StartingNote
  $note.ForeColor = $script:LanColors.Muted
  $note.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 8.5)
  $note.AutoSize = $false
  $note.Size = New-Object System.Drawing.Size(500, 24)
  $note.Location = New-Object System.Drawing.Point(30, 211)

  $form.Controls.AddRange(@($header, $eyebrow, $title, $status, $progressTrack, $note))
  $script:StartingProgressTrack = $progressTrack
  $script:StartingProgressFill = $progressFill
  $script:StartingProgressOffset = -150
  $script:StartingProgressTimer = New-Object System.Windows.Forms.Timer
  $script:StartingProgressTimer.Interval = 18
  $script:StartingProgressTimer.Add_Tick({
    if (-not $script:StartingProgressFill -or -not $script:StartingProgressTrack) { return }
    $script:StartingProgressOffset += 7
    if ($script:StartingProgressOffset -gt $script:StartingProgressTrack.Width) {
      $script:StartingProgressOffset = -$script:StartingProgressFill.Width
    }
    $script:StartingProgressFill.Left = $script:StartingProgressOffset
  })
  $script:StartingProgressTimer.Start()
  $script:StartingForm = $form
  $script:StartingStatus = $status
  $form.Show()
  [System.Windows.Forms.Application]::DoEvents()
}

function Update-SanmaoLanStartingForm([string]$message) {
  if ($script:StartingStatus) { $script:StartingStatus.Text = $message }
  if ($message -eq $ui.StartingReady -and $script:StartingProgressTimer) {
    $script:StartingProgressTimer.Stop()
    if ($script:StartingProgressFill -and $script:StartingProgressTrack) {
      $script:StartingProgressFill.Left = 0
      $script:StartingProgressFill.Width = $script:StartingProgressTrack.Width
      $script:StartingProgressFill.BackColor = $script:LanColors.Success
    }
  }
  if ($script:StartingForm) { [System.Windows.Forms.Application]::DoEvents() }
}

function Close-SanmaoLanStartingForm {
  if ($script:StartingProgressTimer) {
    try { $script:StartingProgressTimer.Stop() } catch {}
    try { $script:StartingProgressTimer.Dispose() } catch {}
    $script:StartingProgressTimer = $null
  }
  if ($script:StartingForm) {
    try { $script:StartingForm.Close() } catch {}
    try { $script:StartingForm.Dispose() } catch {}
    $script:StartingForm = $null
    $script:StartingStatus = $null
  }
  $script:StartingProgressTrack = $null
  $script:StartingProgressFill = $null
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
  $passwordResetRequested = $false
  Write-SanmaoLanLauncherLog "Password ciphertext file available: $passwordFileValid."
  if (-not $hasConfiguredPassword -and -not $passwordFileValid) {
    $password = Show-SanmaoLanPasswordDialog
    if ([string]::IsNullOrWhiteSpace($password)) { exit 0 }
    Save-SanmaoLanPassword $password
    $env:SANMAO_ADMIN_PASSWORD = $password
    $passwordResetRequested = $true
    Write-SanmaoLanLauncherLog $ui.LogPasswordSaved
  }

  $startingMessage = if ($passwordResetRequested) { $ui.StartingPasswordDone } else { $ui.StartingService }
  Show-SanmaoLanStartingForm $startingMessage
  $startArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $startScript, '-Lan', '-FreeRelay', '-NonInteractive')
  if ($passwordResetRequested) { $startArguments += '-ForceRestart' }
  Write-SanmaoLanLauncherLog $ui.LogStarting
  Use-SanmaoWindowsPowerShellModules
  $startProcess = Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList $startArguments `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -PassThru
  # Do not use Start-Process -Wait here. Windows PowerShell can wait for the
  # long-running Node descendant created by start.ps1, which prevents this
  # launcher from reaching the browser-open step on the first click.
  $startDeadline = [DateTime]::UtcNow.AddMinutes(15)
  $server = $null
  while (-not $server -and [DateTime]::UtcNow -lt $startDeadline) {
    Start-Sleep -Milliseconds 250
    $startProcess.Refresh()
    $server = Get-SanmaoLanServerInfo
    if (-not $server) { Update-SanmaoLanStartingForm $ui.StartingService }
  }
  # Open the canvas as soon as the health endpoint responds. The launcher
  # script may still be finishing cleanup, but the service is already usable.
  if (-not $server) {
    $startProcess.Refresh()
    if ($startProcess.HasExited -and $startProcess.ExitCode -ne 0) {
      throw ($ui.StartFailed -f $startProcess.ExitCode)
    }
    throw $ui.ServerNotFound
  }

  Update-SanmaoLanStartingForm $ui.StartingReady
  $openUrl = "http://localhost:$($server.Port)/canvas"
  Start-Process $openUrl | Out-Null
  Write-SanmaoLanLauncherLog "Opened LAN canvas: $openUrl."
  Write-SanmaoLanLauncherLog ($ui.LogReady -f $server.Port)
  Close-SanmaoLanStartingForm
  Show-SanmaoLanAccessDialog $server.Port
  exit 0
} catch {
  Close-SanmaoLanStartingForm
  $message = $_.Exception.Message
  Write-SanmaoLanLauncherLog ($ui.LogFailed -f $message)
  Show-SanmaoLanError $message
  exit 1
} finally {
  if ($script:LanLauncherMutexAcquired -and $script:LanLauncherMutex) {
    try { $script:LanLauncherMutex.ReleaseMutex() } catch {}
    try { $script:LanLauncherMutex.Dispose() } catch {}
  }
}
