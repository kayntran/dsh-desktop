/**
 * Stage 2 spike: does `node-pty` run under the exact Node runtime the app ships?
 *
 * This is the highest-risk item of the whole stage. `node-pty` is a binary addon, and the
 * engine does not run on the machine's Node — it runs on `runtime/node.exe`. If the
 * prebuilt binary cannot load there, the Terminal tab dies at its import line and
 * everything written afterwards is meaningless.
 *
 * Six checks, ordered by descending danger:
 *   1. the addon loads, and ESM can reach `spawn` through the CJS interop layer
 *   2. a real shell opens, with data flowing back
 *   3. a typed command produces output flowing back out
 *   4. accented text survives the PTY intact (cmd.exe does NOT default to UTF-8)
 *   5. `resize` does not throw
 *   6. `kill` REALLY kills the process, leaving no orphan
 *
 *   ./runtime/node.exe scripts/spike-pty.mjs
 *
 * Set `HDW_CONPTY_DLL=1` to run the same suite through the newer ConPTY branch (the
 * conpty.dll bundled in `prebuilds/`) instead of the default one. The notable difference
 * is on the `kill` path: the default branch forks a helper process to enumerate consoles,
 * and that helper throws "AttachConsole failed" onto stderr every time a terminal closes.
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

// --- 1. load the addon ------------------------------------------------------
//
// `import` on a CJS file: Node builds the namespace with cjs-module-lexer. If `spawn` does
// not surface in that namespace, the plugin's Node half has to write its import
// differently — so this has to be known here rather than while the app runs.

let pty
try {
  pty = await import(pathToFileURL(ptyEntry).href)
  const reachable = typeof (pty.spawn ?? pty.default?.spawn) === 'function'
  record('1. addon nạp được + lấy được spawn', reachable,
    `named ${typeof pty.spawn}, default ${typeof pty.default?.spawn}`)
  if (!reachable) process.exit(1)
} catch (error) {
  record('1. addon nạp được + lấy được spawn', false, error.message)
  console.log('\nKhông nạp được addon dưới runtime này. Dừng — mọi mục sau đều vô nghĩa.')
  process.exit(1)
}

const spawnPty = pty.spawn ?? pty.default.spawn

// --- 2. open a shell --------------------------------------------------------

const shell = process.env.ComSpec ?? 'cmd.exe'
let term
let collected = ''
const waitFor = (condition, budgetMs, what) => new Promise((resolve) => {
  const deadline = setTimeout(() => resolve(`hết ${budgetMs}ms chờ ${what}`), budgetMs)
  const poll = setInterval(() => {
    if (condition()) { clearInterval(poll); clearTimeout(deadline); resolve(true) }
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
  term.onData((d) => { collected += d })
  const ok = await waitFor(() => collected.length > 0, 10_000, 'dữ liệu đầu tiên')
  record('2. mở được shell, có dữ liệu chảy về', ok === true,
    ok === true ? `${shell}, pid ${term.pid}, ${collected.length} ký tự đầu` : String(ok))
} catch (error) {
  record('2. mở được shell, có dữ liệu chảy về', false, error.message)
  process.exit(1)
}

// --- 3. type a command ------------------------------------------------------

collected = ''
term.write('echo hdw-spike-ok\r')
{
  const ok = await waitFor(() => collected.includes('hdw-spike-ok\r\n') || /hdw-spike-ok[\s\S]*hdw-spike-ok/.test(collected), 10_000, 'kết quả echo')
  record('3. gõ lệnh vào → kết quả chảy ngược ra', ok === true,
    ok === true ? 'thấy chuỗi vọng lại' : `${String(ok)}; thu được: ${JSON.stringify(collected.slice(0, 200))}`)
}

// --- 4. accented text -------------------------------------------------------
//
// cmd.exe defaults to an OEM codepage (437/850/1258 depending on the machine), NOT UTF-8.
// The question needing a definite answer: MUST the app set `chcp 65001` itself when it
// opens a terminal? If it must and does not, a user typing `dir` inside a directory whose
// name carries accents sees mangled text — and nobody can guess why.
//
// So both sides are measured on the SAME terminal, in before/after order.

const ACCENTED = 'đường'
collected = ''
term.write(`echo hdw-dau-truoc-${ACCENTED}\r`)
{
  const ok = await waitFor(() => /hdw-dau-truoc-.*\r?\n/.test(collected), 8000, 'dòng vọng lại')
  const intact = collected.includes(`hdw-dau-truoc-${ACCENTED}`)
  record('4a. chữ có dấu khi CHƯA đặt bảng mã', intact,
    ok === true
      ? (intact ? 'nguyên vẹn — không cần chcp' : `VỠ: ${JSON.stringify(collected.slice(0, 160))}`)
      : String(ok))
}

collected = ''
term.write('chcp 65001>nul\r')
await waitFor(() => collected.length > 0, 5000, 'chcp xong')
collected = ''
term.write(`echo hdw-dau-sau-${ACCENTED}\r`)
{
  const ok = await waitFor(() => collected.includes(`hdw-dau-sau-${ACCENTED}`), 8000, 'chữ có dấu vọng lại')
  record('4b. chữ có dấu SAU khi đặt chcp 65001', ok === true,
    ok === true ? 'UTF-8 thông suốt' : `${String(ok)}; thu: ${JSON.stringify(collected.slice(0, 160))}`)
}

// --- 5. resize --------------------------------------------------------------

try {
  term.resize(120, 40)
  record('5. resize không ném', true, '80x24 → 120x40')
} catch (error) {
  record('5. resize không ném', false, error.message)
}

// --- 6. a clean kill --------------------------------------------------------
//
// This is the check that decides whether closing the app leaves ghost processes behind.
// `onExit` firing is not enough — the operating system has to be asked whether that pid
// still exists.

const pid = term.pid
let exitInfo
const exited = new Promise((resolve) => { term.onExit((e) => { exitInfo = e; resolve() }) })
term.kill()
const exitedInTime = await Promise.race([exited.then(() => true), new Promise((r) => setTimeout(() => r('hết 8000ms'), 8000))])
record('6a. kill → onExit nổ', exitedInTime === true,
  exitedInTime === true ? `exitCode ${String(exitInfo?.exitCode)}` : String(exitedInTime))

let stillAlive = true
try {
  const listing = execFileSync('tasklist', ['/fi', `PID eq ${String(pid)}`, '/nh'], { encoding: 'utf8' })
  stillAlive = listing.includes(String(pid))
} catch {
  stillAlive = false
}
record('6b. tiến trình chết thật, không mồ côi', !stillAlive, `pid ${pid} ${stillAlive ? 'CÒN SỐNG' : 'đã biến mất'}`)

// ---------------------------------------------------------------------------

console.log('\n=== KẾT QUẢ ===')
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0
  ? 'Tất cả đạt. node-pty chạy được dưới Node runtime đóng gói — giai đoạn 2 đi tiếp được.'
  : `${failed.length}/${results.length} mục KHÔNG đạt: ${failed.map((r) => r.name).join(', ')}`)
process.exit(failed.length === 0 ? 0 : 1)
