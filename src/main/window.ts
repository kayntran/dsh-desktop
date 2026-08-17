/**
 * Cửa sổ chính: màn hình chờ lúc engine đang lên, UI dsh khi engine sẵn sàng,
 * trang lỗi khi không lên được.
 *
 * Hai trang nội bộ (chờ, lỗi) không cần preload hay IPC: tiến trình chính tự
 * bơm nội dung vào bằng `executeJavaScript`, còn các nút bấm báo về bằng cách
 * điều hướng tới một scheme riêng mà `will-navigate` chặn lại. Nhờ vậy cửa sổ
 * giữ nguyên sandbox mặc định của Electron cho UI dsh nạp từ loopback.
 * @module
 */

import { app, BrowserWindow, Menu, nativeTheme, session, shell } from 'electron'
import { logShell } from './log.js'
import { resourcePath } from './paths.js'
import { trackGuest } from './shot-link.js'
import { restoreState, trackState } from './window-state.js'

/** Tiền tố điều hướng mà các nút trên trang nội bộ dùng để gọi về tiến trình chính. */
const ACTION_SCHEME = 'harness-action:'

/**
 * Phiên riêng cho mọi trang mở trong tab Browser.
 *
 * `persist:` để cookie sống qua các lần mở app — đăng nhập một lần rồi thôi.
 * Tách khỏi phiên của app để trang web không đọc được gì thuộc về UI dsh, và
 * để nút "xoá dữ liệu duyệt web" sau này không đụng tới phần còn lại.
 */
const BROWSER_PARTITION = 'persist:hdw-browser'

/** Nội dung trang lỗi. */
export interface EngineErrorPayload {
  /** Câu mô tả lỗi cho người dùng. */
  message: string
  /** Đoạn log cuối của engine, cho người rành kỹ thuật. */
  tail: string
}

let window: BrowserWindow | undefined
let quitting = false

/**
 * Gốc của engine (`http://127.0.0.1:<cổng>`), khi engine đã lên.
 *
 * Giữ lại để chốt ở {@link blockEngineOrigin} biết phải chặn cái gì. Cổng do
 * engine tự chọn lúc chạy nên không viết cứng được.
 */
let engineOrigin: string | undefined

/** Cửa sổ chính, nếu đang tồn tại. */
export function mainWindow(): BrowserWindow | undefined {
  return window
}

/**
 * Đánh dấu app đang thoát thật, để lần đóng cửa sổ tới không bị chuyển thành
 * thu về khay.
 */
export function beginQuit(): void {
  quitting = true
}

/** Hiện và đưa cửa sổ lên trước, khôi phục nếu đang thu nhỏ hoặc đang ẩn. */
export function revealWindow(): void {
  const target = window
  if (target === undefined) return
  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
}

/** Cửa sổ có đang hiện ra trước mặt người dùng không — dùng để quyết định có nên báo. */
export function isWindowActive(): boolean {
  const target = window
  return target !== undefined && target.isVisible() && !target.isMinimized() && target.isFocused()
}

/** Những việc cửa sổ gọi ngược về tiến trình chính. */
export interface WindowHandlers {
  /** Nhận tên hành động người dùng bấm trên trang nội bộ. */
  onAction: (action: string) => void
  /** Gọi khi cửa sổ vừa được thu về khay thay vì đóng hẳn. */
  onHiddenToTray: () => void
}

/**
 * Ghi lại gốc của engine để chốt 4 biết phải chặn cái gì.
 *
 * Tách khỏi {@link showEngine} để bài kiểm gọi được: `scripts/spike-dock-ui.cjs`
 * dựng cửa sổ của riêng nó và dùng **chính** hàm chốt ở dưới, chứ không chép
 * lại. Bản chép là thứ trôi khỏi bản gốc mà không ai biết, và một chốt an toàn
 * được kiểm bằng bản sao của chính nó thì không kiểm gì cả.
 * @param url - địa chỉ engine đang chạy.
 */
export function setEngineOrigin(url: string): void {
  try {
    engineOrigin = new URL(url).origin
  } catch {
    engineOrigin = undefined
  }
}

/**
 * Bốn chốt an toàn cho mọi thẻ `<webview>` mà plugin gắn vào trang.
 *
 * Chốt phải nằm ở đây, ngoài tầm với của plugin — một chốt mà bên bị chặn tự
 * đặt được thì không phải chốt. Trang web mở trong tab Browser là nội dung
 * không tin được: nó có thể là trang bất kỳ, và agent có thể được chính nó dụ
 * đi tới đó.
 *
 * Mọi giá trị dưới đây đã được `scripts/spike-webview.cjs` đo là có hiệu lực
 * thật (mục 2 đọc lại `getLastWebPreferences()` của guest để xác nhận).
 * @param win - cửa sổ chính.
 */
export function guardWebviews(win: BrowserWindow): void {
  // Chốt 1 — ép cấu hình guest, bỏ qua mọi thuộc tính trang tự khai.
  win.webContents.on('will-attach-webview', (_event, prefs, params) => {
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    // Trang nền vẫn chạy đúng nhịp. Không có dòng này thì Chromium bóp timer
    // của tab không hiện, và lệnh "chờ tới khi phần tử xuất hiện" của agent sẽ
    // hết giờ oan trên chính những tab nó vừa mở.
    prefs.backgroundThrottling = false
    // Ép phiên: quyết định trang web dùng chung kho cookie nào là quyết định
    // của lớp vỏ, không phải của thẻ HTML.
    params.partition = BROWSER_PARTITION
    // Không cho trang nhúng mở popup. Bỏ thuộc tính này là chặn từ sớm, trước
    // cả khi handler ở chốt 2 kịp chạy.
    delete params.allowpopups
  })

  // Chốt 2 — trang nhúng không đẻ được cửa sổ mới. `target=_blank` và
  // `window.open` đều về đây; link ngoài mở bằng trình duyệt mặc định.
  win.webContents.on('did-attach-webview', (_event, guest) => {
    // Ghi vào danh sách cho phép của đường chụp ảnh. Chỉ những trang lớp vỏ tự
    // tay gắn vào mới chụp được — không ai chụp được giao diện engine hay cửa
    // sổ nào khác của app.
    trackGuest(guest)
    guest.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })

  // Chốt 3 — từ chối thẳng camera, micro, vị trí và các quyền nhạy cảm khác
  // trên phiên duyệt web. Người dùng không có cách nào bật nhầm, vì không có
  // hộp thoại nào để bấm.
  const browserSession = session.fromPartition(BROWSER_PARTITION)
  browserSession.setPermissionRequestHandler((_wc, _quyen, callback) => {
    callback(false)
  })

  // Chốt 4 — không tab web nào được mở giao diện của chính engine.
  //
  // Lỗ này là lỗ leo thang nguy hiểm nhất, và nó không đi qua đường mà rào địa
  // chỉ canh: agent đưa một địa chỉ công cộng hợp lệ, trang đó trả về lệnh
  // chuyển hướng sang `http://127.0.0.1:<cổng engine>/`. Phép kiểm lúc mở đã
  // chạy xong và đã cho qua; cú chuyển hướng xảy ra sau đó. Kết quả: agent có
  // một tab điều khiển được đứng ngay TRONG giao diện engine, và nó tự bấm nút
  // thay người dùng được.
  //
  // Chặn ở tầng request nên bắt được cả ba đường — mở thẳng, chuyển hướng của
  // máy chủ, và trang tự đổi địa chỉ bằng script.
  //
  // Chốt này nằm ở lớp vỏ chứ không ở plugin, và đó là chủ ý: một chốt mà bên
  // bị chặn tự đặt được thì bên đó cũng tự gỡ được. Lớp vỏ bảo vệ engine mà
  // chính nó khởi động.
  //
  // Cái giá cho người dùng bằng không: không ai có lý do mở giao diện engine
  // bên trong tab Browser của chính engine đó.
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    if (engineOrigin === undefined) { callback({}); return }
    try {
      if (new URL(details.url).origin === engineOrigin) {
        logShell(`blocked a web tab from entering the engine UI: ${details.url}`)
        callback({ cancel: true })
        return
      }
    } catch { /* URL lạ (data:, blob:) — không phải gốc engine */ }
    callback({})
  })
}

/** Tạo cửa sổ và hiện màn hình chờ ngay lập tức. */
export function createWindow({ onAction, onHiddenToTray }: WindowHandlers): BrowserWindow {
  // Menu mặc định của Electron (File/Edit/View/Window/Help) không thuộc về app
  // này — nó còn trỏ Help sang trang của Electron. Chức năng cửa sổ nằm ở menu
  // khay hệ thống thay vì một thanh menu chiếm chỗ.
  Menu.setApplicationMenu(null)

  const state = restoreState()
  const created = new BrowserWindow({
    ...state.bounds,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Nền cùng tông với hai trang nội bộ, để lúc chuyển trang không loé trắng.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16161a' : '#fbfbfd',
    title: app.getName(),
    icon: resourcePath('icon.ico'),
    webPreferences: {
      // Cho phép plugin dùng thẻ `<webview>` — nền tảng của tab Browser.
      //
      // Đây KHÔNG phải nới lỏng bảo mật của trang chủ: `webviewTag` chỉ mở ra
      // khả năng *nhúng* một trang khác, và mọi quyền của trang nhúng đó do
      // `will-attach-webview` bên dưới quyết định, không do trang nhúng tự khai.
      // Không API nào cho phép trang tự bật cờ này.
      webviewTag: true,
    },
  })

  guardWebviews(created)

  // Link ngoài (tài liệu, GitHub…) mở bằng trình duyệt mặc định chứ không đẻ
  // thêm một cửa sổ Electron trần không có thanh địa chỉ.
  created.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  created.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ACTION_SCHEME)) return
    event.preventDefault()
    onAction(url.slice(ACTION_SCHEME.length))
  })

  // UI thượng nguồn tự đặt tiêu đề tài liệu là "DeepSeek Harness". App này
  // không phải bản chính chủ của DeepSeek nên thanh tiêu đề mang tên app;
  // phần ghi công thượng nguồn nằm ở màn hình Giới thiệu.
  created.on('page-title-updated', (event) => {
    event.preventDefault()
    created.setTitle(app.getName())
  })

  // Không có thanh menu thì cũng không còn phím tắt mặc định. Giữ lại hai cái
  // cần cho việc hỗ trợ người dùng từ xa: xem console và nạp lại trang. Chặn
  // luôn phím đã xử lý, nếu không UI thượng nguồn cũng nhận được nó và một lần
  // bấm thành hai hành động.
  created.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F12') {
      event.preventDefault()
      created.webContents.toggleDevTools()
    } else if (input.key.toLowerCase() === 'r' && input.control && !input.alt && !input.shift) {
      event.preventDefault()
      created.webContents.reload()
    }
  })

  // Bấm X thu app về khay chứ không tắt: agent có thể đang chạy một việc dài,
  // và đóng cửa sổ không phải là ý định dừng nó. Chỉ lệnh Thoát mới dừng thật.
  created.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    created.hide()
    onHiddenToTray()
  })

  created.once('ready-to-show', () => {
    if (state.maximized) created.maximize()
    created.show()
  })
  void created.loadFile(resourcePath('splash.html'))

  trackState(created)
  window = created
  created.on('closed', () => { window = undefined })
  return created
}

/** Quay lại màn hình chờ (dùng khi người dùng bấm Thử lại). */
export async function showSplash(): Promise<void> {
  await window?.loadFile(resourcePath('splash.html'))
}

/** Chuyển cửa sổ sang UI dsh. */
export async function showEngine(url: string): Promise<void> {
  setEngineOrigin(url)
  await window?.loadURL(url)
}

/** Nội dung màn hình Giới thiệu. */
export interface AboutInfo {
  name: string
  appVersion: string
  dshVersion: string
  nodeVersion: string
  electronVersion: string
  dataDir: string
}

let aboutWindow: BrowserWindow | undefined

/**
 * Mở màn hình Giới thiệu — nơi ghi công thượng nguồn và nói rõ đây không phải
 * sản phẩm chính chủ. Một cửa sổ riêng, nhỏ, không thay thế UI đang chạy.
 */
export async function showAbout(info: AboutInfo): Promise<void> {
  if (aboutWindow !== undefined && !aboutWindow.isDestroyed()) {
    aboutWindow.focus()
    return
  }
  const created = new BrowserWindow({
    width: 620,
    height: 620,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'About',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16161a' : '#fbfbfd',
    icon: resourcePath('icon.ico'),
    show: false,
  })
  created.setMenuBarVisibility(false)
  created.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  created.once('ready-to-show', () => { created.show() })
  created.on('closed', () => { aboutWindow = undefined })
  aboutWindow = created
  await created.loadFile(resourcePath('about.html'))
  await created.webContents.executeJavaScript(`window.__setAbout(${JSON.stringify(info)})`)
}

/** Chuyển cửa sổ sang trang lỗi, kèm mô tả và đoạn log cuối. */
export async function showError(payload: EngineErrorPayload): Promise<void> {
  const target = window
  if (target === undefined) return
  await target.loadFile(resourcePath('error.html'))
  // Trang lỗi là tài nguyên của chính app và payload do ta dựng, nên bơm thẳng
  // qua một lời gọi hàm là đủ — không cần cầu IPC cho hai nút bấm.
  await target.webContents.executeJavaScript(`window.__setError(${JSON.stringify(payload)})`)
}
