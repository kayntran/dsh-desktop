/**
 * Năm phép đo trả lời một câu hỏi duy nhất, câu hỏi quyết định cả thiết kế của
 * plugin quản lý plugin:
 *
 *   Gọi `loader.update(id, { disabled: true })` thì thay đổi có ĐƯỢC GHI LẠI
 *   không, và ghi vào file nào?
 *
 * Vì sao không đọc code là đủ: cây plugin của app được xếp từ bốn lớp cấu hình
 * (bundle của upstream, lớp người dùng, lớp `--patch` do lớp vỏ đưa vào), và
 * `write()` của loader ghi vào tree SỞ HỮU entry — không nhất thiết là file mà
 * entry đó xuất hiện. Chỉ dấu vết trên đĩa mới nói được sự thật.
 *
 * Đo trên DSH_HOME RIÊNG (mặc định `D:\tmp\hdw-spike-dsh`), không đụng vào
 * `~/.dsh` của chủ dự án — phép đo này cố ý làm bẩn cấu hình, nên nó phải làm
 * bẩn một bản sao. Đổi chỗ bằng biến môi trường `SPIKE_DSH_HOME`.
 *
 *   npm run spike:loader
 */

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nodeExe = join(root, 'runtime', 'node.exe')
const dshBin = join(root, 'engine', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const dockDir = join(root, 'plugins', 'dock')
const dockPatch = join(dockDir, 'cordis.patch.yml')
const probeFile = join(root, 'scripts', 'spike-loader-probe.mjs')

const dshHome = process.env['SPIKE_DSH_HOME'] ?? join('D:', 'tmp', 'hdw-spike-dsh')
const profileDir = join(dshHome, 'profiles', 'web')
const profileRoot = join(profileDir, 'cordis.yml')
const profilePatch = join(profileDir, 'cordis.patch.yml')
const homePatch = join(dshHome, 'cordis.patch.yml')
const probePatch = join(dshHome, 'spike-loader-probe.cordis.yml')

const BOOT_TIMEOUT_MS = 300_000
const URL_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/m
/** Chờ loader ghi file: `write()` hoãn qua `setTimeout(…, 0)` rồi vào một hàng đợi. */
const WRITE_SETTLE_MS = 600

/**
 * Hai mục tiêu, nhận diện bằng TÊN GÓI chứ không bằng id.
 *
 * Lý do: id thật của một entry là id đầy đủ trong cây, có tiền tố của subtree
 * chứa nó (`include:ui-settings-plugin-inventory`), không phải id trần ghi trong
 * file bundle. Phép đo đầu tiên chấm FAIL toàn bộ đúng vì viết cứng id trần —
 * và đó là bài học đáng giữ: id phải hỏi loader, đừng đọc từ file cấu hình.
 */
const BUNDLE_TARGET = { pkg: '@deepseek-ai/dsh-client-ui-settings-plugin-inventory' }
/** Entry đến từ lớp phủ `--patch` của lớp vỏ — nguồn khác, phải đo riêng. */
const OVERLAY_TARGET = { pkg: 'harness-desktop-dock' }

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

function safeLstat(path) {
  try { return lstatSync(path) } catch { return undefined }
}

/** Junction để engine phân giải `harness-desktop-dock` từ thư mục profile. */
function ensureDockLink() {
  const dir = join(dshHome, 'profiles', 'node_modules')
  mkdirSync(dir, { recursive: true })
  const link = join(dir, 'harness-desktop-dock')
  const info = safeLstat(link)
  if (info?.isSymbolicLink() === true) unlinkSync(link)
  else if (info !== undefined) throw new Error(`${link} là thư mục thật — dừng lại`)
  symlinkSync(dockDir, link, 'junction')
}

/**
 * Patch tạm nạp đầu đo. `name` là URL `file://` tuyệt đối: đầu đo chỉ có nửa
 * Node nên không cần được phân giải theo tên gói.
 */
function writeProbePatch() {
  mkdirSync(dshHome, { recursive: true })
  const specifier = pathToFileURL(probeFile).href
  writeFileSync(probePatch, `- insert:\n    - id: spike-loader-probe\n      name: '${specifier}'\n`)
}

/** Nội dung file, hoặc undefined nếu không có. */
function readOrNothing(path) {
  try { return readFileSync(path, 'utf8') } catch { return undefined }
}

/** Ảnh chụp bốn file cấu hình đang có tác dụng, để so trước/sau. */
function snapshotConfigFiles() {
  const shot = {}
  for (const [label, path] of [
    ['profile cordis.yml', profileRoot],
    ['profile cordis.patch.yml', profilePatch],
    ['home cordis.patch.yml', homePatch],
    ['dock cordis.patch.yml (trong repo)', dockPatch],
  ]) {
    const text = readOrNothing(path)
    shot[label] = {
      path,
      exists: text !== undefined,
      bytes: text === undefined ? 0 : Buffer.byteLength(text),
      // Đếm dòng bắt đầu bằng `- id:` — số entry được ghi cứng vào file.
      rows: text === undefined ? 0 : (text.match(/^\s*-\s+id:/gm) ?? []).length,
      text: text ?? '',
    }
  }
  return shot
}

function diffFiles(before, after) {
  const changed = []
  for (const label of Object.keys(before)) {
    if (before[label].text !== after[label].text) {
      changed.push({
        label,
        path: before[label].path,
        from: `${before[label].bytes} bytes / ${before[label].rows} entry`,
        to: `${after[label].bytes} bytes / ${after[label].rows} entry`,
      })
    }
  }
  return changed
}

/** Khởi động engine với ĐÚNG cờ mà lớp vỏ dùng, cộng patch của đầu đo. */
function bootEngine() {
  const child = spawn(nodeExe, [
    dshBin, '--profile', 'web',
    '--patch', dockPatch,
    '--patch', probePatch,
    '--port', '0',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, DSH_HOME: dshHome },
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

/**
 * Tên gói của mọi plugin giao diện ĐANG BẬT, đọc từ `__DSH_BOOT__` của trang.
 *
 * Phải đọc đúng trường `entries[].id`, không được dò chuỗi trong cả trang: tên
 * gói của một plugin đã tắt vẫn còn nằm trong `inject` của những plugin phụ
 * thuộc nó, nên `html.includes(<tên gói>)` trả lời "vẫn bật" cho một plugin đã
 * tắt hẳn. Đã đo: tắt `ui-settings` thì `entries[].id` mất nó, `client.js` trả
 * 404, mà chuỗi tên gói vẫn xuất hiện chín chỗ trong trang.
 */
function bootEntryIds(html) {
  const match = /window\.__DSH_BOOT__\s*=\s*(\{[\s\S]*\})\s*;?\s*<\/script>/.exec(html)
  if (match === null) return []
  try {
    return JSON.parse(match[1]).entries.map((e) => e.id)
  } catch {
    return []
  }
}

/** Một phiên làm việc với engine đang chạy. */
function session(baseUrl) {
  return {
    /** Danh sách entry, lấy trực tiếp từ loader trong tiến trình engine. */
    async list() {
      const res = await fetch(`${baseUrl}/spike/loader/list`)
      if (!res.ok) throw new Error(`/spike/loader/list trả HTTP ${res.status}`)
      return (await res.json()).entries
    },
    async entry(id) {
      return (await this.list()).find((e) => e.id === id)
    },
    /** @param {'true'|'false'|'null'} disabled */
    async update(id, disabled) {
      const res = await fetch(`${baseUrl}/spike/loader/update?id=${encodeURIComponent(id)}&disabled=${disabled}`)
      return await res.json()
    },
    /**
     * Dấu vết NGOÀI của một plugin giao diện: tên gói nằm trong `__DSH_BOOT__`
     * của trang, và bundle client phục vụ được. Không phụ thuộc chữ nghĩa của
     * nhãn nào trên màn hình — đây là thứ quyết định plugin có chạy trong trình
     * duyệt hay không.
     */
    async servesClient(pkg) {
      const html = await (await fetch(`${baseUrl}/`)).text()
      const inBoot = bootEntryIds(html).includes(pkg)
      const bundle = await fetch(`${baseUrl}/plugins/${pkg}/client.js`)
      const body = await bundle.text()
      return {
        inBoot,
        // Dấu vết thứ hai, độc lập với trang: engine chỉ phục vụ bundle giao diện
        // của plugin đang bật; đã tắt thì route này trả 404.
        bundleOk: bundle.ok && body.includes('__ModuleLoader__') && !body.includes('<!doctype'),
        bundleStatus: bundle.status,
      }
    },
  }
}

function describe(entry) {
  if (entry === undefined) return 'KHÔNG CÒN TRONG CÂY'
  return `rawDisabled=${String(entry.rawDisabled)} effectiveDisabled=${String(entry.effectiveDisabled)} fiberState=${String(entry.fiberState)}`
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`node:      ${nodeExe}`)
console.log(`DSH_HOME:  ${dshHome}   (bản sao — không phải ~/.dsh của chủ dự án)`)
console.log(`đầu đo:    ${probeFile}`)
if (!existsSync(join(dockDir, 'lib', 'index.js'))) {
  console.log('\nCHÚ Ý: plugins/dock chưa build (thiếu lib/index.js). Chạy `npm run plugins:build` trước.')
  process.exit(1)
}

mkdirSync(dshHome, { recursive: true })
writeProbePatch()
ensureDockLink()

/** Ghi chép của cả hai lượt, in ra ở cuối. */
const log = { pass1: {}, pass2: {} }

// ── LƯỢT 1: engine đang chạy, đo tắt sống và dấu vết trên đĩa ────────────────
console.log('\n=== LƯỢT 1: engine #1 ===')
let engine = bootEngine()
try {
  const baseUrl = await engine.url
  console.log(`engine #1 tại ${baseUrl}`)
  const api = session(baseUrl)
  log.pass1.probeRan = engine.out().includes('spike-loader-probe: đầu đo đã chạy')
  console.log(`đầu đo chạy: ${log.pass1.probeRan ? 'có' : 'KHÔNG'}`)

  const all = await api.list()
  console.log(`tổng số entry trong cây: ${all.length}`)
  const treeFiles = new Set(all.map((e) => e.treeFile))
  console.log(`tree sở hữu entry: ${[...treeFiles].map((f) => String(f)).join(' | ')}`)
  log.pass1.total = all.length
  log.pass1.treeFiles = [...treeFiles]
  // Danh sách đầy đủ ra file: id thật của một entry lồng trong group KHÔNG phải
  // id ghi trong bundle, và không có cách nào biết ngoài việc hỏi loader.
  writeFileSync(join(dshHome, 'entries.json'), JSON.stringify(all, null, 2))
  console.log(`danh sách đầy đủ: ${join(dshHome, 'entries.json')}`)
  for (const e of all) {
    if (e.id.includes('inventory') || e.id.includes('dock') || e.moduleName.includes('inventory') || e.moduleName.includes('dock')) {
      console.log(`   ứng viên: id=${e.id}  name=${e.moduleName}  group=${e.group}  tree=${String(e.treeFile)}`)
    }
  }

  // Tra id thật của hai mục tiêu, theo tên gói.
  for (const target of [BUNDLE_TARGET, OVERLAY_TARGET]) {
    const found = all.find((e) => e.moduleName === target.pkg)
    if (found === undefined) throw new Error(`không thấy entry nào có name="${target.pkg}" trong cây`)
    target.id = found.id
  }
  console.log(`mục tiêu bundle:   ${BUNDLE_TARGET.id}`)
  console.log(`mục tiêu lớp phủ:  ${OVERLAY_TARGET.id}`)

  log.pass1.bundleBefore = await api.entry(BUNDLE_TARGET.id)
  log.pass1.overlayBefore = await api.entry(OVERLAY_TARGET.id)
  console.log(`${BUNDLE_TARGET.id} trước: ${describe(log.pass1.bundleBefore)}`)
  console.log(`${OVERLAY_TARGET.id} trước: ${describe(log.pass1.overlayBefore)}`)

  const filesBefore = snapshotConfigFiles()
  log.pass1.rowsBefore = filesBefore['profile cordis.yml'].rows

  // ── PHÉP 1: tắt sống được không ──
  log.pass1.servesBundleBefore = await api.servesClient(BUNDLE_TARGET.pkg)
  log.pass1.disableBundle = await api.update(BUNDLE_TARGET.id, 'true')
  console.log(`\ntắt ${BUNDLE_TARGET.id}: ${JSON.stringify(log.pass1.disableBundle.ok)} (${log.pass1.disableBundle.ms}ms)`)
  if (log.pass1.disableBundle.ok !== true) console.log(`   lý do: ${log.pass1.disableBundle.reason}`)
  log.pass1.bundleAfterDisable = await api.entry(BUNDLE_TARGET.id)
  log.pass1.servesBundleAfter = await api.servesClient(BUNDLE_TARGET.pkg)
  console.log(`${BUNDLE_TARGET.id} sau khi tắt: ${describe(log.pass1.bundleAfterDisable)}`)
  console.log(`   nửa giao diện: trước inBoot=${log.pass1.servesBundleBefore.inBoot} → sau inBoot=${log.pass1.servesBundleAfter.inBoot}`)

  // ── PHÉP 3: dấu vết trên đĩa ──
  await sleep(WRITE_SETTLE_MS)
  const filesAfter = snapshotConfigFiles()
  log.pass1.changed = diffFiles(filesBefore, filesAfter)
  console.log(`\nfile bị sửa sau một lần tắt: ${log.pass1.changed.length === 0 ? 'KHÔNG CÓ' : ''}`)
  for (const c of log.pass1.changed) console.log(`   ${c.label}: ${c.from} → ${c.to}\n      ${c.path}`)
  log.pass1.rowsAfter = filesAfter['profile cordis.yml'].rows
  // Có ghi cứng entry vào file gốc không, và dòng của mục tiêu trông thế nào.
  const target = filesAfter['profile cordis.yml'].text.split('\n')
    .findIndex((line) => line.includes(BUNDLE_TARGET.id))
  log.pass1.targetRowInRoot = target >= 0
    ? filesAfter['profile cordis.yml'].text.split('\n').slice(target, target + 4).join('\n')
    : undefined

  // ── PHÉP 5: bật lại được không ──
  log.pass1.enableBundle = await api.update(BUNDLE_TARGET.id, 'null')
  log.pass1.bundleAfterEnable = await api.entry(BUNDLE_TARGET.id)
  log.pass1.servesBundleBack = await api.servesClient(BUNDLE_TARGET.pkg)
  console.log(`\nbật lại ${BUNDLE_TARGET.id} (disabled=null): ok=${log.pass1.enableBundle.ok}`)
  console.log(`   ${describe(log.pass1.bundleAfterEnable)}`)
  console.log(`   nửa giao diện trở lại: inBoot=${log.pass1.servesBundleBack.inBoot} bundleOk=${log.pass1.servesBundleBack.bundleOk}`)

  // ── PHÉP 4: entry đến từ lớp phủ `--patch` ──
  log.pass1.servesOverlayBefore = await api.servesClient(OVERLAY_TARGET.pkg)
  log.pass1.disableOverlay = await api.update(OVERLAY_TARGET.id, 'true')
  log.pass1.overlayAfterDisable = await api.entry(OVERLAY_TARGET.id)
  log.pass1.servesOverlayAfter = await api.servesClient(OVERLAY_TARGET.pkg)
  console.log(`\ntắt ${OVERLAY_TARGET.id} (entry của lớp phủ): ok=${log.pass1.disableOverlay.ok}`)
  console.log(`   ${describe(log.pass1.overlayAfterDisable)}`)
  console.log(`   nửa giao diện: trước inBoot=${log.pass1.servesOverlayBefore.inBoot} → sau inBoot=${log.pass1.servesOverlayAfter.inBoot}`)

  // Trạng thái mang sang lượt 2: TẮT cả hai, mỗi cái một nguồn khác nhau.
  await api.update(BUNDLE_TARGET.id, 'true')
  await sleep(WRITE_SETTLE_MS)
  const filesEnd = snapshotConfigFiles()
  log.pass1.endRows = filesEnd['profile cordis.yml'].rows
  log.pass1.endBytes = filesEnd['profile cordis.yml'].bytes
  log.pass1.endPatchRows = filesEnd['profile cordis.patch.yml'].rows
  console.log(`\ntrước khi tắt engine #1: cordis.yml = ${log.pass1.endBytes} bytes / ${log.pass1.endRows} entry;`
    + ` cordis.patch.yml = ${filesEnd['profile cordis.patch.yml'].bytes} bytes / ${log.pass1.endPatchRows} entry`)
  log.pass1.ok = true
} catch (error) {
  console.log(`\nLƯỢT 1 KHÔNG CHẠY ĐƯỢC: ${error.message}`)
  console.log(engine.err().slice(-3000))
  log.pass1.error = error.message
} finally {
  kill(engine.child)
}

// ── LƯỢT 2: khởi động lại với ĐÚNG cờ cũ — trạng thái tắt có sống sót không ──
if (log.pass1.ok === true) {
  console.log('\n=== LƯỢT 2: engine #2, cùng cờ, sau khi đã tắt hai plugin ===')
  await sleep(1500)
  engine = bootEngine()
  try {
    const baseUrl = await engine.url
    console.log(`engine #2 tại ${baseUrl}`)
    const api = session(baseUrl)
    const all = await api.list()
    log.pass2.total = all.length
    log.pass2.bundle = await api.entry(BUNDLE_TARGET.id)
    log.pass2.overlay = await api.entry(OVERLAY_TARGET.id)
    log.pass2.servesBundle = await api.servesClient(BUNDLE_TARGET.pkg)
    log.pass2.servesOverlay = await api.servesClient(OVERLAY_TARGET.pkg)
    const files = snapshotConfigFiles()
    log.pass2.rows = files['profile cordis.yml'].rows
    log.pass2.bytes = files['profile cordis.yml'].bytes
    console.log(`tổng số entry: ${log.pass2.total} (lượt 1: ${log.pass1.total})`)
    console.log(`${BUNDLE_TARGET.id}: ${describe(log.pass2.bundle)}  → inBoot=${log.pass2.servesBundle.inBoot}`)
    console.log(`${OVERLAY_TARGET.id}: ${describe(log.pass2.overlay)}  → inBoot=${log.pass2.servesOverlay.inBoot}`)
    console.log(`cordis.yml sau khi boot lại: ${log.pass2.bytes} bytes / ${log.pass2.rows} entry`)
    log.pass2.ok = true
  } catch (error) {
    console.log(`\nLƯỢT 2 KHÔNG CHẠY ĐƯỢC: ${error.message}`)
    console.log(engine.err().slice(-3000))
    log.pass2.error = error.message
  } finally {
    kill(engine.child)
  }
}

// ── ĐƯỜNG THỨ HAI: ghi patch vào lớp cấu hình của người dùng ─────────────────
//
// Phép 2 đã cho kết quả xấu, nên đường còn lại là tự lưu trạng thái vào một lớp
// patch. Ba câu hỏi nối tiếp, và câu trả lời quyết định plugin quản lý ghi vào
// đâu:
//   7. patch trong `cordis.patch.yml` có áp NGAY khi engine đang chạy không?
//   9. nó có tắt được entry do lớp phủ `--patch` chèn vào không?
//  10. nếu không, một `--patch` riêng đứng SAU lớp phủ của dock thì được không?

/** Id trần trong file cấu hình: id đầy đủ trừ tiền tố subtree. */
const bareId = (id) => id.split(':').pop()

/** Chờ tới `limitMs` cho tới khi tên gói biến khỏi (hoặc trở lại) `__DSH_BOOT__`. */
async function waitForBoot(api, pkg, expected, limitMs = 20_000) {
  const deadline = Date.now() + limitMs
  for (;;) {
    const seen = (await api.servesClient(pkg)).inBoot
    if (seen === expected) return { reached: true, ms: limitMs - (deadline - Date.now()) }
    if (Date.now() >= deadline) return { reached: false, ms: limitMs }
    await sleep(1000)
  }
}

const statePatch = join(dshHome, 'plugin-state.cordis.yml')

if (log.pass2.ok === true) {
  console.log('\n=== LƯỢT 3: patch của người dùng, áp lúc engine đang chạy ===')
  await sleep(1500)
  engine = bootEngine()
  try {
    const baseUrl = await engine.url
    const api = session(baseUrl)
    console.log(`engine #3 tại ${baseUrl}`)

    // 7. Lớp người dùng, nhắm entry của BUNDLE.
    writeFileSync(profilePatch, `- id: ${bareId(BUNDLE_TARGET.id)}\n  disabled: true\n`)
    log.pass3 = { bundleLive: await waitForBoot(api, BUNDLE_TARGET.pkg, false) }
    log.pass3.bundleEntry = await api.entry(BUNDLE_TARGET.id)
    console.log(`sau khi ghi cordis.patch.yml (${bareId(BUNDLE_TARGET.id)}): áp sống=${log.pass3.bundleLive.reached}`
      + ` sau ~${log.pass3.bundleLive.ms}ms — ${describe(log.pass3.bundleEntry)}`)

    // 9. Cùng cách, nhưng nhắm entry do lớp phủ `--patch` chèn vào.
    writeFileSync(profilePatch,
      `- id: ${bareId(BUNDLE_TARGET.id)}\n  disabled: true\n- id: ${bareId(OVERLAY_TARGET.id)}\n  disabled: true\n`)
    log.pass3.overlayLive = await waitForBoot(api, OVERLAY_TARGET.pkg, false, 15_000)
    log.pass3.overlayEntry = await api.entry(OVERLAY_TARGET.id)
    console.log(`sau khi thêm dòng cho ${bareId(OVERLAY_TARGET.id)}: áp sống=${log.pass3.overlayLive.reached}`
      + ` — ${describe(log.pass3.overlayEntry)}`)
    // Cảnh báo của loader là bằng chứng trực tiếp cho việc patch không tìm thấy dòng.
    log.pass3.notFoundWarning = /patch: entry .*not found/.test(engine.out() + engine.err())
    console.log(`loader có cảnh báo "entry not found": ${log.pass3.notFoundWarning ? 'CÓ' : 'không'}`)
    log.pass3.ok = true
  } catch (error) {
    console.log(`\nLƯỢT 3 KHÔNG CHẠY ĐƯỢC: ${error.message}`)
    console.log(engine.err().slice(-2000))
    log.pass3 = { ...log.pass3, error: error.message }
  } finally {
    kill(engine.child)
  }

  console.log('\n=== LƯỢT 4: khởi động lại, patch của người dùng còn nguyên trên đĩa ===')
  await sleep(1500)
  engine = bootEngine()
  try {
    const baseUrl = await engine.url
    const api = session(baseUrl)
    console.log(`engine #4 tại ${baseUrl}`)
    log.pass4 = {
      bundle: await api.entry(BUNDLE_TARGET.id),
      overlay: await api.entry(OVERLAY_TARGET.id),
      servesBundle: await api.servesClient(BUNDLE_TARGET.pkg),
      servesOverlay: await api.servesClient(OVERLAY_TARGET.pkg),
      ok: true,
    }
    console.log(`${BUNDLE_TARGET.id}: ${describe(log.pass4.bundle)} → inBoot=${log.pass4.servesBundle.inBoot}`)
    console.log(`${OVERLAY_TARGET.id}: ${describe(log.pass4.overlay)} → inBoot=${log.pass4.servesOverlay.inBoot}`)
  } catch (error) {
    console.log(`\nLƯỢT 4 KHÔNG CHẠY ĐƯỢC: ${error.message}`)
    log.pass4 = { error: error.message }
  } finally {
    kill(engine.child)
  }

  console.log('\n=== LƯỢT 5: một lớp `--patch` riêng, đứng SAU lớp phủ của dock ===')
  // Dọn lớp người dùng để lượt này chỉ đo đúng một thứ.
  writeFileSync(profilePatch, '[]\n')
  writeFileSync(statePatch, `- id: ${bareId(OVERLAY_TARGET.id)}\n  disabled: true\n`)
  await sleep(1500)
  {
    const child = spawn(nodeExe, [
      dshBin, '--profile', 'web',
      '--patch', dockPatch,
      '--patch', probePatch,
      '--patch', statePatch,
      '--port', '0',
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, DSH_HOME: dshHome } })
    let out = ''
    try {
      const baseUrl = await new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('quá hạn chờ')), BOOT_TIMEOUT_MS)
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (chunk) => {
          out += chunk
          const match = URL_LINE.exec(out)
          if (match) { clearTimeout(timer); res(match[1]) }
        })
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', () => {})
        child.on('exit', (code) => { clearTimeout(timer); rej(new Error(`engine thoát sớm với mã ${code}`)) })
      })
      const api = session(baseUrl)
      console.log(`engine #5 tại ${baseUrl}`)
      log.pass5 = {
        overlay: await api.entry(OVERLAY_TARGET.id),
        servesOverlay: await api.servesClient(OVERLAY_TARGET.pkg),
        servesBundle: await api.servesClient(BUNDLE_TARGET.pkg),
        ok: true,
      }
      console.log(`${OVERLAY_TARGET.id}: ${describe(log.pass5.overlay)} → inBoot=${log.pass5.servesOverlay.inBoot}`)
      console.log(`${BUNDLE_TARGET.id} (không bị nhắm): inBoot=${log.pass5.servesBundle.inBoot}`)
    } catch (error) {
      console.log(`\nLƯỢT 5 KHÔNG CHẠY ĐƯỢC: ${error.message}`)
      log.pass5 = { error: error.message }
    } finally {
      kill(child)
    }
  }
}

// ── Chấm điểm ────────────────────────────────────────────────────────────────
console.log('\n=== NĂM PHÉP ĐO ===')

if (log.pass1.ok !== true) {
  record('0. engine lên được với đầu đo', false, log.pass1.error)
} else {
  record('0. engine lên được với đầu đo', log.pass1.probeRan === true,
    `${log.pass1.total} entry trong cây`)

  const p1 = log.pass1.disableBundle.ok === true
    && log.pass1.bundleAfterDisable?.effectiveDisabled === true
    && log.pass1.servesBundleBefore.inBoot === true
    && log.pass1.servesBundleAfter.inBoot === false
  record('1. tắt sống được, không cần khởi động lại', p1,
    `nửa giao diện trong __DSH_BOOT__: ${log.pass1.servesBundleBefore.inBoot} → ${log.pass1.servesBundleAfter.inBoot}`)

  const p5 = log.pass1.enableBundle.ok === true
    && log.pass1.bundleAfterEnable?.effectiveDisabled === false
    && log.pass1.servesBundleBack.inBoot === true
    && log.pass1.servesBundleBack.bundleOk === true
  record('5. bật lại sống lại, không cần khởi động lại', p5,
    `inBoot=${log.pass1.servesBundleBack.inBoot} bundleOk=${log.pass1.servesBundleBack.bundleOk}`)

  const p3 = log.pass1.changed.length > 0
  record('3. có ghi ra đĩa', p3, p3
    ? log.pass1.changed.map((c) => `${c.label} (${c.from} → ${c.to})`).join('; ')
    : 'không file nào bị sửa — trạng thái chỉ nằm trong bộ nhớ')

  const p4 = log.pass1.disableOverlay.ok === true
    && log.pass1.overlayAfterDisable?.effectiveDisabled === true
    && log.pass1.servesOverlayAfter.inBoot === false
  record('4a. entry của lớp phủ --patch tắt sống được', p4,
    `inBoot: ${log.pass1.servesOverlayBefore.inBoot} → ${log.pass1.servesOverlayAfter.inBoot}`)
}

if (log.pass2.ok === true) {
  const bundleStuck = log.pass2.bundle?.effectiveDisabled === true
  const overlayStuck = log.pass2.overlay?.effectiveDisabled === true
  record('2. trạng thái tắt sống sót qua khởi động lại (entry bundle)', bundleStuck,
    bundleStuck ? 'vẫn tắt' : `BẬT LẠI — ${describe(log.pass2.bundle)}`)
  record('4b. trạng thái tắt sống sót qua khởi động lại (entry lớp phủ)', overlayStuck,
    overlayStuck ? 'vẫn tắt' : `BẬT LẠI — ${describe(log.pass2.overlay)}`)
  record('6. cây không bị nhân đôi sau khi boot lại', log.pass2.total === log.pass1.total,
    `${log.pass1.total} → ${log.pass2.total} entry; cordis.yml ${log.pass1.endBytes} → ${log.pass2.bytes} bytes`)
} else if (log.pass1.ok === true) {
  record('2. trạng thái tắt sống sót qua khởi động lại', false, log.pass2.error ?? 'lượt 2 không chạy')
}

if (log.pass3?.ok === true) {
  record('7. patch trong cordis.patch.yml áp NGAY, không cần khởi động lại', log.pass3.bundleLive.reached,
    `${BUNDLE_TARGET.pkg} biến khỏi __DSH_BOOT__ sau ~${log.pass3.bundleLive.ms}ms`)
  record('9a. patch của người dùng tắt được entry do --patch chèn', log.pass3.overlayLive.reached,
    log.pass3.overlayLive.reached ? 'tắt được' : 'KHÔNG — lớp người dùng nằm DƯỚI lớp phủ nên không thấy dòng đó')
}
if (log.pass4?.ok === true) {
  record('8. patch trong cordis.patch.yml sống sót qua khởi động lại', log.pass4.bundle?.effectiveDisabled === true,
    `inBoot=${log.pass4.servesBundle.inBoot}`)
  record('9b. sau khởi động lại, entry của lớp phủ có tắt theo patch người dùng không',
    log.pass4.overlay?.effectiveDisabled === true,
    log.pass4.overlay?.effectiveDisabled === true ? 'tắt' : 'VẪN BẬT — xác nhận thứ tự lớp')
}
if (log.pass5?.ok === true) {
  record('10. `--patch` riêng đứng SAU lớp phủ dock tắt được entry của dock',
    log.pass5.overlay?.effectiveDisabled === true,
    `hdw-dock inBoot=${log.pass5.servesOverlay.inBoot}; entry không bị nhắm vẫn chạy: inBoot=${log.pass5.servesBundle.inBoot}`)
}

console.log('\n=== KẾT QUẢ ===')
const failed = results.filter((r) => !r.ok)
if (failed.length === 0) {
  console.log('Cả năm phép đều đạt.')
} else {
  console.log(`${failed.length}/${results.length} mục KHÔNG đạt:`)
  for (const f of failed) console.log(`   ${f.name} — ${f.detail}`)
}
console.log('\nMột mục không đạt ở đây KHÔNG phải lỗi cần sửa — nó là một sự thật về engine,')
console.log('và nó quyết định plugin quản lý phải tự lưu trạng thái hay dựa vào loader.')
if (log.pass1.targetRowInRoot !== undefined) {
  console.log(`\nDòng của ${BUNDLE_TARGET.id} bị ghi cứng vào cordis.yml:\n${log.pass1.targetRowInRoot}`)
}
// Spike này báo cáo sự thật đo được; nó không phán "đạt/không đạt" cho cả bộ.
process.exit(0)
