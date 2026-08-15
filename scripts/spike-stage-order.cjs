/**
 * Spike: vì sao tab Browser tải xong trang mà vùng trang vẫn trắng — nhưng chỉ
 * với một số trang.
 *
 * `spike-dock-ui.cjs` chạy đúng engine thật và plugin thật, và đo được:
 * `example.com` vẽ ra bình thường, `google.com` thì lệnh chụp trang TREO — dấu
 * hiệu tiến trình trang không sinh ra được khung hình nào. Bố cục không liên
 * quan: sân khấu chồng khít ô trống, không bị dìm, nằm đúng tầng trên.
 *
 * Spike này bỏ hết plugin và engine, chỉ còn thẻ `<webview>` trần trong đúng
 * cấu hình cửa sổ của lớp vỏ, để trả lời: lỗi nằm ở code của ta hay ở chính cơ
 * chế `<webview>`? Và nếu ở cơ chế, thì `WebContentsView` — thứ dự án tham
 * chiếu dùng — có bị không?
 *
 * ## Thước đo
 *
 * `guest.capturePage()` gọi TỪ TIẾN TRÌNH CHÍNH, có đặt giờ. Nó đòi một khung
 * hình từ bề mặt hiển thị của trang khách: trả về ảnh nghĩa là bề mặt sống,
 * treo nghĩa là không bao giờ có khung hình nào — tức màn hình trắng.
 *
 * Đã thử và ĐÃ BỎ hai thước khác, ghi lại để khỏi ai dò lại:
 * - `PrintWindow`: trả về cửa sổ trắng trơn cho MỌI trường hợp, mất cả khối màu
 *   do chính trang chủ vẽ. Nội dung Chromium vẽ bằng GPU không đi qua WM_PRINT.
 * - Chụp thẳng từ màn hình: cửa sổ spike không giành được tiêu điểm, nên ảnh
 *   thu về là màn hình của người đang ngồi máy. Vừa sai vừa không được phép.
 *
 *   node scripts/spike-stage-order.cjs
 */

if (process.env['ELECTRON_RUN_AS_NODE'] !== undefined) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']
  console.log('ELECTRON_RUN_AS_NODE đang bật — khởi động lại trong Electron thật.\n')
  const child = spawnSync(process.execPath, [__filename], { stdio: 'inherit', env })
  process.exit(child.status ?? 1)
}

const { app, BrowserWindow, WebContentsView, session, shell } = require('electron')
const { createServer } = require('node:http')

const PARTITION = 'persist:hdw-order'
const NHE = 'https://example.com/'
const NANG = process.env['HDW_URL'] ?? 'https://www.google.com/'

const cho = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []

function ghi(ten, ok, chiTiet) {
  results.push({ ten, ok })
  console.log(`${ok ? 'VẼ RA   ' : 'TRẮNG   '} ${ten} — ${chiTiet}`)
}

/**
 * Trang khách có ĐANG ĐƯỢC VẼ không.
 *
 * Đếm số lần `requestAnimationFrame` chạy trong một giây. Chromium chỉ cấp
 * khung hình cho thứ nó tin là có người nhìn; nếu bề mặt hiển thị chưa từng
 * được cấp thì `rAF` KHÔNG BAO GIỜ chạy — dù trang đã tải xong, đã có tiêu đề,
 * đã chạy đủ script. Đó chính là màn hình trắng, đo từ bên trong.
 *
 * Thước này không treo được (luôn có `setTimeout` chốt hạ), khác hẳn
 * `capturePage` — thứ đã treo thất thường trên cả trang biết chắc là vẽ ra.
 * @param {import('electron').WebContents} wc - trang khách.
 * @returns {Promise<{ok: boolean, mo_ta: string}>} kết quả đo.
 */
async function doBeMat(wc) {
  if (wc === undefined || wc.isDestroyed()) return { ok: false, mo_ta: 'không bắt được trang khách' }
  const kq = await Promise.race([
    wc.executeJavaScript(`new Promise((res) => {
      let n = 0
      const buoc = () => { n += 1; requestAnimationFrame(buoc) }
      requestAnimationFrame(buoc)
      setTimeout(() => res({ n, vis: document.visibilityState, w: innerWidth, h: innerHeight }), 1000)
    })`).catch((e) => ({ loi: e.message })),
    cho(6000).then(() => null),
  ])
  if (kq === null) return { ok: false, mo_ta: 'TREO — trang không trả lời sau 6s' }
  if (kq.loi !== undefined) return { ok: false, mo_ta: `lỗi: ${kq.loi}` }
  return {
    ok: kq.n > 0,
    mo_ta: `${kq.n} khung hình/giây, visibility=${kq.vis}, khung nhìn ${kq.w}x${kq.h}`,
  }
}

/** Trang chủ: sân khấu dựng đúng như `browser-stage.ts` làm trong app thật. */
const HOST = `<!doctype html>
<body style="margin:0;background:#fff">
<div style="position:fixed;left:0;top:0;width:50%;height:100%;background:#c00"></div>
<div style="position:fixed;right:0;top:0;width:50%;height:100%;background:#f4f4f6"></div>
<script>
const goc = document.createElement('div')
goc.style.position = 'fixed'
goc.style.overflow = 'hidden'
goc.style.zIndex = '-1'
document.body.append(goc)

window.__gan = (url) => {
  const el = document.createElement('webview')
  el.setAttribute('src', url)
  el.setAttribute('partition', ${JSON.stringify(PARTITION)})
  el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0'
  goc.append(el)
  goc.style.left = Math.round(innerWidth / 2) + 'px'
  goc.style.top = '0px'
  goc.style.width = Math.round(innerWidth / 2) + 'px'
  goc.style.height = innerHeight + 'px'
  goc.style.zIndex = '5'
}
</script>`

/** Server loopback — đúng như app thật, UI nạp từ `http://127.0.0.1`. */
function moServer() {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(HOST)
    })
    server.listen(0, '127.0.0.1', () => { resolve(server.address().port) })
  })
}

/** Đúng ba chốt an toàn của `src/main/window.ts`. Lệch là spike vô nghĩa. */
function chot(win) {
  win.webContents.on('will-attach-webview', (_e, prefs, params) => {
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    prefs.backgroundThrottling = false
    params.partition = PARTITION
    delete params.allowpopups
  })
  win.webContents.on('did-attach-webview', (_e, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http')) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}

/** Thẻ `<webview>` — cơ chế đang dùng. */
async function thuWebview(port, url, ten) {
  const win = new BrowserWindow({ width: 900, height: 650, show: true, webPreferences: { webviewTag: true } })
  chot(win)
  let guest
  win.webContents.on('did-attach-webview', (_e, g) => { guest = g })
  // Thử lại: cửa sổ thứ hai trở đi thỉnh thoảng bị ERR_FAILED ngay lần nạp đầu
  // từ cùng server loopback, và một lần thử lại là đủ.
  try {
    await win.loadURL(`http://127.0.0.1:${port}/`)
  } catch {
    await cho(800)
    await win.loadURL(`http://127.0.0.1:${port}/`)
  }
  await win.webContents.executeJavaScript(`window.__gan(${JSON.stringify(url)})`)
  await cho(9000)
  const kq = await doBeMat(guest)
  const thuc = guest === undefined || guest.isDestroyed() ? '?' : guest.getURL()
  ghi(ten, kq.ok, `${kq.mo_ta} — dừng ở ${thuc}`)
  win.destroy()
}

/** `WebContentsView` — cơ chế dự án tham chiếu dùng. */
async function thuView(url, ten) {
  const win = new BrowserWindow({ width: 900, height: 650, show: true })
  await win.loadURL('data:text/html,<body style="margin:0;background:%23c00">')
  const view = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: PARTITION },
  })
  win.contentView.addChildView(view)
  const [w, h] = win.getContentSize()
  view.setBounds({ x: Math.round(w / 2), y: 0, width: Math.round(w / 2), height: h })
  await view.webContents.loadURL(url).catch((e) => { console.log(`   (nạp hỏng: ${e.message})`) })
  await cho(9000)
  const kq = await doBeMat(view.webContents)
  ghi(ten, kq.ok, `${kq.mo_ta} — dừng ở ${view.webContents.getURL()}`)
  win.destroy()
}

app.whenReady().then(async () => {
  session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, _q, cb) => { cb(false) })
  const port = await moServer()

  // MỖI LẦN CHẠY CHỈ MỘT TRƯỜNG HỢP. Cửa sổ thứ hai trong cùng tiến trình chết
  // im lặng (không lỗi, không log) và kéo theo mọi mục sau nó — chạy chung thì
  // spike tự bịa ra kết luận "trắng" cho những thứ chưa từng được đo.
  const muc = process.argv.slice(2).find((a) => /^[123]$/.test(a)) ?? '1'
  if (muc === '1') await thuWebview(port, NHE, `1. <webview> + trang nhẹ (${NHE})`)
  if (muc === '2') await thuWebview(port, NANG, `2. <webview> + trang nặng (${NANG})`)
  if (muc === '3') await thuView(NANG, `3. WebContentsView + trang nặng (${NANG})`)
  app.exit(0)
}).catch((e) => { console.log('LỖI:', e.message); app.exit(1) })
