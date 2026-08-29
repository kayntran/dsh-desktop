/**
 * Soi hình dạng thật của gói tin trên hai luồng downlink.
 *
 * Tính năng thông báo Windows đọc trực tiếp các luồng này, mà thượng nguồn ghi
 * rõ giao thức KHÔNG có số hiệu phiên bản — nên hình dạng gói tin phải được
 * quan sát chứ không suy đoán, và phải quan sát lại mỗi lần nâng cấp dsh.
 */

import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nodeExe = join(root, 'runtime', 'node.exe')
const dshBin = join(root, 'engine', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

const child = spawn(nodeExe, [dshBin, '--profile', 'web', '--port', '0', '--no-open'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
const cleanup = () => {
  try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
}

let stdout = ''
const baseUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('hết giờ')), 180_000)
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/m.exec(stdout)
    if (match) { clearTimeout(timer); resolve(match[1]) }
  })
  child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`engine thoát mã ${code}`)) })
}).catch((error) => { console.error(error.message); cleanup(); process.exit(1) })

console.log(`engine: ${baseUrl}\n`)

const open = (path, label) => new Promise((resolve) => {
  const ws = new WebSocket(`${baseUrl.replace('http://', 'ws://')}${path}`)
  ws.addEventListener('open', () => { console.log(`[${label}] mở`); resolve(ws) })
  ws.addEventListener('message', (event) => { console.log(`[${label}] ${String(event.data).slice(0, 420)}`) })
  ws.addEventListener('error', () => { console.log(`[${label}] lỗi`); resolve(undefined) })
  ws.addEventListener('close', () => { console.log(`[${label}] đóng`) })
})

await Promise.all([open('/api/events.host', 'host'), open('/api/events.mux', 'mux')])
await new Promise((r) => setTimeout(r, 1500))

const rpc = async (method, payload = {}) => {
  const res = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `frames-${method}`, method, payload }),
  })
  const body = await res.json()
  console.log(`\nRPC ${method} → ${JSON.stringify(body).slice(0, 300)}\n`)
  return body
}

// Tạo một phiên: đủ để sinh frame host/session-added và host/session-status mà
// không cần API key nào.
const created = await rpc('session.create', {})
const sessionId = created?.result?.value?.sessionId
await new Promise((r) => setTimeout(r, 2000))

// Gửi một prompt: phiên sẽ chuyển sang đang chạy rồi dừng. Không có API key thì
// nó dừng bằng lỗi — vẫn đủ để thấy hình dạng frame vòng đời.
if (sessionId !== undefined) {
  console.log('\n--- gửi prompt ---')
  await rpc('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: 'xin chào' }] })
}
await new Promise((r) => setTimeout(r, 12000))

cleanup()
process.exit(0)
