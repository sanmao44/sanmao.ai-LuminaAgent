$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$legacy = Join-Path (Split-Path -Parent $root) 'image_generation_records'
$target = Join-Path $root '.data\images'

if (-not (Test-Path -LiteralPath $legacy)) {
  Write-Host "旧图片目录不存在：$legacy" -ForegroundColor Yellow
  exit 0
}
New-Item -ItemType Directory -Force -Path $target | Out-Null
$sourceFiles = @(Get-ChildItem -LiteralPath $legacy -Recurse -File -Force)
foreach ($file in $sourceFiles) {
  $relative = [System.IO.Path]::GetRelativePath($legacy, $file.FullName)
  $destination = Join-Path $target $relative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
}
$targetFiles = @(Get-ChildItem -LiteralPath $target -Recurse -File -Force)
$sourceBytes = ($sourceFiles | Measure-Object Length -Sum).Sum
$targetBytes = ($targetFiles | Measure-Object Length -Sum).Sum
if ($sourceFiles.Count -ne $targetFiles.Count -or $sourceBytes -ne $targetBytes) {
  throw "迁移校验失败：源文件 $($sourceFiles.Count) 个/$sourceBytes 字节，目标文件 $($targetFiles.Count) 个/$targetBytes 字节"
}
Write-Host "迁移完成并通过数量/大小校验：$($targetFiles.Count) 个文件，$targetBytes 字节。" -ForegroundColor Green
Write-Host '旧目录未删除，请确认应用读取正常后再手动处理。' -ForegroundColor Yellow
