param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$iconRoot = Join-Path $root 'assets\launcher-icons'
$launchPrefix = -join ([char[]](0x542f, 0x52a8))
$lanMode = -join ([char[]](0x5c40, 0x57df, 0x7f51, 0x5171, 0x4eab))
$localTarget = "$launchPrefix SANMAO.AI - Windows.cmd"
$lanTarget = "$launchPrefix SANMAO.AI - $lanMode.cmd"
$localShortcut = "$launchPrefix SANMAO.AI - Windows.lnk"
$lanShortcut = "$launchPrefix SANMAO.AI - $lanMode.lnk"

$shortcuts = @(
  [pscustomobject]@{
    Name = $localShortcut
    Target = $localTarget
    Icon = 'sanmao-windows-blue.ico'
    Description = 'SANMAO.AI local launcher (blue)'
  },
  [pscustomobject]@{
    Name = $lanShortcut
    Target = $lanTarget
    Icon = 'sanmao-lan-green.ico'
    Description = 'SANMAO.AI LAN launcher (green)'
  }
)

try {
  foreach ($item in $shortcuts) {
    $targetPath = Join-Path $root $item.Target
    $iconPath = Join-Path $iconRoot $item.Icon
    if (-not (Test-Path -LiteralPath $targetPath)) { throw "Launcher target not found: $targetPath" }
    if (-not (Test-Path -LiteralPath $iconPath)) { throw "Launcher icon not found: $iconPath" }

    $shortcutPath = Join-Path $root $item.Name
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $targetPath
    $shortcut.WorkingDirectory = $root
    $shortcut.IconLocation = "$iconPath,0"
    $shortcut.Description = $item.Description
    $shortcut.Save()
  }

  if (-not $Quiet) {
    Write-Host 'SANMAO.AI launcher shortcuts created.' -ForegroundColor Green
  }
  exit 0
} catch {
  if (-not $Quiet) {
    Write-Host "Launcher shortcut creation failed: $($_.Exception.Message)" -ForegroundColor Yellow
  }
  exit 1
}
