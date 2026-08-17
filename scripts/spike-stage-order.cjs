/**
 * Spike: why the Browser tab finishes loading a page while the page area stays blank —
 * but only for some pages.
 *
 * `spike-dock-ui.cjs` runs against the real engine and the real plugin, and it measured
 * this: `example.com` paints normally, while on `google.com` the page-capture command
 * HANGS — the sign of a renderer producing no frames at all. Layout is not involved: the
 * stage sits exactly over the empty slot, is not sunk, and is on the correct layer.
 *
 * This spike drops the plugin and the engine entirely, leaving a bare `<webview>` tag in
 * the shell's exact window configuration, to answer one question: is the fault in our code
 * or in the `<webview>` mechanism itself? And if it is the mechanism, does
 * `WebContentsView` — what the reference project uses — suffer the same?
 *
 * ## The measure
 *
 * `guest.capturePage()` called FROM THE MAIN PROCESS, with a deadline. It demands a frame
 * from the guest page's display surface: an image back means the surface is alive; a hang
 * means there was never any frame at all — that is, a blank screen.
 *
 * Two other measures were tried and DROPPED, recorded here so nobody re-derives them:
 * - `PrintWindow`: returns a completely blank window in EVERY case, losing even the color
 *   block the host page painted itself. Chromium's GPU-painted content does not travel
 *   through WM_PRINT.
 * - Capturing the screen directly: the spike window never wins focus, so the image
 *   captured is whatever the person at the machine is looking at. Both wrong and not
 *   permissible.
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
const LIGHT_PAGE = 'https://example.com/'
const HEAVY_PAGE = process.env['HDW_URL'] ?? 'https://www.google.com/'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []

function record(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'VẼ RA   ' : 'TRẮNG   '} ${name} — ${detail}`)
}

/**
 * Whether the guest page is BEING PAINTED.
 *
 * Counts how many times `requestAnimationFrame` runs in one second. Chromium only grants
 * frames to something it believes is being watched; if a display surface was never
 * allocated, `rAF` NEVER runs — even though the page has finished loading, has a title,
 * and has run all its scripts. That is a blank screen, measured from inside.
 *
 * This measure cannot hang (a `setTimeout` always settles it), unlike `capturePage` —
 * which has hung erratically even on pages known to paint.
 * @param {import('electron').WebContents} wc - the guest page.
 * @returns {Promise<{ok: boolean, detail: string}>} the measurement.
 */
async function measureSurface(wc) {
  if (wc === undefined || wc.isDestroyed()) return { ok: false, detail: 'không bắt được trang khách' }
  const outcome = await Promise.race([
    wc.executeJavaScript(`new Promise((res) => {
      let n = 0
      const step = () => { n += 1; requestAnimationFrame(step) }
      requestAnimationFrame(step)
      setTimeout(() => res({ n, vis: document.visibilityState, w: innerWidth, h: innerHeight }), 1000)
    })`).catch((e) => ({ error: e.message })),
    sleep(6000).then(() => null),
  ])
  if (outcome === null) return { ok: false, detail: 'TREO — trang không trả lời sau 6s' }
  if (outcome.error !== undefined) return { ok: false, detail: `lỗi: ${outcome.error}` }
  return {
    ok: outcome.n > 0,
    detail: `${outcome.n} khung hình/giây, visibility=${outcome.vis}, khung nhìn ${outcome.w}x${outcome.h}`,
  }
}

/** The host page: a stage built exactly as `browser-stage.ts` builds it in the real app. */
const HOST = `<!doctype html>
<body style="margin:0;background:#fff">
<div style="position:fixed;left:0;top:0;width:50%;height:100%;background:#c00"></div>
<div style="position:fixed;right:0;top:0;width:50%;height:100%;background:#f4f4f6"></div>
<script>
const stageRoot = document.createElement('div')
stageRoot.style.position = 'fixed'
stageRoot.style.overflow = 'hidden'
stageRoot.style.zIndex = '-1'
document.body.append(stageRoot)

window.__attach = (url) => {
  const el = document.createElement('webview')
  el.setAttribute('src', url)
  el.setAttribute('partition', ${JSON.stringify(PARTITION)})
  el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0'
  stageRoot.append(el)
  stageRoot.style.left = Math.round(innerWidth / 2) + 'px'
  stageRoot.style.top = '0px'
  stageRoot.style.width = Math.round(innerWidth / 2) + 'px'
  stageRoot.style.height = innerHeight + 'px'
  stageRoot.style.zIndex = '5'
}
</script>`

/** A loopback server — like the real app, whose UI loads from `http://127.0.0.1`. */
function startServer() {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(HOST)
    })
    server.listen(0, '127.0.0.1', () => { resolve(server.address().port) })
  })
}

/** Exactly the three guards from `src/main/window.ts`. Drifting makes the spike meaningless. */
function applyGuards(win) {
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

/** The `<webview>` tag — the mechanism currently in use. */
async function tryWebview(port, url, name) {
  const win = new BrowserWindow({ width: 900, height: 650, show: true, webPreferences: { webviewTag: true } })
  applyGuards(win)
  let guest
  win.webContents.on('did-attach-webview', (_e, g) => { guest = g })
  // Retry: from the second window onward, the first load from the same loopback server
  // occasionally fails with ERR_FAILED, and one retry is enough.
  try {
    await win.loadURL(`http://127.0.0.1:${port}/`)
  } catch {
    await sleep(800)
    await win.loadURL(`http://127.0.0.1:${port}/`)
  }
  await win.webContents.executeJavaScript(`window.__attach(${JSON.stringify(url)})`)
  await sleep(9000)
  const outcome = await measureSurface(guest)
  const landedOn = guest === undefined || guest.isDestroyed() ? '?' : guest.getURL()
  record(name, outcome.ok, `${outcome.detail} — dừng ở ${landedOn}`)
  win.destroy()
}

/** `WebContentsView` — the mechanism the reference project uses. */
async function tryView(url, name) {
  const win = new BrowserWindow({ width: 900, height: 650, show: true })
  await win.loadURL('data:text/html,<body style="margin:0;background:%23c00">')
  const view = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: PARTITION },
  })
  win.contentView.addChildView(view)
  const [w, h] = win.getContentSize()
  view.setBounds({ x: Math.round(w / 2), y: 0, width: Math.round(w / 2), height: h })
  await view.webContents.loadURL(url).catch((e) => { console.log(`   (nạp hỏng: ${e.message})`) })
  await sleep(9000)
  const outcome = await measureSurface(view.webContents)
  record(name, outcome.ok, `${outcome.detail} — dừng ở ${view.webContents.getURL()}`)
  win.destroy()
}

app.whenReady().then(async () => {
  session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, _permission, cb) => { cb(false) })
  const port = await startServer()

  // ONE CASE PER RUN. The second window in the same process dies silently (no error, no
  // log) and drags every check after it down — run together, the spike invents a "blank"
  // verdict for things that were never measured.
  const which = process.argv.slice(2).find((a) => /^[123]$/.test(a)) ?? '1'
  if (which === '1') await tryWebview(port, LIGHT_PAGE, `1. <webview> + trang nhẹ (${LIGHT_PAGE})`)
  if (which === '2') await tryWebview(port, HEAVY_PAGE, `2. <webview> + trang nặng (${HEAVY_PAGE})`)
  if (which === '3') await tryView(HEAVY_PAGE, `3. WebContentsView + trang nặng (${HEAVY_PAGE})`)
  app.exit(0)
}).catch((e) => { console.log('LỖI:', e.message); app.exit(1) })
