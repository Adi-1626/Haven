# Regenerates the NSIS welcome/finish sidebar (164x314, 24-bit BMP) from the Haven mark.
# Usage: powershell -NoProfile -File apps/desktop/installer/make-sidebar.ps1
Add-Type -AssemblyName System.Drawing
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$mark = [System.Drawing.Image]::FromFile((Join-Path $root 'apps\web\public\haven-mark.png'))
$bitmap = New-Object System.Drawing.Bitmap 164, 314, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = 'AntiAlias'
$graphics.InterpolationMode = 'HighQualityBicubic'
$graphics.TextRenderingHint = 'AntiAliasGridFit'
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#101319'))
$graphics.DrawImage($mark, 32, 86, 100, 100)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = 'Center'
$title = New-Object System.Drawing.Font 'Segoe UI Semibold', 17
$caption = New-Object System.Drawing.Font 'Segoe UI', 8
$graphics.DrawString('Haven', $title, (New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#e1e2eb'))), (New-Object System.Drawing.RectangleF 0, 200, 164, 34), $format)
$graphics.DrawString('Community chat & screen sharing', $caption, (New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#918f9a'))), (New-Object System.Drawing.RectangleF 8, 236, 148, 32), $format)
$bitmap.Save((Join-Path $PSScriptRoot 'sidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$graphics.Dispose(); $bitmap.Dispose(); $mark.Dispose()
