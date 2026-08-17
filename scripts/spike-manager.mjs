/**
 * Nghiệm thu công tắc bật/tắt plugin, đo trên ĐÚNG đường mà giao diện đi:
 * hai route HTTP của plugin, ba lớp `--patch` như lớp vỏ truyền, và một lần khởi
 * động lại engine thật.
 *
 * Bốn câu hỏi, và chúng được đo bằng dấu vết chứ không bằng lời văn:
 *
 *   1. Tắt một plugin → tính năng của nó biến mất thật (bundle giao diện của nó
 *      không còn được phục vụ, tên nó rời khỏi danh sách plugin đang chạy).
 *   2. Bật lại → sống lại, không cần khởi động lại.
 *   3. Khởi động lại engine → trạng thái đúng như đã đặt. Đây là câu mà loader
 *      của engine tự nó KHÔNG trả lời được, và là lý do plugin này tồn tại.
 *   4. Ba lớp bảo vệ có thật: plugin khoá bị từ chối ngay ở nửa Node, kể cả khi
 *      request được gửi tay chứ không qua giao diện.
 *
 * Chạy trên DSH_HOME riêng (`D:\tmp\hdw-spike-dsh` theo mặc định), không đụng
 * vào `~/.dsh` của chủ dự án.
 *
 *   npm run spike:manager
 */

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nodeExe = join(root, 'runtime', 'node.exe')
const dshBin = join(root, 'engine', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const dockDir = join(root, 'plugins', 'dock')
const managerDir = join(root, 'plugins', 'plugin-manager')
const dockPatch = join(dockDir, 'cordis.patch.yml')
const managerPatch = join(managerDir, 'cordis.patch.yml')

const dshHome = process.env['SPIKE_DSH_HOME'] ?? join('D:', 'tmp', 'hdw-spike-dsh')
const statePath = join(dshHome, 'harness-desktop-plugins.cordis.yml')

const BOOT_TIMEOUT_MS = 300_000
const URL_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/m

/** Plugin của chính dự án này — nhóm "gạt tự do", và có nửa giao diện để đo. */
const OURS = { pkg: 'harness-desktop-dock', bareId: 'hdw-dock' }
/** Plugin lõi vô hại, có nửa giao diện: tab danh sách plugin chỉ-đọc của upstream. */
const CORE = { pkg: '@deepseek-ai/dsh-client-ui-settings-plugin-inventory', bareId: 'ui-settings-plugin-inventory' }
/** Plugin bị khoá bởi phép đo `npm run spike:guard` — tắt là mất đường vào Cài đặt. */
const LOCKED_PKG = '@deepseek-ai/dsh-client-ui-settings-plugins'

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

function safeLstat(path) {
  try { return lstatSync(path) } catch { return undefined }
}

/** Junction cho cả hai plugin, đúng như `src/main/plugin-link.ts` dựng. */
function ensureJunctions() {
  const dir = join(dshHome, 'profiles', 'node_modules')
  mkdirSync(dir, { recursive: true })
  for (const [name, target] of [['harness-desktop-dock', dockDir], ['harness-desktop-plugin-manager', managerDir]]) {
    const link = join(dir, name)
    const info = safeLstat(link)
    if (info?.isSymbolicLink() === true) unlinkSync(link)
    else if (info !== undefined) throw new Error(`${link} là thư mục thật — dừng lại`)
    symlinkSync(target, link, 'junction')
  }
}

/** Khởi động engine với BA lớp patch, đúng thứ tự lớp vỏ dùng. */
function bootEngine() {
  const child = spawn(nodeExe, [
    dshBin, '--profile', 'web',
    '--patch', dockPatch,
    '--patch', managerPatch,
    '--patch', statePath,
    '--port', '0',
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, DSH_HOME: dshHome } })
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
  return { child, url, err: () => stderr }
}

function kill(child) {
  try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* đã chết */ }
}

/** Tên gói của mọi plugin giao diện ĐANG BẬT, đọc từ `__DSH_BOOT__` của trang. */
function bootEntryIds(html) {
  const match = /window\.__DSH_BOOT__\s*=\s*(\{[\s\S]*\})\s*;?\s*<\/script>/.exec(html)
  if (match === null) return []
  try {
    return JSON.parse(match[1]).entries.map((e) => e.id)
  } catch {
    return []
  }
}

/** Một phiên làm việc với engine đang chạy, chỉ qua route công khai của plugin. */
function session(baseUrl) {
  return {
    async list() {
      const res = await fetch(`${baseUrl}/hdw/plugins/list`)
      if (!res.ok) throw new Error(`/hdw/plugins/list trả HTTP ${res.status}`)
      return await res.json()
    },
    async byPkg(pkg) {
      return (await this.list()).entries.find((e) => e.moduleName === pkg)
    },
    async toggle(entryId, enabled) {
      const res = await fetch(`${baseUrl}/hdw/plugins/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entryId, enabled }),
      })
      return { status: res.status, body: await res.json() }
    },
    /**
     * Hai dấu vết độc lập cho "plugin này đang chạy trong trình duyệt hay không".
     * Không dò chữ trên màn hình: đọc đúng trường `entries[].id` của manifest, và
     * hỏi engine xem nó còn phục vụ bundle giao diện của gói đó không.
     */
    async alive(pkg) {
      const html = await (await fetch(`${baseUrl}/`)).text()
      const bundle = await fetch(`${baseUrl}/plugins/${pkg}/client.js`)
      return { inBoot: bootEntryIds(html).includes(pkg), bundleStatus: bundle.status }
    },
  }
}

/** Chờ dấu vết đổi, vì trang được dựng lại một nhịp sau khi loader gạt xong. */
async function waitAlive(api, pkg, expected, limitMs = 10_000) {
  const deadline = Date.now() + limitMs
  for (;;) {
    const seen = await api.alive(pkg)
    if (seen.inBoot === expected && (seen.bundleStatus === 200) === expected) return seen
    if (Date.now() >= deadline) return seen
    await sleep(250)
  }
}

/** Lựa chọn đã lưu trên đĩa, đọc lại bằng mắt của bộ kiểm chứ không nhờ plugin. */
function stateFileIds() {
  try {
    const text = readFileSync(statePath, 'utf8')
    return [...text.matchAll(/^-\s+id:\s*(\S+)\s*\n\s+disabled:\s*(true|false)\s*$/gm)]
      .map((m) => `${m[1]}=${m[2]}`)
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`DSH_HOME:  ${dshHome}   (bản sao, không phải ~/.dsh)`)
for (const [label, path] of [['plugins/dock', join(dockDir, 'lib', 'index.js')], ['plugins/plugin-manager', join(managerDir, 'lib', 'index.js')]]) {
  if (!existsSync(path)) {
    console.log(`\nCHÚ Ý: ${label} chưa build. Chạy \`npm run plugins:build\` trước.`)
    process.exit(1)
  }
}
mkdirSync(dshHome, { recursive: true })
// Bắt đầu từ trạng thái mặc định: không plugin nào bị tắt.
rmSync(statePath, { force: true })
writeFileSync(statePath, '[]\n')
ensureJunctions()

const log = {}

// ── LƯỢT 1: tắt và bật qua đúng route mà giao diện gọi ───────────────────────
console.log('\n=== LƯỢT 1: engine #1 ===')
let engine = bootEngine()
try {
  const baseUrl = await engine.url
  const api = session(baseUrl)
  console.log(`engine #1 tại ${baseUrl}`)

  // Nửa giao diện của CHÍNH plugin này có được phục vụ không, và bản dựng có
  // thật sự đăng ký vào slot tab Plugins không.
  //
  // Mục kiểm này tồn tại vì bài học đắt nhất của dự án: sáu mươi mục kiểm xanh
  // trong khi thứ cần hiện ra không bao giờ hiện, vì mọi mục đều hỏi "hàm trả về
  // gì" mà không hỏi "có ai gọi nó không". Route chạy đúng mà nửa giao diện không
  // được phục vụ thì công tắc không tồn tại với người dùng.
  log.selfAlive = await api.alive('harness-desktop-plugin-manager')
  const selfBundle = await (await fetch(`${baseUrl}/plugins/harness-desktop-plugin-manager/client.js`)).text()
  log.selfRegistersTab = selfBundle.includes('settings.plugins.tab')
  console.log(`nửa giao diện của công tắc: inBoot=${log.selfAlive.inBoot}`
    + ` client.js=${log.selfAlive.bundleStatus} đăng ký slot tab=${log.selfRegistersTab}`)

  const listing = await api.list()
  log.total = listing.entries.length
  log.statePath = listing.statePath
  console.log(`nửa Node trả về ${log.total} dòng plugin; file trạng thái: ${log.statePath}`)
  log.statePathMatches = listing.statePath === statePath

  const ours = await api.byPkg(OURS.pkg)
  const core = await api.byPkg(CORE.pkg)
  const locked = await api.byPkg(LOCKED_PKG)
  log.oursGroup = ours?.ours === true
  log.coreGroup = core?.ours === false
  log.lockedFlag = locked?.locked === true
  console.log(`phân nhóm: ${OURS.pkg} ours=${String(ours?.ours)}; ${CORE.pkg} ours=${String(core?.ours)}`)
  console.log(`plugin khoá: ${LOCKED_PKG} locked=${String(locked?.locked)} lý do=${String(locked?.lockReason)}`)

  // 1. Tắt plugin của chính ta → tính năng biến mất thật.
  log.aliveBefore = await api.alive(OURS.pkg)
  const off = await api.toggle(ours.entryId, false)
  log.offOk = off.status === 200 && off.body.saved === true
  log.aliveAfterOff = await waitAlive(api, OURS.pkg, false)
  console.log(`\ntắt ${OURS.pkg}: HTTP ${off.status} saved=${String(off.body.saved)}`)
  console.log(`   inBoot ${log.aliveBefore.inBoot} → ${log.aliveAfterOff.inBoot};`
    + ` client.js ${log.aliveBefore.bundleStatus} → ${log.aliveAfterOff.bundleStatus}`)
  log.stateAfterOff = stateFileIds()
  console.log(`   file trạng thái nay ghi: ${JSON.stringify(log.stateAfterOff)}`)

  // 2. Bật lại → sống lại ngay.
  const on = await api.toggle(ours.entryId, true)
  log.onOk = on.status === 200 && on.body.saved === true
  log.aliveAfterOn = await waitAlive(api, OURS.pkg, true)
  console.log(`\nbật lại: HTTP ${on.status} saved=${String(on.body.saved)}`)
  console.log(`   inBoot=${log.aliveAfterOn.inBoot} client.js=${log.aliveAfterOn.bundleStatus}`)
  log.stateAfterOn = stateFileIds()
  console.log(`   file trạng thái nay ghi: ${JSON.stringify(log.stateAfterOn)}`)

  // 4. Rào ở nửa Node: gửi tay một request tắt plugin bị khoá.
  const refused = await api.toggle(locked.entryId, false)
  log.refusedStatus = refused.status
  log.refusedReason = refused.body.lockReason
  log.lockedStillAlive = await api.alive(LOCKED_PKG)
  console.log(`\ngửi tay lệnh tắt ${LOCKED_PKG}: HTTP ${refused.status} lý do=${String(refused.body.lockReason)}`)
  console.log(`   nó vẫn chạy: inBoot=${log.lockedStillAlive.inBoot} client.js=${log.lockedStillAlive.bundleStatus}`)

  // Hướng NGƯỢC LẠI, và nó là hướng dễ hỏng hơn: bật một dòng mà bộ cấu hình
  // web của upstream đã tắt sẵn. Bản đầu chỉ lưu danh sách "cần tắt", nên bật
  // một dòng như vậy chỉ là xoá nó khỏi danh sách — lớp bundle bên dưới vẫn nói
  // "tắt", và mở lại app là nó tắt lại. Lỗi này lộ ra trên trang thật, không có
  // mục kiểm HTTP nào bắt được nó.
  const offByDefault = (await api.list()).entries
    .find((e) => !e.enabled && !e.locked)
  log.bundleOffTarget = offByDefault?.bareId
  if (offByDefault !== undefined) {
    const turnOn = await api.toggle(offByDefault.entryId, true)
    log.bundleOffTurnedOn = turnOn.status === 200 && turnOn.body.entry.enabled === true
    log.bundleOffPhase = turnOn.body.entry.fiberPhase
    console.log(`\nbật dòng mà bundle tắt sẵn (${offByDefault.bareId}):`
      + ` HTTP ${turnOn.status} enabled=${String(turnOn.body.entry.enabled)} phase=${String(turnOn.body.entry.fiberPhase)}`)
    console.log(`   file trạng thái nay ghi: ${JSON.stringify(stateFileIds())}`)
  }

  // Trạng thái mang sang lượt 2: tắt MỘT plugin của ta và MỘT plugin lõi.
  await api.toggle(ours.entryId, false)
  await api.toggle(core.entryId, false)
  await waitAlive(api, CORE.pkg, false)
  log.stateBeforeRestart = stateFileIds()
  console.log(`\ntrước khi tắt engine, file trạng thái ghi: ${JSON.stringify(log.stateBeforeRestart)}`)
  log.pass1 = true
} catch (error) {
  console.log(`\nLƯỢT 1 KHÔNG CHẠY ĐƯỢC: ${error.message}`)
  console.log(engine.err().slice(-3000))
} finally {
  kill(engine.child)
}

// ── LƯỢT 2: khởi động lại — câu hỏi mà loader tự nó không trả lời được ───────
if (log.pass1 === true) {
  console.log('\n=== LƯỢT 2: engine #2, cùng ba lớp patch ===')
  await sleep(1500)
  engine = bootEngine()
  try {
    const baseUrl = await engine.url
    const api = session(baseUrl)
    console.log(`engine #2 tại ${baseUrl}`)
    log.oursAfterRestart = await api.alive(OURS.pkg)
    log.coreAfterRestart = await api.alive(CORE.pkg)
    const ours = await api.byPkg(OURS.pkg)
    const core = await api.byPkg(CORE.pkg)
    console.log(`${OURS.pkg}: enabled=${String(ours?.enabled)} inBoot=${log.oursAfterRestart.inBoot}`
      + ` client.js=${log.oursAfterRestart.bundleStatus}`)
    console.log(`${CORE.pkg}: enabled=${String(core?.enabled)} inBoot=${log.coreAfterRestart.inBoot}`
      + ` client.js=${log.coreAfterRestart.bundleStatus}`)

    // Bật lại cả hai để kết thúc ở trạng thái sạch, và để đo luôn đường bật sau
    // khởi động lại — thứ người dùng làm ngay sau khi thấy mình tắt lỡ tay.
    if (ours !== undefined) await api.toggle(ours.entryId, true)
    if (core !== undefined) await api.toggle(core.entryId, true)
    // Dòng mà bundle tắt sẵn: người dùng đã bật ở lượt trước, giờ nó phải còn bật
    // VÀ đang chạy thật (fiber active), không chỉ "được ghi là bật".
    if (log.bundleOffTarget !== undefined) {
      const revived = (await api.list()).entries.find((e) => e.bareId === log.bundleOffTarget)
      log.bundleOffAfterRestart = { enabled: revived?.enabled, phase: revived?.fiberPhase }
      console.log(`dòng bundle tắt sẵn (${log.bundleOffTarget}) sau khởi động lại:`
        + ` enabled=${String(revived?.enabled)} phase=${String(revived?.fiberPhase)}`)
    }

    log.recovered = await waitAlive(api, OURS.pkg, true)
    log.stateAfterRecover = stateFileIds()
    console.log(`\nbật lại cả hai: ${OURS.pkg} inBoot=${log.recovered.inBoot}`
      + ` client.js=${log.recovered.bundleStatus}; file trạng thái: ${JSON.stringify(log.stateAfterRecover)}`)
    log.pass2 = true
  } catch (error) {
    console.log(`\nLƯỢT 2 KHÔNG CHẠY ĐƯỢC: ${error.message}`)
    console.log(engine.err().slice(-3000))
  } finally {
    kill(engine.child)
  }
}

// ── Chấm điểm ────────────────────────────────────────────────────────────────
console.log('\n=== NGHIỆM THU ===')
if (log.pass1 !== true) {
  record('0. engine lên được với ba lớp patch', false, 'xem log ở trên')
} else {
  record('0. engine lên được với ba lớp patch', true, `${log.total} dòng plugin`)
  record('1. lớp vỏ và plugin đồng ý về chỗ lưu trạng thái', log.statePathMatches,
    log.statePathMatches ? statePath : `plugin nói ${log.statePath}, bộ kiểm chờ ${statePath}`)
  record('2. phân nhóm đúng: của ta / của DeepSeek', log.oursGroup && log.coreGroup,
    `ours=${String(log.oursGroup)} core=${String(log.coreGroup)}`)
  record('2b. nửa giao diện của công tắc được phục vụ và có đăng ký tab',
    log.selfAlive.inBoot === true && log.selfAlive.bundleStatus === 200 && log.selfRegistersTab,
    `inBoot=${log.selfAlive.inBoot} client.js=${log.selfAlive.bundleStatus} slot=${log.selfRegistersTab}`)

  const disappeared = log.aliveBefore.inBoot === true && log.aliveBefore.bundleStatus === 200
    && log.aliveAfterOff.inBoot === false && log.aliveAfterOff.bundleStatus === 404
  record('3. tắt → tính năng biến mất thật, không cần khởi động lại', log.offOk && disappeared,
    `inBoot ${log.aliveBefore.inBoot}→${log.aliveAfterOff.inBoot}, client.js ${log.aliveBefore.bundleStatus}→${log.aliveAfterOff.bundleStatus}`)
  record('4. tắt → có ghi xuống file trạng thái', log.stateAfterOff.includes(`${OURS.bareId}=true`),
    JSON.stringify(log.stateAfterOff))

  const revived = log.aliveAfterOn.inBoot === true && log.aliveAfterOn.bundleStatus === 200
  record('5. bật lại → sống lại ngay', log.onOk && revived,
    `inBoot=${log.aliveAfterOn.inBoot} client.js=${log.aliveAfterOn.bundleStatus}`)
  // Bật lại phải ghi `=false` TƯỜNG MINH, không phải xoá dòng đi: xoá thì lớp
  // bundle bên dưới lại nói lên tiếng của nó ở lần khởi động sau.
  record('6. bật lại → ghi lựa chọn "bật" tường minh', log.stateAfterOn.includes(`${OURS.bareId}=false`),
    JSON.stringify(log.stateAfterOn))

  const guarded = log.refusedStatus === 409
    && log.lockedStillAlive.inBoot === true && log.lockedStillAlive.bundleStatus === 200
  record('7. plugin khoá: nửa Node từ chối, kể cả request gửi tay', guarded,
    `HTTP ${log.refusedStatus} (${String(log.refusedReason)}), nó vẫn chạy: ${log.lockedStillAlive.inBoot}`)

  // Mục này neo một sự thật mà giao diện BẮT BUỘC phải tính đến: engine chỉ phục
  // vụ bundle giao diện khi plugin đang bật, nên câu hỏi "plugin này có phần hiện
  // trên màn hình không" cho hai câu trả lời trái nhau ở hai phía của cú gạt.
  //
  // Bản đầu của tab chỉ hỏi TRƯỚC khi gạt. Hệ quả: bật lại một plugin luôn ra
  // "không có nửa giao diện", nên không hiện lời nhắn và không hiện nút tải lại —
  // người dùng bật panel lên và không thấy gì trở lại, cũng không thấy giải thích.
  // Chủ dự án gặp đúng lỗi này trong app thật, sau khi 13 mục kiểm đều xanh.
  const flips = log.aliveBefore.bundleStatus === 200
    && log.aliveAfterOff.bundleStatus === 404
    && log.aliveAfterOn.bundleStatus === 200
  record('7b. dấu vết "có nửa giao diện" ĐẢO CHIỀU theo cú gạt — giao diện phải hỏi cả hai phía', flips,
    `client.js: ${log.aliveBefore.bundleStatus} → ${log.aliveAfterOff.bundleStatus} → ${log.aliveAfterOn.bundleStatus}`)
}

if (log.pass2 === true) {
  const oursStaysOff = log.oursAfterRestart.inBoot === false && log.oursAfterRestart.bundleStatus === 404
  const coreStaysOff = log.coreAfterRestart.inBoot === false && log.coreAfterRestart.bundleStatus === 404
  record('8. khởi động lại → plugin CỦA TA vẫn tắt', oursStaysOff,
    `inBoot=${log.oursAfterRestart.inBoot} client.js=${log.oursAfterRestart.bundleStatus}`)
  record('9. khởi động lại → plugin LÕI vẫn tắt', coreStaysOff,
    `inBoot=${log.coreAfterRestart.inBoot} client.js=${log.coreAfterRestart.bundleStatus}`)
  if (log.bundleOffTarget !== undefined) {
    record('9b. khởi động lại → dòng mà BUNDLE tắt sẵn vẫn BẬT như người dùng chọn',
      log.bundleOffAfterRestart?.enabled === true && log.bundleOffAfterRestart.phase === 'active',
      `${log.bundleOffTarget}: enabled=${String(log.bundleOffAfterRestart?.enabled)}`
      + ` phase=${String(log.bundleOffAfterRestart?.phase)}`)
  }
  record('10. sau khởi động lại vẫn bật lại được', log.recovered.inBoot === true && log.recovered.bundleStatus === 200,
    `inBoot=${log.recovered.inBoot} client.js=${log.recovered.bundleStatus}, file trạng thái ${JSON.stringify(log.stateAfterRecover)}`)
} else if (log.pass1 === true) {
  record('8. khởi động lại → trạng thái đúng như đã đặt', false, 'lượt 2 không chạy')
}

console.log('\n=== KẾT QUẢ ===')
const failed = results.filter((r) => !r.ok)
if (failed.length === 0) {
  console.log(`Tất cả ${results.length} mục đạt.`)
} else {
  console.log(`${failed.length}/${results.length} mục KHÔNG đạt:`)
  for (const f of failed) console.log(`   ${f.name} — ${f.detail}`)
}
process.exit(failed.length === 0 ? 0 : 1)
