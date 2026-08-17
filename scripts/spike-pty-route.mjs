/**
 * A spike for the Terminal tab's WebSocket route — tests the Node half with no UI open.
 *
 * It starts the engine the way the app starts it (the bundled Node runtime plus a
 * `--patch` pointing at the plugin), then plays the browser: open `/hdw/pty`, type a
 * command, read the output, and try the two paths that must be refused.
 *
 * Six checks:
 *   1. the plugin loads — something answers on `/hdw/pty`
 *   2. the workspace gate: an unknown directory is REFUSED
 *   3. the trust gate: another page's Origin is REFUSED
 *   4. a session opens, with a `ready` frame
 *   5. a typed command produces output flowing back
 *   6. closing the WebSocket kills the shell with it, leaving no orphan
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

// Its own DSH_HOME: the spike must not touch the owner's real session history.
const home = mkdtempSync(join(tmpdir(), 'hdw-pty-'))

// The junction is mandatory, not optional: the engine resolves a plugin by PACKAGE NAME
// from the profile directory, so declaring a path in `cordis.patch.yml` is not enough.
// This is exactly what `src/main/plugin-link.ts` does on every app launch; rebuilt here so
// the temporary DSH_HOME can see the plugin too.
const nmDir = join(home, 'profiles', 'node_' + 'modules')
mkdirSync(nmDir, { recursive: true })
symlinkSync(join(root, 'plugins', 'dock'), join(nmDir, 'harness-desktop-dock'), 'junction')

console.log(`node:     ${nodeExe}`)
console.log(`DSH_HOME: ${home}\n`)

// A second patch layer: a throwaway plugin registers the project directory as a
// workspace, so the route's workspace gate has something valid to compare against. A
// brand-new DSH_HOME has no workspace at all, and then EVERY connection is refused —
// correct by the rules, but it leaves the success path untested. Supplied through an
// environment variable so the spike does not depend on a file outside the project.
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
const connect = (u, headers) => new Promise((resolve) => {
  const ws = new WebSocket(u, headers === undefined ? undefined : { headers })
  const frames = []
  const timer = setTimeout(() => resolve({ ws, open: false, frames, reason: 'hết 12s' }), 12_000)
  ws.binaryType = 'arraybuffer'
  ws.addEventListener('message', (e) => { frames.push(e.data) })
  ws.addEventListener('open', () => { clearTimeout(timer); resolve({ ws, open: true, frames }) })
  ws.addEventListener('error', () => { clearTimeout(timer); resolve({ ws, open: false, frames, reason: 'bị từ chối' }) })
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Wait for the workspace registry to finish bootstrapping.
//
// The readiness URL line prints EARLIER than the registry becomes ready: the registry has
// two startup dependencies of its own (`storageDomain`, `sessionPersistence`) and only
// loads the workspace list once both are up. Asking the moment the URL appears finds an
// empty registry, and the gate then refuses everything — which looks exactly like an
// inverted gate.
//
// The Files route uses THE SAME gate the Terminal route uses, and it answers over HTTP
// with a reason in words, so it is the best place to ask: a refusal at the WebSocket layer
// is only "the connection dropped" and says nothing about why.
{
  const q = `root=${encodeURIComponent(root)}&path=${encodeURIComponent(root)}`
  let last = ''
  for (let i = 0; i < 40; i += 1) {
    const res = await fetch(`${baseUrl}/hdw/fs/list?${q}`)
    last = `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`
    if (res.ok) break
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log(`  (chuẩn đoán) /hdw/fs/list → ${last}\n`)
}

// --- 1 + 2. An unknown directory has to be refused ---------------------------
//
// Run BEFORE the session-opening check: if the gate leaks, that has to be known at once,
// rather than letting a PASS further down create false confidence.

{
  const stranger = await connect(`${wsBase}/hdw/pty?cwd=${encodeURIComponent('C:/Windows/System32')}&cols=80&rows=24`)
  record('2. rào workspace: thư mục lạ bị từ chối', !stranger.open, stranger.open ? 'MỞ ĐƯỢC — RÀO THỦNG' : stranger.reason)
  stranger.ws.close()
}

// --- 3. The trust gate: another page's Origin --------------------------------

{
  const crossSite = await connect(`${wsBase}/hdw/pty?cwd=${encodeURIComponent(root)}&cols=80&rows=24`, {
    origin: 'http://evil.example',
  })
  record('3. rào tin cậy: Origin lạ bị từ chối', !crossSite.open, crossSite.open ? 'MỞ ĐƯỢC — RÀO THỦNG' : crossSite.reason)
  crossSite.ws.close()
}

// --- 1 + 4. Open a real session ---------------------------------------------

const session = await connect(`${wsBase}/hdw/pty?cwd=${encodeURIComponent(root)}&cols=100&rows=30`)
record('1. plugin nạp được, route /hdw/pty có người nhận', session.open || session.reason !== 'hết 12s',
  session.open ? 'kết nối mở' : String(session.reason))

if (!session.open) {
  record('4. nhận được khung ready', false, 'không mở được kết nối')
  console.log('\n--- stderr engine ---\n' + stderr.slice(-3000))
} else {
  await sleep(2500)
  const control = session.frames.filter((k) => typeof k === 'string').map((k) => JSON.parse(k))
  const ready = control.find((k) => k.t === 'ready')
  record('4. nhận được khung ready', ready !== undefined,
    ready === undefined ? JSON.stringify(control).slice(0, 200) : `pid ${ready.pid}, ${ready.shell}`)

  // --- 5. Type a command ----------------------------------------------------
  session.frames.length = 0
  session.ws.send(new TextEncoder().encode('echo hdw-route-ok\r'))
  await sleep(3000)
  const screen = session.frames
    .filter((k) => k instanceof ArrayBuffer)
    .map((k) => new TextDecoder().decode(k))
    .join('')
  record('5. gõ lệnh vào → kết quả chảy về', screen.includes('hdw-route-ok'),
    screen.includes('hdw-route-ok') ? `${screen.length} byte màn hình` : JSON.stringify(screen.slice(0, 200)))

  // --- 6. Closing the connection kills the shell with it ---------------------
  const pid = ready?.pid
  session.ws.close()
  await sleep(3000)
  let stillAlive = true
  try {
    const listing = execFileSync('tasklist', ['/fi', `PID eq ${String(pid)}`, '/nh'], { encoding: 'utf8' })
    stillAlive = listing.includes(String(pid))
  } catch {
    stillAlive = false
  }
  record('6. đóng WebSocket → shell chết theo', !stillAlive, `pid ${String(pid)} ${stillAlive ? 'CÒN SỐNG' : 'đã biến mất'}`)
}

console.log('\n=== KẾT QUẢ ===')
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0
  ? 'Tất cả đạt. Nửa Node của tab Terminal chạy đúng, cả hai rào an toàn đều giữ.'
  : `${failed.length}/${results.length} mục KHÔNG đạt: ${failed.map((r) => r.name).join(', ')}`)

try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* already stopped */ }
process.exit(failed.length === 0 ? 0 : 1)
