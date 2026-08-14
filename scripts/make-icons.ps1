# Sinh bộ icon của app từ một định nghĩa duy nhất trong file này.
#
# Đổi thương hiệu = sửa $Letter và hai màu gradient rồi chạy lại:
#   powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1
#
# Kết quả trong resources\:
#   icon.ico      — icon app và installer (nhiều kích thước trong một file)
#   tray.png      — icon khay hệ thống ở 100% DPI
#   tray@2x.png   — bản 200% DPI, Electron tự chọn theo màn hình

param(
  [string]$Letter = 'H',
  [string]$ColorFrom = '#4F6BED',
  [string]$ColorTo = '#7A5CF0'
)

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'resources'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-Glyph([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'

  # Bo góc theo tỉ lệ, để icon 16px và 256px trông cùng một hình.
  $radius = [Math]::Max(2, [int]($size * 0.22))
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($size - $d, 0, $d, $d, 270, 90)
  $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $path.AddArc(0, $size - $d, $d, $d, 90, 90)
  $path.CloseFigure()

  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.ColorTranslator]::FromHtml($ColorFrom),
    [System.Drawing.ColorTranslator]::FromHtml($ColorTo),
    [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
  $g.FillPath($brush, $path)

  $font = New-Object System.Drawing.Font('Segoe UI', ($size * 0.56), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = 'Center'
  $format.LineAlignment = 'Center'
  # Nhích lên chút vì chiều cao dòng của Segoe UI lệch xuống dưới tâm ô.
  $textRect = New-Object System.Drawing.RectangleF 0, (-$size * 0.04), $size, $size
  $g.DrawString($Letter, $font, [System.Drawing.Brushes]::White, $textRect, $format)

  $g.Dispose(); $brush.Dispose(); $font.Dispose(); $path.Dispose()
  return $bmp
}

function Get-PngBytes($bmp) {
  $stream = New-Object System.IO.MemoryStream
  $bmp.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  # Dấu phẩy đầu dòng gói mảng lại: không có nó PowerShell bung byte[] ra
  # pipeline và người gọi nhận về Object[], khiến BinaryWriter chọn nhầm nạp
  # chồng và chỉ ghi một byte.
  return ,$stream.ToArray()
}

# Tray: PNG rời, Electron chọn bản theo DPI màn hình.
foreach ($pair in @(@{ size = 16; name = 'tray.png' }, @{ size = 32; name = 'tray@2x.png' })) {
  $bmp = New-Glyph $pair.size
  $bmp.Save((Join-Path $outDir $pair.name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# ICO: một container gói nhiều kích thước. Từ Windows Vista, mỗi mục trong
# container được phép là dữ liệu PNG nguyên khối thay vì bitmap thô, nên chỉ
# cần ghép header + bảng mục + các khối PNG.
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = foreach ($size in $sizes) {
  $bmp = New-Glyph $size
  $bytes = Get-PngBytes $bmp
  $bmp.Dispose()
  [pscustomobject]@{ Size = $size; Bytes = $bytes }
}

$ico = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter $ico
$writer.Write([uint16]0)                 # reserved
$writer.Write([uint16]1)                 # type: icon
$writer.Write([uint16]$images.Count)

# Dữ liệu ảnh nằm ngay sau header 6 byte và bảng mục 16 byte mỗi dòng.
$offset = 6 + 16 * $images.Count
foreach ($image in $images) {
  # 256 được mã hoá là 0 trong trường một byte.
  $dim = if ($image.Size -ge 256) { 0 } else { $image.Size }
  $writer.Write([byte]$dim)              # rộng
  $writer.Write([byte]$dim)              # cao
  $writer.Write([byte]0)                 # số màu bảng màu (0 = truecolor)
  $writer.Write([byte]0)                 # reserved
  $writer.Write([uint16]1)               # số mặt phẳng màu
  $writer.Write([uint16]32)              # bit mỗi điểm ảnh
  $writer.Write([uint32]$image.Bytes.Length)
  $writer.Write([uint32]$offset)
  $offset += $image.Bytes.Length
}
foreach ($image in $images) { $writer.Write([byte[]]$image.Bytes) }
$writer.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $outDir 'icon.ico'), $ico.ToArray())
$writer.Dispose(); $ico.Dispose()

Write-Host "Đã sinh icon vào $outDir"
Get-ChildItem $outDir -Include icon.ico, tray.png, 'tray@2x.png' -Recurse | Select-Object Name, Length
