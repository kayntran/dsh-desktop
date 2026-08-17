/**
 * Bài kiểm cho THẺ KẾT QUẢ — phần vẽ ra màn hình.
 *
 * Đây là bộ kiểm thứ ba, và nó tồn tại vì một lỗi cụ thể: bộ kiểm giao diện
 * (`spike-dock-ui.cjs`) và bộ kiểm tầng tool (`spike-tools.mjs`) cùng xanh 60/60
 * trong khi ảnh chụp KHÔNG hiện ra cho người dùng. Cả hai đều hỏi *hàm dựng thẻ
 * trả về gì*; không bộ nào hỏi *có ai gọi nó không*, và càng không bộ nào hỏi
 * *trên màn hình có tấm ảnh nào không*.
 *
 * Nên bài này hỏi đúng câu cuối cùng đó, và hỏi bằng cách vẽ thật: dựng
 * `ScreenshotCard` trong một cửa sổ Electron thật, với React thật của engine, rồi
 * đo thẻ `<img>` trên màn hình có kích thước lớn hơn không.
 *
 * Ba trạng thái phải đúng cả ba, vì cả ba đều xảy ra hằng ngày:
 *   - đang chụp     → chưa có ảnh, có chữ báo đang chạy
 *   - chụp xong     → CÓ ảnh, nhìn thấy được
 *   - dữ liệu hỏng  → không ảnh, không ném, không làm vỡ khung hội thoại
 *
 *   npm run spike:card
 */

if (process.env['ELECTRON_RUN_AS_NODE'] !== undefined) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']
  const child = spawnSync(process.execPath, [__filename, ...process.argv.slice(2)], { stdio: 'inherit', env })
  process.exit(child.status ?? 1)
}

const { app, BrowserWindow } = require('electron')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const root = join(__dirname, '..')
const pluginDir = join(root, 'plugins', 'dock')
const esbuild = require(join(pluginDir, 'node_' + 'modules', 'esbuild'))

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

/**
 * Trang thử: dựng ba thẻ cạnh nhau, mỗi thẻ một trạng thái.
 *
 * `loadShot` giả vẽ một tấm PNG thật bằng canvas ngay trong trang, nên đường đi
 * của ảnh là đường thật từ `MessageImage` trở đi — chỉ đoạn hỏi engine là thay.
 */
const ENTRY = `
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ScreenshotCard } from ${JSON.stringify(join(pluginDir, 'src', 'client', 'ScreenshotCard.tsx').replace(/\\/g, '/'))}

function fakeShot(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')
  g.fillStyle = '#2b6cb0'
  g.fillRect(0, 0, width, height)
  g.fillStyle = '#ffffff'
  g.font = '48px sans-serif'
  g.fillText('ANH CHUP TRANG', 40, height / 2)
  return canvas.toDataURL('image/png')
}

const loadShot = async (_sessionId, attachment) => fakeShot(attachment.width, attachment.height)

const DONE_META = {
  attachment_id: 'sha256:' + 'a'.repeat(64),
  media_type: 'image/png',
  width: 800,
  height: 600,
  bytes: 12345,
  seen_by_model: false,
}

const CASES = [
  ['running', { callId: 'c1', name: 'browser_screenshot', argsRaw: '{}', turn: 1, step: 1, time: 0, callView: null, subCalls: [] }],
  ['done', { kind: 'tool-result', callId: 'c2', seq: 2, time: 0, call: null, callTime: null, content: [], isError: false, meta: DONE_META, callView: null, resultView: null, subCalls: [] }],
  ['junk', { kind: 'tool-result', callId: 'c3', seq: 3, time: 0, call: null, callTime: null, content: [], isError: false, meta: { attachment_id: 7 }, callView: null, resultView: null, subCalls: [] }],
  ['error', { kind: 'tool-result', callId: 'c4', seq: 4, time: 0, call: null, callTime: null, content: [], isError: true, meta: undefined, callView: null, resultView: null, subCalls: [] }],
]

for (const [id, block] of CASES) {
  const host = document.createElement('div')
  host.id = 'case-' + id
  host.style.margin = '12px'
  document.body.append(host)
  createRoot(host).render(createElement(ScreenshotCard, {
    block,
    sessionId: 'session-1',
    loadShot,
    callId: block.callId,
    toolName: 'browser_screenshot',
    openFile: () => {},
  }))
}
`

async function main() {
  const outDir = mkdtempSync(join(tmpdir(), 'hdw-card-'))
  const entryFile = join(outDir, 'entry.jsx')
  const bundleFile = join(outDir, 'bundle.js')
  writeFileSync(entryFile, ENTRY)

  // React và các gói giao diện phân giải từ engine ĐÃ CÀI — đúng bản mà app
  // đang chạy, không phải một bản khác cài riêng cho bài kiểm.
  await esbuild.build({
    entryPoints: [entryFile],
    outfile: bundleFile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    loader: { '.css': 'text' },
    nodePaths: [join(root, 'engine', 'node_' + 'modules')],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
  })

  const css = readFileSync(join(pluginDir, 'src', 'client', 'styles.css'), 'utf8')
  const page = join(outDir, 'page.html')
  // `<body>` phải mở TRƯỚC thẻ script. Không có nó, trình phân tích còn đang ở
  // phần đầu trang và `document.body` là null — bản trước chết đúng ở đó.
  writeFileSync(page, `<!doctype html><meta charset="utf-8">
<style>body{background:#fff;font-family:system-ui;margin:0;padding:12px}${css}</style>
<body><script>${readFileSync(bundleFile, 'utf8')}</script></body>`)

  const win = new BrowserWindow({ width: 700, height: 900, show: process.env['HDW_HIEN'] === '1' })
  // Một lỗi lúc dựng React chỉ hiện ra ở console của trang. Không hứng thì bài
  // kiểm báo "không thấy thẻ nào" và giấu mất lý do thật.
  const noise = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) noise.push(message)
  })
  await win.loadFile(page)

  // Chờ ảnh nạp xong. `MessageImage` nạp bất đồng bộ nên hỏi ngay là hỏi hụt.
  for (let i = 0; i < 40; i += 1) {
    const ready = await win.webContents.executeJavaScript(
      `!!document.querySelector('#case-done img')`)
    if (ready) break
    await new Promise((r) => { setTimeout(r, 250) })
  }

  const seen = await win.webContents.executeJavaScript(`(() => {
    const pick = (id) => {
      const host = document.querySelector('#case-' + id)
      if (!host) return { missing: true }
      const img = host.querySelector('img')
      const box = img ? img.getBoundingClientRect() : null
      return {
        html: host.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60),
        hasImg: !!img,
        src: img ? img.src.slice(0, 22) : '',
        w: box ? Math.round(box.width) : 0,
        h: box ? Math.round(box.height) : 0,
      }
    }
    return { running: pick('running'), done: pick('done'), junk: pick('junk'), error: pick('error') }
  })()`)

  if (noise.length > 0) console.log(`  (console trang) ${noise.join(' | ').slice(0, 600)}`)

  record('1. lệnh đang chạy: chưa có ảnh, có chữ báo đang chụp',
    seen.running.hasImg === false && String(seen.running.html ?? '').includes('đang chụp'),
    JSON.stringify(seen.running))

  // --- MỤC QUYẾT ĐỊNH: trên màn hình có một tấm ảnh, và nó lớn hơn không.
  record('2. chụp xong: TRÊN MÀN HÌNH có ảnh thật, nhìn thấy được',
    seen.done.hasImg && seen.done.w > 100 && seen.done.h > 60 && seen.done.src.startsWith('data:image'),
    JSON.stringify(seen.done))

  record('3. dữ liệu hỏng: không vẽ ảnh, không làm vỡ thẻ',
    !seen.junk.hasImg && String(seen.junk.html ?? "").includes('không có ảnh'),
    JSON.stringify(seen.junk))

  record('4. chụp lỗi: nói rõ là lỗi thay vì im lặng',
    !seen.error.hasImg && String(seen.error.html ?? "").includes('không được'),
    JSON.stringify(seen.error))

  const errors = await win.webContents.executeJavaScript(
    `(window.__errors || []).join(' | ')`).catch(() => '')
  record('5. không có lỗi nào ném ra lúc vẽ', errors === '' || errors === undefined, String(errors))

  const shotPath = process.env['HDW_ANH'] ?? join(outDir, 'the-ket-qua.png')
  const image = await win.webContents.capturePage()
  writeFileSync(shotPath, image.toPNG())
  console.log(`\nảnh thẻ: ${shotPath}`)

  win.destroy()
  if (process.env['HDW_ANH'] === undefined) rmSync(outDir, { recursive: true, force: true })
}

app.whenReady().then(async () => {
  try {
    await main()
  } catch (error) {
    record('spike chạy tới cuối', false, error.stack ?? String(error))
  }
  const failed = results.filter((r) => !r.ok)
  console.log('\n=== KẾT QUẢ ===')
  if (failed.length === 0) console.log('Tất cả đạt. Ảnh chụp thật sự hiện ra trên màn hình.')
  else console.log(`${failed.length}/${results.length} mục KHÔNG đạt: ${failed.map((f) => f.name).join(', ')}`)
  app.exit(failed.length === 0 ? 0 : 1)
})
