/**
 * ⚠️ THIS SPIKE NO LONGER RUNS, AND ITS MEASURE LIES.
 *
 * It scored with `dem-pixel.ps1` (PrintWindow). Re-measured on 2026-08-15: PrintWindow
 * returns a COMPLETELY BLANK window in every case — losing even the red block the host
 * page painted itself, let alone the guest page. Chromium's GPU-painted content does not
 * travel through WM_PRINT. So every "APPEARED / BLANK" verdict here is meaningless, and
 * `dem-pixel.ps1` has been deleted.
 *
 * The replacement measures, used in `spike-dock-ui.cjs` checks 4c and 4d:
 *   - count `requestAnimationFrame` inside the guest page (is it being granted frames)
 *   - ray-cast into the middle of the web slot, looking for any `hdw-*` element with an
 *     opaque background painted over it
 * See MY-CHANGES.md, the 2026-08-15 entry.
 *
 * ---
 *
 * An architecture-deciding spike: between the `<webview>` tag and `WebContentsView`,
 * which one actually APPEARS ON SCREEN in this app's environment?
 *
 * Why this spike existed at all, given stage 0 already had `spike-webview.cjs`: the gate
 * there asked "does the tag attach, do the APIs work, does dom-ready fire" — and all of
 * those were YES. But attaching does not mean appearing. A guest page paints its picture
 * onto its own surface; the real question is whether that surface is COMPOSITED into the
 * window's frame. Every capture taken from inside the page — the guest's `capturePage`,
 * `Page.captureScreenshot` over CDP — returns the picture the guest painted itself, so all
 * of them answer "yes" even when the screen is entirely blank.
 *
 * The only trustworthy measure: **a real screen capture** via PrintWindow, taken and
 * counted by `dem-pixel.ps1`.
 *
 * Each window's layout: the LEFT half is a red block painted by the host page itself (the
 * control — if the left half is blank too, the capture is broken, not the mechanism), and
 * the RIGHT half is a real web page.
 *
 *   npm run spike:surface
 */

if (process.env['ELECTRON_RUN_AS_NODE'] !== undefined) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']
  console.log('ELECTRON_RUN_AS_NODE đang bật — khởi động lại trong Electron thật.\n')
  const child = spawnSync(process.execPath, [__filename], { stdio: 'inherit', env })
  process.exit(child.status ?? 1)
}

const { app, BrowserWindow, WebContentsView } = require('electron')
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const TEST_PAGE = 'https://example.com/'
const PARTITION = 'persist:hdw-surface'
const COUNTER_SCRIPT = join(
  process.env['LOCALAPPDATA'] ?? '',
  'Temp', 'claude', 'd--AI-DeepSeek-Harness-Desktop',
  'b4c156d8-0082-4206-88bf-03a0ec6c32d6', 'scratchpad', 'dem-pixel.ps1',
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []

/** The host page: nothing but a red block on the left half. The right half is left for the guest. */
const RED_BACKDROP = `data:text/html,${encodeURIComponent(
  '<!doctype html><body style="margin:0;background:#fff">'
  + '<div style="position:fixed;left:0;top:0;width:50%;height:100%;background:#c00"></div>',
)}`

/** The host page with a webview tag already on the right half. */
const WITH_WEBVIEW = `data:text/html,${encodeURIComponent(
  '<!doctype html><body style="margin:0;background:#fff">'
  + '<div style="position:fixed;left:0;top:0;width:50%;height:100%;background:#c00"></div>'
  + `<webview src="${TEST_PAGE}" partition="${PARTITION}"`
  + ' style="position:fixed;right:0;top:0;width:50%;height:100%"></webview>',
)}`

/** Call PowerShell to take a real screen capture and count pixels. */
function measureScreen(title) {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', COUNTER_SCRIPT, '-Title', title], {
    encoding: 'utf8',
  })
  return (r.stdout ?? '').trim() || (r.stderr ?? '').trim() || '(không có output)'
}

function record(name, line) {
  const match = /trai=(\d+) phai=(\d+)/.exec(line)
  const ok = match !== null && Number(match[2]) > 30 && Number(match[1]) > 30
  results.push({ name, ok })
  console.log(`${ok ? 'HIỆN LÊN ' : 'TRẮNG    '} ${name} — ${line}`)
  if (match !== null && Number(match[1]) <= 30) {
    console.log('           (mốc đỏ nửa trái cũng trắng → phép chụp hỏng, không kết luận được)')
  }
}

// --- A. the <webview> tag, configured exactly like the real shell ------------

async function tryWebview() {
  const TITLE = 'HDW-A-WEBVIEW'
  const win = new BrowserWindow({
    width: 900, height: 650, show: true, title: TITLE,
    webPreferences: { webviewTag: true },
  })
  win.setTitle(TITLE)
  win.on('page-title-updated', (e) => { e.preventDefault() })
  win.webContents.on('will-attach-webview', (_e, prefs, params) => {
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    prefs.backgroundThrottling = false
    params.partition = PARTITION
    delete params.allowpopups
  })
  await win.loadURL(WITH_WEBVIEW)
  await sleep(8000)
  record('A. thẻ <webview> (cách hiện tại của ta)', measureScreen(TITLE))
  win.destroy()
}

// --- B. WebContentsView, the way the reference project does it ---------------

async function tryWebContentsView() {
  const TITLE = 'HDW-B-WEBCONTENTSVIEW'
  const win = new BrowserWindow({ width: 900, height: 650, show: true, title: TITLE })
  win.setTitle(TITLE)
  win.on('page-title-updated', (e) => { e.preventDefault() })
  await win.loadURL(RED_BACKDROP)

  const view = new WebContentsView({
    webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      partition: PARTITION,
    },
  })
  win.contentView.addChildView(view)
  const [w, h] = win.getContentSize()
  view.setBounds({ x: Math.round(w / 2), y: 0, width: Math.round(w / 2), height: h })
  await view.webContents.loadURL(TEST_PAGE)
  await sleep(8000)
  record('B. WebContentsView (cách dự án tham chiếu)', measureScreen(TITLE))
  win.destroy()
}

app.whenReady().then(async () => {
  await tryWebview()
  await tryWebContentsView()

  console.log('\n=== KẾT QUẢ ===')
  const appeared = results.filter((r) => r.ok)
  if (appeared.length === results.length) {
    console.log('Cả hai đều hiện được — lỗi trang trắng nằm ở code của panel, không ở cơ chế.')
  } else if (appeared.length === 0) {
    console.log('KHÔNG cơ chế nào hiện được — nghi phép chụp hoặc môi trường, xem dòng mốc đỏ ở trên.')
  } else {
    console.log(`Chỉ ${appeared.map((r) => r.name[0]).join(', ')} hiện được — đó là cơ chế phải dùng.`)
  }
  app.exit(0)
}).catch((e) => { console.log('LỖI:', e.message); app.exit(1) })
