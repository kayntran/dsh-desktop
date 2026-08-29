/**
 * Spike hợp đồng thượng nguồn: engine dsh có chạy được trên Node runtime mà app
 * đóng gói kèm không.
 *
 * Kiểm 4 điều: (1) engine boot và in dòng URL readiness, (2) frontend phục vụ
 * được index.html kèm boot manifest, (3) RPC /api trả lời qua trust fence
 * loopback, (4) downlink WebSocket mở được — cái mà tính năng thông báo dựa vào.
 */

import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nodeExe = join(root, 'runtime', 'node.exe')
const dshBin = join(root, 'engine', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

const BOOT_TIMEOUT_MS = 180_000
const URL_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/m

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

console.log(`node:    ${nodeExe}`)
console.log(`dsh bin: ${dshBin}\n`)

const child = spawn(nodeExe, [dshBin, '--profile', 'web', '--port', '0', '--no-open'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

let stdout = ''
let stderr = ''
let settled = false

const urlPromise = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`không thấy dòng URL sau ${BOOT_TIMEOUT_MS / 1000}s`)), BOOT_TIMEOUT_MS)
  const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value) } }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    process.stdout.write(chunk)
    const match = URL_LINE.exec(stdout)
    if (match) finish(resolve, match[1])
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk; process.stderr.write(chunk) })
  child.on('exit', (code) => finish(reject, new Error(`engine thoát sớm với mã ${code}`)))
  child.on('error', (error) => finish(reject, error))
})

let baseUrl
try {
  baseUrl = await urlPromise
  record('1. engine boot + in dòng URL readiness', true, baseUrl)
} catch (error) {
  record('1. engine boot + in dòng URL readiness', false, error.message)
  console.log('\n--- stderr ---\n' + stderr.slice(-4000))
  process.exit(1)
}

// 2. Frontend: index.html kèm boot manifest do dsh-client-modules tiêm vào.
try {
  const res = await fetch(baseUrl)
  const html = await res.text()
  const hasBoot = html.includes('__DSH_BOOT__')
  record('2. frontend phục vụ index.html + boot manifest', res.ok && hasBoot,
    `HTTP ${res.status}, __DSH_BOOT__ ${hasBoot ? 'có' : 'KHÔNG có'}, ${html.length} bytes`)
} catch (error) {
  record('2. frontend phục vụ index.html + boot manifest', false, error.message)
}

// 3. RPC unary qua trust fence loopback (bao đúng bốn-góc phần tư của giao thức).
try {
  const res = await fetch(`${baseUrl}/api/host.describe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'spike-1', method: 'host.describe', payload: {} }),
  })
  const body = await res.json()
  record('3. RPC /api/host.describe qua trust fence', res.ok && body?.result?.ok === true,
    JSON.stringify(body).slice(0, 300))
} catch (error) {
  record('3. RPC /api/host.describe qua trust fence', false, error.message)
}

// 4. Downlink WebSocket — nền tảng của tính năng thông báo Windows.
try {
  const wsUrl = baseUrl.replace('http://', 'ws://') + '/api/events.host'
  const opened = await new Promise((resolve) => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => { ws.close(); resolve('timeout sau 15s') }, 15_000)
    ws.addEventListener('open', () => { clearTimeout(timer); ws.close(); resolve(true) })
    ws.addEventListener('error', () => { clearTimeout(timer); resolve('lỗi kết nối') })
  })
  record('4. downlink WebSocket /api/events.host', opened === true, opened === true ? wsUrl : String(opened))
} catch (error) {
  record('4. downlink WebSocket /api/events.host', false, error.message)
}

console.log('\n=== KẾT QUẢ ===')
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0
  ? 'Tất cả đạt. Engine chạy được trên Node runtime đóng gói.'
  : `${failed.length}/${results.length} mục KHÔNG đạt: ${failed.map((r) => r.name).join(', ')}`)

// Diệt đồng bộ rồi mới thoát. `spawn` xong `process.exit` ngay là để libuv
// đóng một handle đang khởi tạo dở, và nó ném assertion ra ngay dưới dòng
// KẾT QUẢ — trông như spike hỏng trong khi mọi mục đều đạt.
try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
process.exit(failed.length === 0 ? 0 : 1)
