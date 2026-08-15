/**
 * Spike thẻ `<webview>`: nó có chạy trong đúng cấu hình cửa sổ của app này
 * không, và có làm được đủ những việc mà phần Browser cần không.
 *
 * Vì sao phải spike trước khi viết code: cả kế hoạch phần Browser đứng trên một
 * giả định — rằng agent điều khiển được trình duyệt từ trong plugin, qua API
 * của thẻ `<webview>`, không cần lớp CDP ở tiến trình chính. Nếu thẻ không gắn
 * được trong renderer sandbox (mục 1), giả định đó sai và phần lớn code phải
 * rời khỏi plugin — tức là phá phương châm của dự án. Biết điều đó sau một
 * tuần viết code thì quá muộn.
 *
 * Spike dựng một http server loopback tí hon để tái hiện đúng tình huống thật:
 * trang nhúng nạp từ `http://127.0.0.1`, không phải `file://`.
 *
 *   npm run spike:webview
 */

// File này là CJS (`.cjs`) chứ không phải ESM, dù dự án khai `type: module`.
// Lý do: khi Electron nạp một entry ESM, tên 'electron' được phân giải bằng bộ
// giải module của Node và trúng gói npm rỗng trong node_modules thay vì module
// dựng sẵn của Electron — mọi API trả về undefined. Với `require` thì Electron
// chặn đúng tên đó và trả module thật.

// Terminal tích hợp của VS Code đặt sẵn `ELECTRON_RUN_AS_NODE=1`. Biến đó biến
// electron.exe thành một node.exe thường: không có cửa sổ, không có module
// dựng sẵn, và `require('electron')` trả về gói npm rỗng. Triệu chứng là mọi
// API undefined — không hề nói ra nguyên nhân. Tự khởi động lại với môi trường
// đã dọn, để `npm run spike:webview` chạy được từ bất kỳ terminal nào.
if (process.env['ELECTRON_RUN_AS_NODE'] !== undefined) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']
  console.log('ELECTRON_RUN_AS_NODE đang bật — khởi động lại spike trong Electron thật.\n')
  const child = spawnSync(process.execPath, [__filename], { stdio: 'inherit', env })
  process.exit(child.status ?? 1)
}

const { app, BrowserWindow, screen, session } = require('electron')
const { createServer } = require('node:http')

const PARTITION = 'persist:hdw-spike'

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

/** Quan sát từ phía tiến trình chính, gộp với kết quả đo từ phía trang. */
const main = {
  willAttachFired: false,
  attachedPrefs: undefined,
  windowOpenBlocked: false,
}

// ---------------------------------------------------------------- server thử

/** Trang khách: có nút bấm, tiêu đề, favicon, console.log, và một Promise. */
const GUEST = `<!doctype html>
<html><head><meta charset="utf-8"><title>Trang khách</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'><rect width='8' height='8' fill='%2300f'/></svg>">
</head><body style="margin:0">
<button id="nut" style="position:absolute;left:40px;top:60px;width:120px;height:40px">Bấm tôi</button>
<script>
  window.__clicked = 0
  window.__marker = 'con-nguyen'
  document.getElementById('nut').addEventListener('click', () => { window.__clicked++ })
  window.__hen = () => new Promise((r) => setTimeout(() => r('promise-xong'), 50))
  console.log('guest-console-marker')
</script>
</body></html>`

/** Trang nhúng: nơi thẻ `<webview>` sống, phục vụ từ loopback như app thật. */
const HOST = (port) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Trang nhúng</title></head>
<body style="margin:0;background:#222">
<div id="san" style="position:absolute;left:0;top:0;width:800px;height:500px"></div>
<div id="san2" style="position:absolute;left:0;top:520px;width:800px;height:100px"></div>
<script>
const BASE = 'http://127.0.0.1:${port}'
const log = []
const note = (k, v) => { log.push(k + '=' + JSON.stringify(v)) }

/** Tạo một webview và chờ nó nạp xong, hoặc bỏ cuộc sau hạn giờ. */
function moWebview(src, parent) {
  return new Promise((resolve, reject) => {
    const wv = document.createElement('webview')
    wv.setAttribute('partition', '${PARTITION}')
    wv.setAttribute('src', src)
    wv.style.cssText = 'display:inline-flex;width:800px;height:500px;border:0'
    const hen = setTimeout(() => reject(new Error('quá hạn chờ dom-ready')), 20000)
    wv.addEventListener('dom-ready', () => { clearTimeout(hen); resolve(wv) }, { once: true })
    wv.addEventListener('did-fail-load', (e) => {
      if (e.errorCode !== -3) { clearTimeout(hen); reject(new Error('did-fail-load ' + e.errorCode)) }
    })
    ;(parent ?? document.getElementById('san')).appendChild(wv)
  })
}

window.__runTests = async () => {
  const out = {}

  // 1. Thẻ có gắn được không — mục quyết định.
  let wv
  try { wv = await moWebview(BASE + '/guest.html'); out.attach = true }
  catch (e) { out.attach = false; out.attachError = String(e.message); return out }
  window.__wv = wv

  // 4. executeJavaScript: giá trị thường, và Promise của trang.
  try {
    out.evalPlain = await wv.executeJavaScript('1 + 1')
    out.evalPromise = await wv.executeJavaScript('window.__hen()')
  } catch (e) { out.evalError = String(e.message) }

  // 7. console-message: gom trước khi kích hoạt.
  const consoles = []
  wv.addEventListener('console-message', (e) => { consoles.push(e.message ?? '') })
  try {
    await wv.executeJavaScript("console.log('spike-console-1'); undefined")
    await wv.executeJavaScript("setTimeout(() => { throw new Error('spike-loi-chua-bat') }, 0); undefined")
  } catch {}

  // 5. sendInputEvent: bấm đúng tâm nút, ở đúng tỉ lệ DPI đang chạy.
  try {
    const r = await wv.executeJavaScript("(() => { const b = document.getElementById('nut').getBoundingClientRect(); return { x: b.left + b.width/2, y: b.top + b.height/2 } })()")
    wv.sendInputEvent({ type: 'mouseDown', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 })
    wv.sendInputEvent({ type: 'mouseUp',   x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 })
    await new Promise((s) => setTimeout(s, 300))
    out.clicked = await wv.executeJavaScript('window.__clicked')
    out.clickPoint = r
  } catch (e) { out.clickError = String(e.message) }

  // 8. Sự kiện vòng đời.
  const events = []
  for (const name of ['page-title-updated', 'page-favicon-updated', 'did-navigate', 'did-fail-load']) {
    wv.addEventListener(name, () => { if (!events.includes(name)) events.push(name) })
  }
  await new Promise((s) => setTimeout(s, 100))
  await wv.loadURL(BASE + '/guest.html?lan2')
  await new Promise((s) => setTimeout(s, 1200))
  // Lỗi mạng THẬT, không phải 404: server thử vẫn trả nội dung cho 404 nên
  // Chromium coi là nạp thành công và did-fail-load không nổ. Cổng 1 luôn từ
  // chối kết nối.
  try { await wv.loadURL('http://127.0.0.1:1/') } catch {}
  await new Promise((s) => setTimeout(s, 1500))
  await wv.loadURL(BASE + '/guest.html')
  await new Promise((s) => setTimeout(s, 1200))
  out.events = events

  // --- 6. capturePage ở bốn cách "giấu" tab khác nhau. Kết quả quyết định
  // cách stage ẩn tab nền: cách nào làm Chromium ngưng vẽ thì capturePage TREO.
  out.shotVisible = await chup(wv)

  wv.style.visibility = 'hidden'
  await new Promise((s) => setTimeout(s, 500))
  out.shotHidden = await chup(wv)
  wv.style.visibility = 'visible'
  await new Promise((s) => setTimeout(s, 300))

  // Bị một lớp đục che kín, nhưng theo CSS vẫn là visible.
  const che = document.createElement('div')
  che.style.cssText = 'position:absolute;left:0;top:0;width:800px;height:500px;background:#000;z-index:99'
  document.body.appendChild(che)
  await new Promise((s) => setTimeout(s, 500))
  out.shotOccluded = await chup(wv)
  che.remove()
  await new Promise((s) => setTimeout(s, 300))

  // Đẩy hẳn ra ngoài khung nhìn.
  const san = document.getElementById('san')
  san.style.left = '-10000px'
  await new Promise((s) => setTimeout(s, 500))
  out.shotOffscreen = await chup(wv)
  san.style.left = '0px'
  await new Promise((s) => setTimeout(s, 300))

  // 3. partition: đặt cookie ở webview này, đọc lại ở webview khác cùng partition.
  try {
    await wv.executeJavaScript("document.cookie = 'hdw=xin-chao; path=/'; undefined")
    const wv2 = await moWebview(BASE + '/guest.html')
    out.cookieShared = String(await wv2.executeJavaScript('document.cookie')).includes('hdw=xin-chao')
    wv2.remove()
  } catch (e) { out.cookieError = String(e.message) }

  // 9. Đổi cha: guest có bị nạp lại không.
  try {
    await wv.executeJavaScript("window.__marker = 'con-nguyen'; undefined")
    document.getElementById('san2').appendChild(wv)
    await new Promise((s) => setTimeout(s, 1500))
    out.markerSauDoiCha = await wv.executeJavaScript('window.__marker')
  } catch (e) { out.markerSauDoiCha = 'LOI: ' + String(e.message) }

  // 10. window.open từ trang khách.
  try {
    await wv.executeJavaScript("window.open('" + BASE + "/guest.html'); undefined")
    await new Promise((s) => setTimeout(s, 600))
    out.openGoi = true
  } catch (e) { out.openGoi = 'LOI: ' + String(e.message) }

  out.consoles = consoles
  out.log = log
  return out
}

/**
 * Chụp màn hình rồi báo lại kích thước dữ liệu.
 *
 * Hạn giờ là bắt buộc chứ không phải cẩn thận thừa: khi trang không được vẽ
 * (webview ẩn, hoặc cửa sổ ẩn) thì capturePage() KHÔNG trả về gì cả — nó treo
 * vĩnh viễn thay vì trả ảnh rỗng hay ném lỗi. Không có hạn giờ thì cả spike
 * đứng im, và trong app thật thì một tool của agent sẽ treo mãi.
 *
 * (Chú thích này nằm trong một chuỗi template nên tuyệt đối không có backtick.)
 */
async function chup(wv) {
  try {
    const img = await Promise.race([
      wv.capturePage(),
      new Promise((r) => setTimeout(() => r('QUA_HAN'), 4000)),
    ])
    if (img === 'QUA_HAN') return { ok: false, ly_do: 'TREO — không trả về sau 4s' }
    if (img === null || img === undefined) return { ok: false, ly_do: 'trả về null' }
    if (typeof img.toDataURL !== 'function') return { ok: false, ly_do: 'không phải NativeImage, keys=' + Object.keys(img).join(',') }
    const url = img.toDataURL()
    const size = typeof img.getSize === 'function' ? img.getSize() : null
    return { ok: url.length > 1000, bytes: url.length, size }
  } catch (e) { return { ok: false, ly_do: String(e.message) } }
}
</script></body></html>`

// ------------------------------------------------------------------- chạy

let server
let win

async function run() {
  const port = await new Promise((resolve) => {
    server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0]
      if (path === '/guest.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(GUEST)
      } else if (path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(HOST(server.address().port))
      } else {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('khong co')
      }
    })
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
  console.log(`server thử: http://127.0.0.1:${port}`)
  console.log(`tỉ lệ màn hình: ${screen.getPrimaryDisplay().scaleFactor}\n`)

  // Cấu hình cửa sổ giống hệt `src/main/window.ts`, chỉ thêm đúng `webviewTag`.
  win = new BrowserWindow({
    width: 1000, height: 700, show: false,
    webPreferences: { webviewTag: true },
  })

  win.webContents.on('will-attach-webview', (_event, prefs, params) => {
    main.willAttachFired = true
    // Ép cấu hình guest — đúng những gì lớp vỏ thật sẽ làm.
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    prefs.backgroundThrottling = false
    params.partition = PARTITION
    delete params.allowpopups
  })

  win.webContents.on('did-attach-webview', (_event, guest) => {
    if (main.attachedPrefs === undefined) {
      try { main.attachedPrefs = guest.getLastWebPreferences() } catch { main.attachedPrefs = null }
    }
    guest.setWindowOpenHandler(() => { main.windowOpenBlocked = true; return { action: 'deny' } })
  })

  await win.loadURL(`http://127.0.0.1:${port}/`)
  win.show()

  // Hạn giờ tổng: một API treo ở phía trang không được phép làm cả spike đứng
  // im — thà báo "quá hạn" rồi in phần đã đo được.
  const out = await Promise.race([
    win.webContents.executeJavaScript('window.__runTests()'),
    new Promise((_, rej) => setTimeout(() => rej(new Error('__runTests quá hạn 120s')), 120_000)),
  ])

  // ---- mục 1: quyết định
  record('1. <webview> gắn được trong renderer sandbox, trang từ loopback',
    out.attach === true, out.attach === true ? 'dom-ready đã nổ' : out.attachError)
  if (out.attach !== true) return

  // ---- mục 2
  const prefs = main.attachedPrefs
  const prefsOk = main.willAttachFired && prefs !== null && prefs !== undefined
    && prefs.nodeIntegration !== true && prefs.contextIsolation !== false
  record('2. will-attach-webview nổ và ép được webPreferences', prefsOk,
    prefs === null || prefs === undefined ? 'không đọc lại được prefs'
      : `nodeIntegration=${prefs.nodeIntegration}, contextIsolation=${prefs.contextIsolation}, sandbox=${prefs.sandbox}`)

  // ---- mục 3
  record('3. partition persist dùng chung cookie giữa hai webview',
    out.cookieShared === true, out.cookieError ?? `cookieShared=${out.cookieShared}`)

  // ---- mục 4
  record('4. executeJavaScript trả giá trị và giải quyết Promise của trang',
    out.evalPlain === 2 && out.evalPromise === 'promise-xong',
    out.evalError ?? `plain=${out.evalPlain}, promise=${out.evalPromise}`)

  // ---- mục 5
  record('5. sendInputEvent kích hoạt handler click thật',
    out.clicked >= 1, out.clickError ?? `clicked=${out.clicked} tại (${Math.round(out.clickPoint?.x ?? -1)},${Math.round(out.clickPoint?.y ?? -1)}), scale=${screen.getPrimaryDisplay().scaleFactor}`)

  // ---- mục 6
  record('6a. capturePage khi webview đang hiện',
    out.shotVisible?.ok === true, JSON.stringify(out.shotVisible))
  // 6b/6d/6e không phải mục đạt-trượt mà là phép ĐO: chúng quyết định stage nên
  // ẩn tab nền bằng cách nào. Cách nào chụp được thì cách đó giữ trang sống.
  console.log(`  ĐO   ẩn bằng visibility:hidden  → ${JSON.stringify(out.shotHidden)}`)
  console.log(`  ĐO   bị lớp khác che kín        → ${JSON.stringify(out.shotOccluded)}`)
  console.log(`  ĐO   đẩy ra ngoài khung nhìn    → ${JSON.stringify(out.shotOffscreen)}`)
  const cachAn = out.shotOccluded?.ok === true ? 'bị che kín (z-index)'
    : out.shotOffscreen?.ok === true ? 'đẩy ra ngoài khung nhìn'
      : out.shotHidden?.ok === true ? 'visibility:hidden' : undefined
  record('6b. có ít nhất một cách ẩn tab nền mà vẫn chụp được',
    cachAn !== undefined, cachAn ?? 'KHÔNG có cách nào — phải chuyển tab trước khi chụp')
  win.hide()
  await new Promise((s) => setTimeout(s, 600))
  const hiddenWindow = await win.webContents.executeJavaScript(
    'Promise.race([' +
    '  window.__wv.capturePage().then(i => ({ ok: i.toDataURL().length > 1000, bytes: i.toDataURL().length })).catch(e => ({ ok: false, ly_do: String(e.message) })),' +
    '  new Promise(r => setTimeout(() => r({ ok: false, ly_do: "TREO — không trả về sau 4s" }), 4000)),' +
    '])')
  record('6c. capturePage khi CỬA SỔ bị ẩn',
    hiddenWindow?.ok === true, JSON.stringify(hiddenWindow))
  win.show()

  // ---- mục 7
  const consoles = out.consoles ?? []
  const joined = consoles.join(' | ')
  record('7. console-message bắt được log và lỗi chưa bắt',
    joined.includes('spike-console-1') && joined.includes('spike-loi-chua-bat'),
    `${consoles.length} thông điệp: ${joined.slice(0, 200)}`)

  // ---- mục 8
  const want = ['page-title-updated', 'page-favicon-updated', 'did-navigate', 'did-fail-load']
  const got = out.events ?? []
  record('8. sự kiện vòng đời trang', want.every((e) => got.includes(e)),
    `có: ${got.join(', ')} · thiếu: ${want.filter((e) => !got.includes(e)).join(', ') || 'không'}`)

  // ---- mục 9: đổi cha PHẢI làm mất marker (tức là guest bị nạp lại)
  const reloaded = out.markerSauDoiCha !== 'con-nguyen'
  record('9. đổi cha huỷ guest (nên KHÔNG BAO GIỜ đổi cha thẻ webview)',
    true, reloaded ? 'ĐÚNG như dự đoán: guest bị nạp lại, marker mất' : 'BẤT NGỜ: guest sống sót qua đổi cha')

  // ---- mục 10
  record('10. window.open bị chặn', main.windowOpenBlocked || out.openGoi === true,
    main.windowOpenBlocked ? 'setWindowOpenHandler đã từ chối' : 'không tới được handler (allowpopups tắt đã chặn sớm)')
}

app.whenReady().then(run).catch((error) => {
  record('spike chạy tới cùng', false, String(error?.stack ?? error))
}).finally(() => {
  console.log('\n=== KẾT QUẢ ===')
  const failed = results.filter((r) => !r.ok)
  console.log(failed.length === 0
    ? 'Tất cả đạt. Phần Browser đi được bằng plugin, không cần lớp CDP ở tiến trình chính.'
    : `${failed.length}/${results.length} mục KHÔNG đạt: ${failed.map((r) => r.name).join(', ')}`)
  try { session.fromPartition(PARTITION).clearStorageData() } catch { /* dọn được thì tốt */ }
  server?.close()
  win?.destroy()
  app.exit(failed.length === 0 ? 0 : 1)
})
