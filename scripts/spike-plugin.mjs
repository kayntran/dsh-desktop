/**
 * Spike hợp đồng plugin ngoài cây: engine dsh có nạp được plugin của ta và
 * PHỤC VỤ ĐƯỢC nửa giao diện của nó không.
 *
 * Vì sao cần spike riêng cho việc này: nửa giao diện được phân giải bằng
 * `createRequire(<thư mục profile>).resolve('<tên gói>/package.json')`. Sai một
 * chi tiết — tên entry là đường dẫn thay vì tên gói, thiếu `exports`, junction
 * đặt sai chỗ — thì nửa Node vẫn chạy bình thường, engine không báo lỗi gì, mà
 * panel đơn giản là không bao giờ xuất hiện. Đó là loại hỏng im lặng mà bộ luật
 * dự án sinh ra để chống, nên nó phải bị bắt bằng một phép thử chứ không bằng
 * việc đọc code cho kỹ.
 *
 *   npm run spike:plugin
 */

import { spawn, execFileSync } from 'node:child_process'
import { lstatSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nodeExe = join(root, 'runtime', 'node.exe')
const dshBin = join(root, 'engine', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const pluginDir = join(root, 'plugins', 'dock')
const patchPath = join(pluginDir, 'cordis.patch.yml')

const PKG = 'harness-desktop-dock'
const BOOT_TIMEOUT_MS = 180_000
const URL_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/m

/** Thư mục dữ liệu dsh — cùng quy tắc với `resolveDshHome` của thượng nguồn. */
function dshHome() {
  const raw = process.env['DSH_HOME']
  if (raw === undefined || raw.trim() === '') return join(homedir(), '.dsh')
  const trimmed = raw.trim()
  return trimmed.startsWith('~') ? join(homedir(), trimmed.slice(1)) : resolve(trimmed)
}

/**
 * Hai chỗ Node có thể phân giải tên gói trần từ thư mục profile
 * (`<DSH_HOME>/profiles/web/`). Spike đã đo: **cả hai đều chạy**.
 *
 * Chọn `profiles/node_modules` làm chính vì đó là cây junction do chính thượng
 * nguồn dựng và chữa (`healProfilesModuleFallback`), và routine đó chỉ thêm chứ
 * không bao giờ xoá tên lạ. `profiles/web/node_modules` là địa bàn của pnpm khi
 * người dùng chạy `dsh plugin add`, mà pnpm dọn thẳng tay những gì không có
 * trong manifest.
 */
const CANDIDATES = [
  { label: 'profiles/node_modules', dir: join(dshHome(), 'profiles', 'node_modules') },
  { label: 'profiles/web/node_modules', dir: join(dshHome(), 'profiles', 'web', 'node_modules') },
]

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

/**
 * Dựng junction trỏ tới plugin, gọi lại được nhiều lần.
 * @returns hàm dọn, chỉ gỡ đúng link do lần gọi này tạo ra.
 */
function ensureJunction(dir) {
  mkdirSync(dir, { recursive: true })
  const link = join(dir, PKG)
  const info = safeLstat(link)
  if (info?.isSymbolicLink() === true) {
    // Đích cũ có thể đã lệch (dev đổi chỗ dự án). Tạo lại luôn cho chắc — so
    // sánh đường dẫn trên Windows không đáng tin vì junction trả về dạng `\\?\`.
    unlinkSync(link)
  } else if (info !== undefined) {
    throw new Error(`${link} đã là thư mục thật — dừng lại, không xoá đồ của người khác`)
  }
  symlinkSync(pluginDir, link, 'junction')
  return () => { try { unlinkSync(link) } catch { /* đã biến mất thì thôi */ } }
}

function safeLstat(path) {
  try { return lstatSync(path) } catch { return undefined }
}

/** Khởi động engine với `--patch`, chờ dòng URL. */
function bootEngine() {
  const child = spawn(nodeExe, [dshBin, '--profile', 'web', '--patch', patchPath, '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stdout = ''
  let stderr = ''
  let settled = false
  const url = new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`không thấy dòng URL sau ${BOOT_TIMEOUT_MS / 1000}s`)), BOOT_TIMEOUT_MS)
    const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value) } }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      const match = URL_LINE.exec(stdout)
      if (match) finish(res, match[1])
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('exit', (code) => finish(rej, new Error(`engine thoát sớm với mã ${code}`)))
    child.on('error', (error) => finish(rej, error))
  })
  return { child, url, out: () => stdout, err: () => stderr }
}

function kill(child) {
  try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* đã chết */ }
}

/** Chạy trọn một lượt thử với junction đặt ở `candidate`. */
async function attempt(candidate) {
  console.log(`\n--- thử junction ở ${candidate.label} ---`)
  const undo = ensureJunction(candidate.dir)
  const engine = bootEngine()
  try {
    const baseUrl = await engine.url
    const html = await (await fetch(baseUrl)).text()
    const served = html.includes(PKG)
    const bundle = await fetch(`${baseUrl}/plugins/${PKG}/client.js`)
    const body = await bundle.text()
    const bundleOk = bundle.ok && body.includes('__ModuleLoader__') && !body.includes('<!doctype')
    return {
      baseUrl, served, bundleOk,
      hostRan: engine.out().includes('hdw-dock: nửa Node đã chạy'),
      bundleDetail: `HTTP ${bundle.status}, ${body.length} bytes`,
      undo,
    }
  } catch (error) {
    console.log(engine.err().slice(-2000))
    return { error, undo }
  } finally {
    kill(engine.child)
  }
}

console.log(`node:      ${nodeExe}`)
console.log(`plugin:    ${pluginDir}`)
console.log(`DSH_HOME:  ${dshHome()}`)

// Thử TỪNG vị trí một cách cô lập — gỡ junction trước khi sang vị trí sau, để
// một lượt đạt không làm lượt kế tiếp đạt theo. Biết cả hai chỗ có ăn hay không
// là thông tin đáng giá: chỗ nào cũng chạy thì chọn chỗ ít bị công cụ khác dọn.
const working = []
let winner
for (const candidate of CANDIDATES) {
  const outcome = await attempt(candidate)
  if (outcome.error !== undefined) {
    console.log(`   engine không lên được: ${outcome.error.message}`)
    outcome.undo()
    continue
  }
  console.log(`   nửa Node chạy: ${outcome.hostRan ? 'có' : 'KHÔNG'}`)
  console.log(`   tên gói có trong __DSH_BOOT__: ${outcome.served ? 'có' : 'KHÔNG'}`)
  console.log(`   client.js phục vụ được: ${outcome.bundleOk ? 'có' : 'KHÔNG'} (${outcome.bundleDetail})`)
  const ok = outcome.served && outcome.bundleOk
  if (ok) {
    working.push(candidate)
    if (winner === undefined) winner = { candidate, outcome }
  }
  outcome.undo()
}
// Dựng lại đúng một junction ở vị trí đã chọn để app chạy được ngay sau spike.
if (winner !== undefined) ensureJunction(winner.candidate.dir)

console.log('')
if (winner === undefined) {
  record('1. engine nạp plugin ngoài cây', false, 'không vị trí junction nào cho ra nửa giao diện')
} else {
  record('1. engine nạp plugin ngoài cây', true, `junction ở ${winner.candidate.label}`)
  record('2. nửa Node chạy apply()', winner.outcome.hostRan, 'dòng log riêng xuất hiện trên stdout engine')
  record('3. tên gói nằm trong __DSH_BOOT__', winner.outcome.served, 'nửa giao diện được công bố cho trang')
  record('4. /plugins/<gói>/client.js phục vụ được', winner.outcome.bundleOk, winner.outcome.bundleDetail)
}

console.log('\n=== KẾT QUẢ ===')
const failed = results.filter((r) => !r.ok)
if (failed.length === 0) {
  console.log(`Vị trí junction chạy được: ${working.map((c) => c.label).join(', ')}`)
  console.log(`Đã dựng junction tại: ${join(winner.candidate.dir, PKG)}`)
  console.log('Nửa khó của giai đoạn 1 đã được chứng minh — phần còn lại chỉ là viết giao diện.')
} else {
  console.log(`${failed.length}/${results.length} mục KHÔNG đạt: ${failed.map((r) => r.name).join(', ')}`)
}
process.exit(failed.length === 0 ? 0 : 1)
