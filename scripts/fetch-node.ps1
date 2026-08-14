# Tải Node runtime chính thức mà engine dsh sẽ chạy trên đó.
#
#   powershell -ExecutionPolicy Bypass -File scripts\fetch-node.ps1
#
# Kết quả: runtime\node.exe (không commit vào git — xem .gitignore).
#
# Vì sao app phải mang theo một node.exe riêng thay vì dùng chính binary
# Electron ở chế độ Node: V8 trong Electron bật memory cage, nên N-API không
# tạo được external ArrayBuffer. koffi — thứ upstream dùng để gọi dialog chọn
# thư mục của Windows — cần đúng khả năng đó, và khi thiếu thì tiến trình chết
# hẳn chứ không ném lỗi bắt được. Chi tiết trong README.

param(
  # Phiên bản Node đóng gói kèm app. Đổi ở đây rồi chạy lại script.
  [string]$Version = 'v24.19.0'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'runtime\node.exe'
$base = "https://nodejs.org/dist/$Version"

# Băm chính thức của bản phát hành, để một bản tải hỏng hay bị tráo không lọt
# vào installer mà không ai biết.
Write-Host "Đang lấy SHASUMS256.txt của $Version ..."
$sums = (Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -UseBasicParsing).Content
$line = $sums -split "`n" | Where-Object { $_ -match '\s+win-x64/node\.exe\s*$' } | Select-Object -First 1
if (-not $line) { throw "Không thấy dòng win-x64/node.exe trong SHASUMS256.txt của $Version" }
$expected = ($line -split '\s+')[0].ToLower()

if (Test-Path $target) {
  $have = (Get-FileHash -Path $target -Algorithm SHA256).Hash.ToLower()
  if ($have -eq $expected) {
    Write-Host "runtime\node.exe đã đúng bản $Version, bỏ qua."
    exit 0
  }
  Write-Host "runtime\node.exe không khớp bản $Version, tải lại."
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
$temp = "$target.download"
Write-Host "Đang tải $base/win-x64/node.exe ..."
# Progress bar của Invoke-WebRequest làm chậm việc tải file lớn đi nhiều lần.
$previous = $ProgressPreference
$ProgressPreference = 'SilentlyContinue'
try {
  Invoke-WebRequest -Uri "$base/win-x64/node.exe" -OutFile $temp -UseBasicParsing
} finally {
  $ProgressPreference = $previous
}

$actual = (Get-FileHash -Path $temp -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) {
  Remove-Item $temp -Force
  throw "SHA256 không khớp. Chờ $expected, nhận $actual. Đã xoá file tải về."
}

Move-Item -Path $temp -Destination $target -Force
$size = [math]::Round((Get-Item $target).Length / 1MB, 1)
Write-Host "Xong: runtime\node.exe ($Version, $size MB, SHA256 khớp)."
