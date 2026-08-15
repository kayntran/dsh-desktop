/**
 * ⚠️ SPIKE NÀY KHÔNG CÒN CHẠY ĐƯỢC, VÀ THƯỚC ĐO CỦA NÓ NÓI DỐI.
 *
 * Nó chấm điểm bằng `dem-pixel.ps1` (PrintWindow). Ngày 2026-08-15 đã đo lại:
 * PrintWindow trả về một cửa sổ TRẮNG TRƠN cho mọi trường hợp — mất cả khối đỏ
 * mà chính trang chủ vẽ, chứ chưa nói tới trang khách. Nội dung Chromium vẽ
 * bằng GPU không đi qua đường WM_PRINT. Nên mọi kết luận "HIỆN LÊN / TRẮNG" ở
 * đây đều vô nghĩa, và `dem-pixel.ps1` đã bị xoá.
 *
 * Thước thay thế, dùng trong `spike-dock-ui.cjs` mục 4c và 4d:
 *   - đếm `requestAnimationFrame` trong trang khách (có được cấp khung hình không)
 *   - bắn tia vào giữa ô trang web, tìm phần tử `hdw-*` nào có nền đục sơn đè lên
 * Xem MY-CHANGES.md, mục ngày 2026-08-15.
 *
 * ---
 *
 * Spike quyết định kiến trúc: thẻ `<webview>` và `WebContentsView` — cái nào
 * thật sự HIỆN LÊN MÀN HÌNH trong môi trường của app này.
 *
 * Vì sao phải có spike này, dù giai đoạn 0 đã có `spike-webview.cjs`: cổng gác
 * ở đó hỏi "thẻ có gắn được không, API có gọi được không, dom-ready có nổ
 * không" — và tất cả đều CÓ. Nhưng gắn được không có nghĩa là hiện lên. Trang
 * khách vẽ hình của nó vào một bề mặt riêng; câu hỏi thật là bề mặt đó có được
 * GHÉP vào khung hình của cửa sổ không. Mọi phép chụp từ bên trong trang —
 * `capturePage` của guest, `Page.captureScreenshot` qua CDP — đều trả về hình
 * guest tự vẽ, nên đều trả lời "có" kể cả khi màn hình trắng trơn.
 *
 * Thước đo duy nhất đáng tin: **ảnh màn hình thật** bằng PrintWindow, do
 * `dem-pixel.ps1` chụp và đếm.
 *
 * Bố cục mỗi cửa sổ: nửa TRÁI là một khối đỏ do chính trang chủ vẽ (mốc đối
 * chứng — nếu nửa trái cũng trắng thì phép chụp hỏng, không phải cơ chế hỏng),
 * nửa PHẢI là trang web thật.
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

const TRANG = 'https://example.com/'
const PARTITION = 'persist:hdw-surface'
const DEM = join(
  process.env['LOCALAPPDATA'] ?? '',
  'Temp', 'claude', 'd--AI-DeepSeek-Harness-Desktop',
  'b4c156d8-0082-4206-88bf-03a0ec6c32d6', 'scratchpad', 'dem-pixel.ps1',
)

const cho = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []

/** Trang chủ: chỉ một khối đỏ nửa trái. Nửa phải để trống cho trang khách. */
const NEN_DO = `data:text/html,${encodeURIComponent(
  '<!doctype html><body style="margin:0;background:#fff">'
  + '<div style="position:fixed;left:0;top:0;width:50%;height:100%;background:#c00"></div>',
)}`

/** Trang chủ có sẵn thẻ webview nửa phải. */
const CO_WEBVIEW = `data:text/html,${encodeURIComponent(
  '<!doctype html><body style="margin:0;background:#fff">'
  + '<div style="position:fixed;left:0;top:0;width:50%;height:100%;background:#c00"></div>'
  + `<webview src="${TRANG}" partition="${PARTITION}"`
  + ' style="position:fixed;right:0;top:0;width:50%;height:100%"></webview>',
)}`

/** Gọi PowerShell chụp màn hình thật và đếm pixel. */
function doManHinh(title) {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', DEM, '-Title', title], {
    encoding: 'utf8',
  })
  return (r.stdout ?? '').trim() || (r.stderr ?? '').trim() || '(không có output)'
}

function ghi(ten, dong) {
  const m = /trai=(\d+) phai=(\d+)/.exec(dong)
  const ok = m !== null && Number(m[2]) > 30 && Number(m[1]) > 30
  results.push({ ten, ok })
  console.log(`${ok ? 'HIỆN LÊN ' : 'TRẮNG    '} ${ten} — ${dong}`)
  if (m !== null && Number(m[1]) <= 30) {
    console.log('           (mốc đỏ nửa trái cũng trắng → phép chụp hỏng, không kết luận được)')
  }
}

// --- A. thẻ <webview>, cấu hình y hệt lớp vỏ thật -------------------------

async function thuWebview() {
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
  await win.loadURL(CO_WEBVIEW)
  await cho(8000)
  ghi('A. thẻ <webview> (cách hiện tại của ta)', doManHinh(TITLE))
  win.destroy()
}

// --- B. WebContentsView, đúng cách dự án tham chiếu làm --------------------

async function thuWebContentsView() {
  const TITLE = 'HDW-B-WEBCONTENTSVIEW'
  const win = new BrowserWindow({ width: 900, height: 650, show: true, title: TITLE })
  win.setTitle(TITLE)
  win.on('page-title-updated', (e) => { e.preventDefault() })
  await win.loadURL(NEN_DO)

  const view = new WebContentsView({
    webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      partition: PARTITION,
    },
  })
  win.contentView.addChildView(view)
  const [w, h] = win.getContentSize()
  view.setBounds({ x: Math.round(w / 2), y: 0, width: Math.round(w / 2), height: h })
  await view.webContents.loadURL(TRANG)
  await cho(8000)
  ghi('B. WebContentsView (cách dự án tham chiếu)', doManHinh(TITLE))
  win.destroy()
}

app.whenReady().then(async () => {
  await thuWebview()
  await thuWebContentsView()

  console.log('\n=== KẾT QUẢ ===')
  const hien = results.filter((r) => r.ok)
  if (hien.length === results.length) {
    console.log('Cả hai đều hiện được — lỗi trang trắng nằm ở code của panel, không ở cơ chế.')
  } else if (hien.length === 0) {
    console.log('KHÔNG cơ chế nào hiện được — nghi phép chụp hoặc môi trường, xem dòng mốc đỏ ở trên.')
  } else {
    console.log(`Chỉ ${hien.map((r) => r.ten[0]).join(', ')} hiện được — đó là cơ chế phải dùng.`)
  }
  app.exit(0)
}).catch((e) => { console.log('LỖI:', e.message); app.exit(1) })
