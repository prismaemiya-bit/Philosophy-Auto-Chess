param(
  [string]$OutputRoot = (Join-Path $PSScriptRoot "..\public")
)

Add-Type -AssemblyName System.Drawing

function New-PwaIcon {
  param([int]$Size, [string]$Path)
  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#071014"))

  $scale = $Size / 512.0
  $cyan = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#65b9b6")), ([float](18 * $scale))
  $cyan.StartCap = $cyan.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $gold = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#e7c875")), ([float](18 * $scale))
  $innerGold = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#d5b45e")), ([float](9 * $scale))
  $darkBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#102a2e"))
  $goldBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#d5b45e"))

  foreach ($y in @(168, 256, 344)) {
    $graphics.DrawLine($cyan, [float](68 * $scale), [float]($y * $scale), [float](190 * $scale), [float]($y * $scale))
    $graphics.DrawLine($cyan, [float](190 * $scale), [float]($y * $scale), [float](256 * $scale), [float](256 * $scale))
  }

  $outer = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new([float](256 * $scale), [float](84 * $scale)),
    [System.Drawing.PointF]::new([float](428 * $scale), [float](256 * $scale)),
    [System.Drawing.PointF]::new([float](256 * $scale), [float](428 * $scale)),
    [System.Drawing.PointF]::new([float](84 * $scale), [float](256 * $scale))
  )
  $inner = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new([float](256 * $scale), [float](151 * $scale)),
    [System.Drawing.PointF]::new([float](361 * $scale), [float](256 * $scale)),
    [System.Drawing.PointF]::new([float](256 * $scale), [float](361 * $scale)),
    [System.Drawing.PointF]::new([float](151 * $scale), [float](256 * $scale))
  )
  $graphics.FillPolygon($darkBrush, $outer)
  $graphics.DrawPolygon($gold, $outer)
  $graphics.DrawPolygon($innerGold, $inner)
  $graphics.FillEllipse($goldBrush, [float](218 * $scale), [float](218 * $scale), [float](76 * $scale), [float](76 * $scale))

  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $cyan.Dispose()
  $gold.Dispose()
  $innerGold.Dispose()
  $darkBrush.Dispose()
  $goldBrush.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

$resolvedRoot = [IO.Path]::GetFullPath($OutputRoot)
New-PwaIcon -Size 192 -Path (Join-Path $resolvedRoot "pwa-icon-192.png")
New-PwaIcon -Size 512 -Path (Join-Path $resolvedRoot "pwa-icon-512.png")
