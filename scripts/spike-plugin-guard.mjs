/**
 * Danh sách plugin KHÔNG ĐƯỢC PHÉP TẮT, xác định bằng cách thử từng cái một.
 *
 * Vì sao phải thử chứ không suy luận: trong 135 plugin có những cái giữ cho màn
 * hình sống. Tắt một cái như thế xong thì không còn giao diện nào để bật lại —
 * người dùng phải sửa file cấu hình bằng tay, mà chủ dự án không đọc code. Một
 * danh sách đoán bằng cách đọc tên gói sẽ vừa bỏ sót vừa cấm oan.
 *
 * Cách đo: với từng entry, tắt nó, xem ba dấu vết, rồi bật lại và xem có về được
 * trạng thái chạy hay không. Bốn kết luận có thể:
 *
 *   safe          tắt được, bật lại chạy lại, màn hình không mất gì
 *   no-return     tắt được nhưng KHÔNG bật lại được — mất đường quay lại
 *   breaks-ui     engine còn sống nhưng trang mất phần dựng Cài đặt
 *   kills-engine  engine không trả lời nữa; phải khởi động lại engine để đo tiếp
 *
 * Ba nhóm cuối đều là "khoá cứng". Chạy trên DSH_HOME riêng như spike:loader.
 *
 *   npm run spike:guard
 *   SPIKE_GUARD_LIMIT=20 npm run spike:guard   # đo thử 20 entry đầu
 */

import { spawn, execFileSync } from 'node:child_process'
import { lstatSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nodeExe = join(root, 'runtime', 'node.exe')
const dshBin = join(root, 'engine', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const dockDir = join(root, 'plugins', 'dock')
const dockPatch = join(dockDir, 'cordis.patch.yml')
const probeFile = join(root, 'scripts', 'spike-loader-probe.mjs')

const dshHome = process.env['SPIKE_DSH_HOME'] ?? join('D:', 'tmp', 'hdw-spike-dsh')
const probePatch = join(dshHome, 'spike-loader-probe.cordis.yml')
const reportPath = join(dshHome, 'guard-report.json')

const BOOT_TIMEOUT_MS = 300_000
const CALL_TIMEOUT_MS = 10_000
const URL_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/m
const LIMIT = Number(process.env['SPIKE_GUARD_LIMIT'] ?? '0')
/** Chỉ đo những entry có id chứa chuỗi này — để soi lại một kết luận đáng ngờ. */
const ONLY = process.env['SPIKE_GUARD_ONLY'] ?? ''

/** Đầu đo của chính bộ kiểm — tắt nó là tự bịt mắt mình, nên bỏ qua. */
const PROBE_ID = 'include:spike-loader-probe'

/**
 * Đường sống của công tắc: chuỗi gói mà thiếu một cái là người dùng KHÔNG CÒN
 * mở được Cài đặt → Plugins để bật lại thứ vừa tắt.
 *
 * Đây là **tiêu chí**, do ta chọn và nói rõ ra; kết luận plugin nào vi phạm nó
 * thì vẫn do phép đo trả lời. Bản đầu chỉ có hai gói Cài đặt, và vì thế đã chấm
 * `ui-layout` (vỏ app) với `ui-sidebar` (nút vào Cài đặt) là "an toàn" — tắt
 * chúng thì trang Cài đặt vẫn được công bố mà không còn đường nào bấm tới.
 */
const UI_LIFELINE = [
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-settings-plugins',
]

const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

function safeLstat(path) {
  try { return lstatSync(path) } catch { return undefined }
}

function ensureDockLink() {
  const dir = join(dshHome, 'profiles', 'node_modules')
  mkdirSync(dir, { recursive: true })
  const link = join(dir, 'harness-desktop-dock')
  const info = safeLstat(link)
  if (info?.isSymbolicLink() === true) unlinkSync(link)
  else if (info !== undefined) throw new Error(`${link} là thư mục thật — dừng lại`)
  symlinkSync(dockDir, link, 'junction')
}

function writeProbePatch() {
  mkdirSync(dshHome, { recursive: true })
  writeFileSync(probePatch,
    `- insert:\n    - id: spike-loader-probe\n      name: '${pathToFileURL(probeFile).href}'\n`)
}

function kill(child) {
  try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* đã chết */ }
}

/** Khởi động engine và chờ dòng URL. */
async function bootEngine() {
  const child = spawn(nodeExe, [
    dshBin, '--profile', 'web', '--patch', dockPatch, '--patch', probePatch, '--port', '0', '--no-open',
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, DSH_HOME: dshHome } })
  let out = ''
  const baseUrl = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('quá hạn chờ engine')), BOOT_TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      out += chunk
      const match = URL_LINE.exec(out)
      if (match) { clearTimeout(timer); res(match[1]) }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', () => {})
    child.on('exit', (code) => { clearTimeout(timer); rej(new Error(`engine thoát sớm với mã ${code}`)) })
    child.on('error', (error) => { clearTimeout(timer); rej(error) })
  })
  return { child, baseUrl }
}

/** Một lời gọi có hạn giờ; hết giờ hoặc lỗi mạng đều trả undefined. */
async function callJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) })
    if (!res.ok) return undefined
    return await res.json()
  } catch {
    return undefined
  }
}

async function callText(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) })
    if (!res.ok) return undefined
    return await res.text()
  } catch {
    return undefined
  }
}

/**
 * Tên gói của mọi plugin giao diện ĐANG BẬT, đọc từ `__DSH_BOOT__` của trang.
 *
 * Phải đọc đúng trường `entries[].id`. Hai bản trước đều dò chuỗi trong cả trang
 * và cùng chấm `ui-settings` là "an toàn" — trong khi tắt nó là mất trang Cài
 * đặt. Lý do: tên gói của một plugin đã tắt vẫn còn trong `inject` của những
 * plugin phụ thuộc nó. Đo được: tắt `ui-settings` thì `entries[].id` mất nó và
 * `client.js` trả 404, còn chuỗi tên gói vẫn xuất hiện chín chỗ trong trang.
 * Đây là lần thứ hai dự án này trả giá cho việc dò chữ thay vì đo dấu vết.
 */
function bootEntryIds(html) {
  const match = /(?:window\.__DSH_BOOT__|globalThis\[["']__DSH_BOOT__["']\])\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/.exec(html)
  if (match === null) return []
  try {
    return JSON.parse(match[1]).entries.map((e) => e.id)
  } catch {
    return []
  }
}

/** Ba dấu vết cho biết app còn dùng được hay không. */
async function health(baseUrl) {
  const list = await callJson(`${baseUrl}/spike/loader/list`)
  if (list === undefined) return { engineAlive: false, pageOk: false, settingsOk: false, entries: undefined }
  const html = await callText(`${baseUrl}/`)
  const pageOk = html !== undefined && html.includes('__DSH_BOOT__')
  const running = pageOk ? bootEntryIds(html) : []
  const settingsOk = pageOk && UI_LIFELINE.every((pkg) => running.includes(pkg))
  return { engineAlive: true, pageOk, settingsOk, entries: list.entries }
}

async function update(baseUrl, id, disabled) {
  return await callJson(`${baseUrl}/spike/loader/update?id=${encodeURIComponent(id)}&disabled=${disabled}`)
}

/** Mã HTTP của bundle giao diện một gói; 0 khi không gọi được. */
async function clientStatus(baseUrl, pkg) {
  try {
    const res = await fetch(`${baseUrl}/plugins/${pkg}/client.js`, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) })
    return res.status
  } catch {
    return 0
  }
}

/**
 * Chờ bundle giao diện của một gói đổi trạng thái phục vụ.
 *
 * Vì sao phải chờ: `loader.update` trả về ngay, nhưng trang `/` được dựng lại
 * sau đó một nhịp. Bản đầu đọc trang ngay sau khi gạt, và vì thế chấm
 * `ui-sidebar` là an toàn ở lượt chạy đầy đủ trong khi chạy riêng nó lại là
 * "phá giao diện" — cùng một plugin, hai kết luận. Chờ đúng dấu vết của chính
 * hành động vừa làm thì kết luận không còn phụ thuộc engine nhanh hay chậm.
 * @returns true nếu đã đạt trạng thái mong đợi trong hạn giờ.
 */
async function waitForClient(baseUrl, pkg, expectServed, limitMs = 8000) {
  const deadline = Date.now() + limitMs
  for (;;) {
    const served = (await clientStatus(baseUrl, pkg)) === 200
    if (served === expectServed) return true
    if (Date.now() >= deadline) return false
    await sleep(250)
  }
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`DSH_HOME:  ${dshHome}   (bản sao, không phải ~/.dsh)`)
writeProbePatch()
ensureDockLink()

let engine = await bootEngine()
console.log(`engine tại ${engine.baseUrl}`)
let baseUrl = engine.baseUrl
let reboots = 0

const first = await health(baseUrl)
if (first.entries === undefined) {
  console.log('đầu đo không trả lời ngay từ đầu — dừng')
  kill(engine.child)
  process.exit(1)
}
// Thứ tự đo cố định, lấy một lần: sau mỗi lần khởi động lại engine, cây được
// dựng lại y nguyên nên chỉ số vẫn trỏ đúng entry.
const plan = first.entries
  .filter((e) => !e.group && e.id !== PROBE_ID && (ONLY === '' || e.id.includes(ONLY)))
  .map((e) => ({ id: e.id, moduleName: e.moduleName }))
const total = LIMIT > 0 ? Math.min(LIMIT, plan.length) : plan.length
console.log(`sẽ đo ${total} entry (bỏ ${first.entries.length - plan.length} dòng group và đầu đo)\n`)

const findings = []

for (let i = 0; i < total; i++) {
  const { id, moduleName } = plan[i]
  const label = `[${i + 1}/${total}] ${id}`

  // Engine có thể đã chết ở lượt trước — dựng lại trước khi đo tiếp.
  if ((await health(baseUrl)).engineAlive === false) {
    kill(engine.child)
    reboots += 1
    await sleep(1200)
    engine = await bootEngine()
    baseUrl = engine.baseUrl
    console.log(`   ↻ khởi động lại engine (lần ${reboots}) tại ${baseUrl}`)
  }

  // Gói này có nửa giao diện đang được phục vụ hay không — biết trước thì mới
  // chờ được đúng dấu vết sau khi tắt.
  const servedBefore = (await clientStatus(baseUrl, moduleName)) === 200
  const off = await update(baseUrl, id, 'true')
  if (servedBefore && off?.ok === true) await waitForClient(baseUrl, moduleName, false)
  const after = await health(baseUrl)

  let verdict
  if (after.engineAlive === false) verdict = 'kills-engine'
  else if (off?.ok !== true) verdict = 'cannot-disable'
  else if (after.settingsOk === false) verdict = 'breaks-ui'
  else {
    // Tắt được và màn hình còn nguyên — câu quan trọng nhất còn lại là bật lại được không.
    const on = await update(baseUrl, id, 'null')
    if (servedBefore && on?.ok === true) await waitForClient(baseUrl, moduleName, true)
    const back = await health(baseUrl)
    if (back.engineAlive === false) verdict = 'kills-engine'
    else {
      const entry = back.entries?.find((e) => e.id === id)
      verdict = on?.ok === true && entry?.effectiveDisabled === false && back.settingsOk === true
        ? 'safe'
        : 'no-return'
    }
  }

  findings.push({ id, moduleName, verdict })
  const mark = verdict === 'safe' ? '  ' : '!!'
  console.log(`${mark} ${label} → ${verdict}${verdict === 'safe' ? '' : `   (${moduleName})`}`)
  if (ONLY !== '') {
    console.log(`     chi tiết: off.ok=${String(off?.ok)} engineAlive=${after.engineAlive}`
      + ` pageOk=${after.pageOk} settingsOk=${after.settingsOk}`)
  }

  // Sau một kết luận xấu, engine có thể còn đang ở trạng thái thiếu plugin.
  // Dựng lại để entry kế tiếp được đo trên một cây đầy đủ, không phải trên đống đổ.
  if (verdict !== 'safe') {
    kill(engine.child)
    reboots += 1
    await sleep(1200)
    engine = await bootEngine()
    baseUrl = engine.baseUrl
  }
}

kill(engine.child)

const byVerdict = {}
for (const f of findings) (byVerdict[f.verdict] ??= []).push(f)
writeFileSync(reportPath, JSON.stringify({ total, reboots, findings }, null, 2))

console.log('\n=== KẾT QUẢ ===')
for (const verdict of ['safe', 'no-return', 'breaks-ui', 'kills-engine', 'cannot-disable']) {
  const list = byVerdict[verdict] ?? []
  console.log(`${verdict}: ${list.length}`)
  if (verdict !== 'safe') for (const f of list) console.log(`   ${f.id}  (${f.moduleName})`)
}
console.log(`\nsố lần phải khởi động lại engine: ${reboots}`)
console.log(`báo cáo đầy đủ: ${reportPath}`)
