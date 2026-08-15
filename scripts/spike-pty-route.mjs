/**
 * Spike đường WebSocket của tab Terminal — kiểm nửa Node mà không cần mở giao diện.
 *
 * Khởi động engine đúng cách app khởi động nó (Node runtime đóng gói + `--patch`
 * trỏ vào plugin), rồi đóng vai trình duyệt: mở `/hdw/pty`, gõ một lệnh, đọc kết
 * quả, và thử hai đường bị từ chối.
 *
 * Sáu mục:
 *   1. plugin nạp được — route `/hdw/pty` có người nhận
 *   2. rào workspace: thư mục lạ bị TỪ CHỐI
 *   3. rào tin cậy: Origin của trang khác bị TỪ CHỐI
 *   4. mở được phiên, có khung `ready`
 *   5. gõ lệnh vào → kết quả chảy về
 *   6. đóng WebSocket → shell chết theo, không mồ côi
 *
 *   node scripts/spike-pty-route.mjs
 */

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nodeExe = join(root, 'runtime', 'node.exe')
const dshBin = join(root, 'engine', 'node_' + 'modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const patch = join(root, 'plugins', 'dock', 'cordis.patch.yml')

const BOOT_TIMEOUT_MS = 180_000
const URL_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/m

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

// DSH_HOME riêng: spike không được đụng vào lịch sử phiên thật của chủ dự án.
const home = mkdtempSync(join(tmpdir(), 'hdw-pty-'))

// Junction bắt buộc, không phải tuỳ chọn: engine phân giải plugin bằng TÊN GÓI
// từ thư mục profile, nên khai đường dẫn trong `cordis.patch.yml` là chưa đủ.
// Đây chính là việc `src/main/plugin-link.ts` làm mỗi lần app khởi động; dựng
// lại ở đây để DSH_HOME tạm cũng thấy plugin.
const nmDir = join(home, 'profiles', 'node_' + 'modules')
mkdirSync(nmDir, { recursive: true })
symlinkSync(join(root, 'plugins', 'dock'), join(nmDir, 'harness-desktop-dock'), 'junction')

console.log(`node:     ${nodeExe}`)
console.log(`DSH_HOME: ${home}\n`)

// Lớp patch thứ hai: một plugin tạm đăng ký thư mục dự án thành workspace, để
// rào workspace của route có cái hợp lệ mà đối chiếu. DSH_HOME mới tinh thì
// chưa có workspace nào, và khi đó MỌI kết nối đều bị từ chối — đúng luật,
// nhưng như vậy thì không kiểm được đường thành công. Đặt qua biến môi trường
// để spike không phụ thuộc vào một file nằm ngoài dự án.
const seedPatch = process.env['HDW_SEED_PATCH']
const patchArgs = seedPatch === undefined
  ? ['--patch', patch]
  : ['--patch', patch, '--patch', seedPatch]

const child = spawn(nodeExe, [dshBin, '--profile', 'web', ...patchArgs, '--port', '0'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
  env: { ...process.env, DSH_HOME: home },
})

let stdout = ''
let stderr = ''
let settled = false

const baseUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`không thấy dòng URL sau ${BOOT_TIMEOUT_MS / 1000}s`)), BOOT_TIMEOUT_MS)
  const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value) } }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    if (process.env['HDW_VERBOSE'] === '1') process.stdout.write(chunk)
    const match = URL_LINE.exec(stdout)
    if (match) finish(resolve, match[1])
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('exit', (code) => finish(reject, new Error(`engine thoát sớm với mã ${String(code)}`)))
  child.on('error', (error) => finish(reject, error))
}).catch((error) => {
  console.log(`FAIL  engine không lên — ${error.message}`)
  console.log('\n--- stderr ---\n' + stderr.slice(-3000))
  process.exit(1)
})

const wsBase = baseUrl.replace('http://', 'ws://')
const ket = (u, headers) => new Promise((resolve) => {
  const ws = new WebSocket(u, headers === undefined ? undefined : { headers })
  const khung = []
  const timer = setTimeout(() => resolve({ ws, mo: false, khung, ly_do: 'hết 12s' }), 12_000)
  ws.binaryType = 'arraybuffer'
  ws.addEventListener('message', (e) => { khung.push(e.data) })
  ws.addEventListener('open', () => { clearTimeout(timer); resolve({ ws, mo: true, khung }) })
  ws.addEventListener('error', () => { clearTimeout(timer); resolve({ ws, mo: false, khung, ly_do: 'bị từ chối' }) })
})
const cho = (ms) => new Promise((r) => setTimeout(r, ms))

// Chờ registry workspace bootstrap xong.
//
// Dòng URL readiness in ra SỚM HƠN lúc registry sẵn sàng: nó có hai phụ thuộc
// khởi động riêng (`storageDomain`, `sessionPersistence`) và chỉ nạp danh sách
// workspace sau khi cả hai lên. Hỏi ngay lúc thấy URL là gặp một registry còn
// rỗng, và rào sẽ từ chối mọi thứ — trông y hệt như rào thủng ngược.
//
// Route Files dùng ĐÚNG rào mà route Terminal dùng, và nó trả lời bằng HTTP kèm
// lý do bằng chữ, nên nó là chỗ hỏi tốt nhất: một lời từ chối ở tầng WebSocket
// chỉ là "kết nối đứt", không nói được vì sao.
{
  const q = `root=${encodeURIComponent(root)}&path=${encodeURIComponent(root)}`
  let cuoi = ''
  for (let i = 0; i < 40; i += 1) {
    const res = await fetch(`${baseUrl}/hdw/fs/list?${q}`)
    cuoi = `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`
    if (res.ok) break
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log(`  (chuẩn đoán) /hdw/fs/list → ${cuoi}\n`)
}

// --- 1 + 2. Thư mục lạ phải bị từ chối --------------------------------------
//
// Chạy TRƯỚC mục mở phiên: nếu rào thủng thì phải biết ngay, đừng để một mục
// PASS ở dưới làm yên tâm nhầm.

{
  const la = await ket(`${wsBase}/hdw/pty?cwd=${encodeURIComponent('C:/Windows/System32')}&cols=80&rows=24`)
  record('2. rào workspace: thư mục lạ bị từ chối', !la.mo, la.mo ? 'MỞ ĐƯỢC — RÀO THỦNG' : la.ly_do)
  la.ws.close()
}

// --- 3. Rào tin cậy: Origin của trang khác ----------------------------------

{
  const cheo = await ket(`${wsBase}/hdw/pty?cwd=${encodeURIComponent(root)}&cols=80&rows=24`, {
    origin: 'http://evil.example',
  })
  record('3. rào tin cậy: Origin lạ bị từ chối', !cheo.mo, cheo.mo ? 'MỞ ĐƯỢC — RÀO THỦNG' : cheo.ly_do)
  cheo.ws.close()
}

// --- 1 + 4. Mở phiên thật ---------------------------------------------------

const phien = await ket(`${wsBase}/hdw/pty?cwd=${encodeURIComponent(root)}&cols=100&rows=30`)
record('1. plugin nạp được, route /hdw/pty có người nhận', phien.mo || phien.ly_do !== 'hết 12s',
  phien.mo ? 'kết nối mở' : String(phien.ly_do))

if (!phien.mo) {
  record('4. nhận được khung ready', false, 'không mở được kết nối')
  console.log('\n--- stderr engine ---\n' + stderr.slice(-3000))
} else {
  await cho(2500)
  const dieuKhien = phien.khung.filter((k) => typeof k === 'string').map((k) => JSON.parse(k))
  const ready = dieuKhien.find((k) => k.t === 'ready')
  record('4. nhận được khung ready', ready !== undefined,
    ready === undefined ? JSON.stringify(dieuKhien).slice(0, 200) : `pid ${ready.pid}, ${ready.shell}`)

  // --- 5. Gõ lệnh vào -------------------------------------------------------
  phien.khung.length = 0
  phien.ws.send(new TextEncoder().encode('echo hdw-route-ok\r'))
  await cho(3000)
  const man = phien.khung
    .filter((k) => k instanceof ArrayBuffer)
    .map((k) => new TextDecoder().decode(k))
    .join('')
  record('5. gõ lệnh vào → kết quả chảy về', man.includes('hdw-route-ok'),
    man.includes('hdw-route-ok') ? `${man.length} byte màn hình` : JSON.stringify(man.slice(0, 200)))

  // --- 6. Đóng kết nối → shell chết theo ------------------------------------
  const pid = ready?.pid
  phien.ws.close()
  await cho(3000)
  let conSong = true
  try {
    const ra = execFileSync('tasklist', ['/fi', `PID eq ${String(pid)}`, '/nh'], { encoding: 'utf8' })
    conSong = ra.includes(String(pid))
  } catch {
    conSong = false
  }
  record('6. đóng WebSocket → shell chết theo', !conSong, `pid ${String(pid)} ${conSong ? 'CÒN SỐNG' : 'đã biến mất'}`)
}

console.log('\n=== KẾT QUẢ ===')
const hong = results.filter((r) => !r.ok)
console.log(hong.length === 0
  ? 'Tất cả đạt. Nửa Node của tab Terminal chạy đúng, cả hai rào an toàn đều giữ.'
  : `${hong.length}/${results.length} mục KHÔNG đạt: ${hong.map((r) => r.name).join(', ')}`)

try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* đã tắt */ }
process.exit(hong.length === 0 ? 0 : 1)
