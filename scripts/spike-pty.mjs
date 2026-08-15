/**
 * Spike giai đoạn 2: `node-pty` có chạy được dưới đúng Node runtime mà app đóng
 * gói kèm không.
 *
 * Đây là mục rủi ro cao nhất của cả giai đoạn. `node-pty` là addon nhị phân, mà
 * engine không chạy bằng Node của máy — nó chạy bằng `runtime/node.exe`. Nếu bản
 * dựng sẵn không nạp được ở đó thì tab Terminal chết ngay từ dòng import, và mọi
 * thứ viết sau đều vô nghĩa.
 *
 * Sáu mục, xếp theo mức nguy hiểm giảm dần:
 *   1. addon nạp được, và ESM lấy được `spawn` qua lớp CJS interop
 *   2. mở được shell thật, có dữ liệu chảy về
 *   3. gõ lệnh vào → kết quả chảy ngược ra
 *   4. tiếng Việt đi qua PTY không vỡ (cmd.exe mặc định KHÔNG phải UTF-8)
 *   5. `resize` không ném
 *   6. `kill` làm tiến trình chết THẬT, không để lại mồ côi
 *
 *   ./runtime/node.exe scripts/spike-pty.mjs
 *
 * Đặt `HDW_CONPTY_DLL=1` để chạy cùng bộ kiểm qua nhánh ConPTY mới (conpty.dll
 * kèm sẵn trong `prebuilds/`) thay vì nhánh mặc định. Khác biệt đáng kể nằm ở
 * đường `kill`: nhánh mặc định fork một tiến trình phụ để liệt kê console, và
 * tiến trình phụ đó ném "AttachConsole failed" ra stderr mỗi lần đóng terminal.
 */

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ptyEntry = join(root, 'plugins', 'dock', 'node_modules', 'node-pty', 'lib', 'index.js')

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

console.log(`node:     ${process.execPath}`)
console.log(`node-pty: ${ptyEntry}\n`)

// --- 1. nạp addon -----------------------------------------------------------
//
// `import` một file CJS: Node dựng namespace từ cjs-module-lexer. Nếu `spawn`
// không lộ ra ở namespace thì nửa Node của plugin phải đổi cách viết import —
// nên phải biết ngay tại đây chứ không phải lúc chạy app.

let pty
try {
  pty = await import(pathToFileURL(ptyEntry).href)
  const co = typeof (pty.spawn ?? pty.default?.spawn) === 'function'
  record('1. addon nạp được + lấy được spawn', co,
    `named ${typeof pty.spawn}, default ${typeof pty.default?.spawn}`)
  if (!co) process.exit(1)
} catch (error) {
  record('1. addon nạp được + lấy được spawn', false, error.message)
  console.log('\nKhông nạp được addon dưới runtime này. Dừng — mọi mục sau đều vô nghĩa.')
  process.exit(1)
}

const spawnPty = pty.spawn ?? pty.default.spawn

// --- 2. mở shell ------------------------------------------------------------

const shell = process.env.ComSpec ?? 'cmd.exe'
let term
let thu = ''
const doi = (dieuKien, han, nhan) => new Promise((resolve) => {
  const het = setTimeout(() => resolve(`hết ${han}ms chờ ${nhan}`), han)
  const kiem = setInterval(() => {
    if (dieuKien()) { clearInterval(kiem); clearTimeout(het); resolve(true) }
  }, 50)
})

try {
  term = spawnPty(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: root,
    env: process.env,
    ...(process.env.HDW_CONPTY_DLL === '1' ? { useConptyDll: true } : {}),
  })
  term.onData((d) => { thu += d })
  const ok = await doi(() => thu.length > 0, 10_000, 'dữ liệu đầu tiên')
  record('2. mở được shell, có dữ liệu chảy về', ok === true,
    ok === true ? `${shell}, pid ${term.pid}, ${thu.length} ký tự đầu` : String(ok))
} catch (error) {
  record('2. mở được shell, có dữ liệu chảy về', false, error.message)
  process.exit(1)
}

// --- 3. gõ lệnh vào ---------------------------------------------------------

thu = ''
term.write('echo hdw-spike-ok\r')
{
  const ok = await doi(() => thu.includes('hdw-spike-ok\r\n') || /hdw-spike-ok[\s\S]*hdw-spike-ok/.test(thu), 10_000, 'kết quả echo')
  record('3. gõ lệnh vào → kết quả chảy ngược ra', ok === true,
    ok === true ? 'thấy chuỗi vọng lại' : `${String(ok)}; thu được: ${JSON.stringify(thu.slice(0, 200))}`)
}

// --- 4. tiếng Việt ----------------------------------------------------------
//
// cmd.exe mặc định dùng codepage OEM (437/850/1258 tuỳ máy), KHÔNG phải UTF-8.
// Câu hỏi cần trả lời dứt khoát: app có PHẢI tự đặt `chcp 65001` lúc mở terminal
// không. Nếu có mà không làm, người dùng gõ `dir` trong một thư mục tên tiếng
// Việt sẽ thấy chữ vỡ — và không ai đoán được vì sao.
//
// Nên đo cả hai vế trên CÙNG một terminal, theo đúng thứ tự trước/sau.

const DAU = 'đường'
thu = ''
term.write(`echo hdw-dau-truoc-${DAU}\r`)
{
  const ok = await doi(() => /hdw-dau-truoc-.*\r?\n/.test(thu), 8000, 'dòng vọng lại')
  const nguyenVen = thu.includes(`hdw-dau-truoc-${DAU}`)
  record('4a. chữ có dấu khi CHƯA đặt bảng mã', nguyenVen,
    ok === true
      ? (nguyenVen ? 'nguyên vẹn — không cần chcp' : `VỠ: ${JSON.stringify(thu.slice(0, 160))}`)
      : String(ok))
}

thu = ''
term.write('chcp 65001>nul\r')
await doi(() => thu.length > 0, 5000, 'chcp xong')
thu = ''
term.write(`echo hdw-dau-sau-${DAU}\r`)
{
  const ok = await doi(() => thu.includes(`hdw-dau-sau-${DAU}`), 8000, 'chữ có dấu vọng lại')
  record('4b. chữ có dấu SAU khi đặt chcp 65001', ok === true,
    ok === true ? 'UTF-8 thông suốt' : `${String(ok)}; thu: ${JSON.stringify(thu.slice(0, 160))}`)
}

// --- 5. resize --------------------------------------------------------------

try {
  term.resize(120, 40)
  record('5. resize không ném', true, '80x24 → 120x40')
} catch (error) {
  record('5. resize không ném', false, error.message)
}

// --- 6. kill sạch -----------------------------------------------------------
//
// Đây là mục quyết định chuyện "đóng app xong máy còn tiến trình ma". Không đủ
// khi `onExit` nổ — phải hỏi hệ điều hành xem pid đó còn không.

const pid = term.pid
let thoat
const daThoat = new Promise((resolve) => { term.onExit((e) => { thoat = e; resolve() }) })
term.kill()
const kipThoat = await Promise.race([daThoat.then(() => true), new Promise((r) => setTimeout(() => r('hết 8000ms'), 8000))])
record('6a. kill → onExit nổ', kipThoat === true,
  kipThoat === true ? `exitCode ${String(thoat?.exitCode)}` : String(kipThoat))

let conSong = true
try {
  const ra = execFileSync('tasklist', ['/fi', `PID eq ${String(pid)}`, '/nh'], { encoding: 'utf8' })
  conSong = ra.includes(String(pid))
} catch {
  conSong = false
}
record('6b. tiến trình chết thật, không mồ côi', !conSong, `pid ${pid} ${conSong ? 'CÒN SỐNG' : 'đã biến mất'}`)

// ---------------------------------------------------------------------------

console.log('\n=== KẾT QUẢ ===')
const hong = results.filter((r) => !r.ok)
console.log(hong.length === 0
  ? 'Tất cả đạt. node-pty chạy được dưới Node runtime đóng gói — giai đoạn 2 đi tiếp được.'
  : `${hong.length}/${results.length} mục KHÔNG đạt: ${hong.map((r) => r.name).join(', ')}`)
process.exit(hong.length === 0 ? 0 : 1)
