$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Resolve-ProjectPath {
  param([Parameter(Mandatory)][string]$RelativePath)

  $fullPath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $RelativePath))
  $projectPrefix = $projectRoot + [System.IO.Path]::DirectorySeparatorChar
  if (-not $fullPath.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path escaped project root: $fullPath"
  }
  return $fullPath
}

function Save-Jpeg {
  param(
    [Parameter(Mandatory)][string]$SourceRelativePath,
    [Parameter(Mandatory)][string]$TargetRelativePath,
    [long]$Quality = 88
  )

  $sourcePath = Resolve-ProjectPath $SourceRelativePath
  $targetPath = Resolve-ProjectPath $TargetRelativePath
  if (-not (Test-Path -LiteralPath $sourcePath)) { return }

  $image = [System.Drawing.Image]::FromFile($sourcePath)
  try {
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
      Where-Object MimeType -eq 'image/jpeg'
    $parameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
    try {
      $parameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new(
        [System.Drawing.Imaging.Encoder]::Quality,
        $Quality
      )
      $image.Save($targetPath, $codec, $parameters)
    } finally {
      $parameters.Dispose()
    }
  } finally {
    $image.Dispose()
  }
}

function Resize-Png {
  param(
    [Parameter(Mandatory)][string]$RelativePath,
    [Parameter(Mandatory)][int]$MaxSide
  )

  $sourcePath = Resolve-ProjectPath $RelativePath
  if (-not (Test-Path -LiteralPath $sourcePath)) { return }

  $image = [System.Drawing.Image]::FromFile($sourcePath)
  try {
    if ([Math]::Max($image.Width, $image.Height) -le $MaxSide) { return }
    $scale = $MaxSide / [Math]::Max($image.Width, $image.Height)
    $width = [Math]::Max(1, [int][Math]::Round($image.Width * $scale))
    $height = [Math]::Max(1, [int][Math]::Round($image.Height * $scale))
    $temporaryPath = "$sourcePath.optimized.png"
    $bitmap = [System.Drawing.Bitmap]::new(
      $width,
      $height,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )

    try {
      $bitmap.SetResolution(96, 96)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($image, 0, 0, $width, $height)
      } finally {
        $graphics.Dispose()
      }
      $bitmap.Save($temporaryPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $bitmap.Dispose()
    }
  } finally {
    $image.Dispose()
  }

  Move-Item -LiteralPath $temporaryPath -Destination $sourcePath -Force
}

$backgroundNames = @(
  'champions-lobby-bg',
  'battle-fields/neutral-stadium',
  'battle-fields/grassy-stadium',
  'battle-fields/electric-stadium',
  'battle-fields/psychic-stadium',
  'battle-fields/misty-stadium'
)

foreach ($name in $backgroundNames) {
  Save-Jpeg "public/assets/$name.png" "public/assets/$name.jpg"
}

Resize-Png 'public/assets/brand/champions-arena-emblem.png' 320

foreach ($name in @('player-female-gen5.png', 'player-male-gen5.png', 'striaton-trio-gen5.png')) {
  Resize-Png "public/assets/trainers/generated/$name" 512
}

$eggDirectory = Resolve-ProjectPath 'public/assets/draw/eggs'
Get-ChildItem -LiteralPath $eggDirectory -File -Filter '*.png' | ForEach-Object {
  Resize-Png ($_.FullName.Substring($projectRoot.Length + 1)) 640
}

foreach ($name in $backgroundNames) {
  $oldPath = Resolve-ProjectPath "public/assets/$name.png"
  if (Test-Path -LiteralPath $oldPath) {
    Remove-Item -LiteralPath $oldPath -Force
  }
}

$unusedSpriteDirectory = Resolve-ProjectPath 'public/assets/pokemon/sprites'
if (Test-Path -LiteralPath $unusedSpriteDirectory) {
  Remove-Item -LiteralPath $unusedSpriteDirectory -Recurse -Force
}

$unusedMegaStoneImages = @(
  'absolite-z.png',
  'baxcalibrite.png',
  'darkranite.png',
  'garchompite-z.png',
  'golisopite.png',
  'heatranite.png',
  'lucarionite-z.png',
  'magearnite.png',
  'tatsugirinite.png',
  'zeraorite.png',
  'zygardite.png'
)

foreach ($name in $unusedMegaStoneImages) {
  $unusedPath = Resolve-ProjectPath "public/assets/items/za-mega-stones/$name"
  if (Test-Path -LiteralPath $unusedPath) {
    Remove-Item -LiteralPath $unusedPath -Force
  }
}

$assetFiles = Get-ChildItem -LiteralPath (Resolve-ProjectPath 'public/assets') -File -Recurse
$assetBytes = ($assetFiles | Measure-Object Length -Sum).Sum
Write-Output ('Optimized runtime assets: {0} files, {1:N2} MB' -f $assetFiles.Count, ($assetBytes / 1MB))
