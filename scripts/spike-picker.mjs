/**
 * Spike hợp đồng thượng nguồn (phần 2) — dialog chọn thư mục native.
 *
 * Đây là tương tác native quan trọng nhất của app: người dùng gắn thư mục làm
 * việc bằng nó. Đường chạy đầy đủ là koffi → COM IFileOpenDialog trong một
 * tiến trình worker riêng, nên nạp được koffi thôi chưa đủ để kết luận.
 *
 * Kiểm không cần người bấm: (1) backend `native` có được mount không — nếu có
 * thì host.listDirectory phải trả `directory-picker-unavailable` vì đó là
 * phương thức của backend `browse`; (2) gọi host.pickDirectory, bấm nút xác
 * nhận, và đòi cho được một đường dẫn trả về.
 *
 * Mục 2 phải BẤM XÁC NHẬN chứ không được huỷ. Nhánh huỷ không chạm vào đoạn
 * đọc kết quả, và chính đoạn đó là nơi từng làm chết cả tiến trình worker khi
 * engine chạy trên Node của Electron: đọc chuỗi UTF-16 mà COM trả về cần
 * external ArrayBuffer, thứ V8 trong Electron không cho tạo. Một spike chỉ
 * huỷ dialog sẽ báo PASS trên đúng bản dựng đang hỏng.
 */

import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nodeExe = join(root, 'runtime', 'node.exe')
const dshBin = join(root, 'engine', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

const DIALOG_TITLE = 'Select Workspace Directory'
const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

const rpc = async (base, method, payload = {}) => {
  const res = await fetch(`${base}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `spike-${method}`, method, payload }),
  })
  return res.json()
}

const child = spawn(nodeExe, [dshBin, '--profile', 'web', '--port', '0', '--no-open'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

const cleanup = () => {
  try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
}

let stdout = ''
const baseUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('hết giờ chờ dòng URL')), 180_000)
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/m.exec(stdout)
    if (match) { clearTimeout(timer); resolve(match[1]) }
  })
  child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`engine thoát sớm, mã ${code}`)) })
}).catch((error) => { console.error(error.message); cleanup(); process.exit(1) })

console.log(`engine: ${baseUrl}\n`)

// 1. Backend nào đang phục vụ seam: native hay browse.
const listing = await rpc(baseUrl, 'host.listDirectory', {})
const code = listing?.result?.error?.code
record('1. backend `native` được mount (không phải `browse`)',
  code === 'directory-picker-unavailable',
  code === undefined ? `browse đang phục vụ: ${JSON.stringify(listing).slice(0, 200)}` : `host.listDirectory → ${code}`)

// 2. Dialog Windows thật hiện ra rồi trả về được đường dẫn. pickDirectory treo
//    cho tới khi người dùng quyết, nên không await ngay.
console.log('\nĐang gọi host.pickDirectory, chờ dialog hiện...')
const pick = rpc(baseUrl, 'host.pickDirectory', {}).catch((error) => ({ error: String(error) }))

const findDialog = () => {
  const script = `Get-Process | Where-Object { $_.MainWindowTitle -like '*${DIALOG_TITLE}*' } | Select-Object -First 1 -ExpandProperty MainWindowTitle`
  try { return execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim() } catch { return '' }
}

let title = ''
for (let attempt = 0; attempt < 12 && title === ''; attempt++) {
  await new Promise((r) => setTimeout(r, 1000))
  title = findDialog()
}
record('2. dialog Windows native hiện ra (koffi + COM chạy được)', title !== '',
  title === '' ? 'không thấy cửa sổ nào có tiêu đề đó sau 12s' : `tìm thấy cửa sổ: "${title}"`)

// 3. Bấm nút xác nhận và đòi cho được đường dẫn. Bấm bằng BM_CLICK gửi thẳng
//    tới nút IDOK thay vì mô phỏng bàn phím: SendKeys cần giành foreground,
//    thứ Windows thường từ chối cấp cho tiến trình chạy nền.
if (title !== '') {
  execFileSync('powershell', ['-NoProfile', '-Command', `
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Dlg {
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h, int id);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
"@
    $p = Get-Process | Where-Object { $_.MainWindowTitle -like '*${DIALOG_TITLE}*' } | Select-Object -First 1
    if ($p) {
      $ok = [Dlg]::GetDlgItem($p.MainWindowHandle, 1)   # IDOK
      if ($ok -ne [IntPtr]::Zero) { [void][Dlg]::PostMessage($ok, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) }
    }
  `], { stdio: 'ignore' })
}

const picked = await Promise.race([pick, new Promise((r) => setTimeout(() => r({ timeout: true }), 20_000))])
const asText = JSON.stringify(picked ?? null)
// Đường dẫn Windows trong JSON hiện ra dạng "C:\\Users\\...".
const gotPath = /[A-Za-z]:\\\\/.test(asText)
record('3. chọn xong trả về đường dẫn (đường đọc kết quả không làm chết worker)',
  gotPath, gotPath ? asText.slice(0, 160) : `không thấy đường dẫn trong: ${asText.slice(0, 300)}`)

console.log('\n=== KẾT QUẢ ===')
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0
  ? 'Dialog chọn thư mục native chạy trọn vẹn trên Node runtime đóng gói.'
  : `${failed.length}/${results.length} mục KHÔNG đạt.`)

cleanup()
process.exitCode = failed.length === 0 ? 0 : 1
