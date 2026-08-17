/**
 * Điểm vào của app: dựng cửa sổ và khay, đưa engine lên, nối chúng lại.
 * @module
 */

import { app, shell } from 'electron'
import { EngineStartError, reapOrphanEngine, startEngine, stopEngine } from './engine.js'
import { logShell, shellLogPath } from './log.js'
import { dshHome, dshVersion, engineLogPath, nodeVersion } from './paths.js'
import { startNotifier, stopNotifier } from './notifier.js'
import { startShotLink, stopShotLink } from './shot-link.js'
import { linkPlugins } from './plugin-link.js'
import {
  createTray, destroyTray, hintHiddenToTray, setTrayStatus, setTrayUpdate,
} from './tray.js'
import { openReleasePage, startUpdateChecks, stopUpdateChecks } from './updates.js'
import {
  beginQuit, createWindow, isWindowActive, revealWindow, showAbout, showEngine, showError, showSplash,
} from './window.js'

/**
 * Chỉ cho phép một bản app chạy. Hai bản sẽ dựng hai engine cùng ghi vào một
 * thư mục dữ liệu — hỏng lịch sử phiên, nhân đôi job nền, nhân đôi thông báo.
 * Bản thứ hai nhường chỗ và đánh thức bản đang chạy.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  /**
   * Tắt phép dò che khuất cửa sổ của Chromium trên Windows.
   *
   * Phép dò này đánh dấu cửa sổ "bị che hoàn toàn" là ẩn để tiết kiệm pin, và
   * nó có một lỗi đã thành kinh điển: trạng thái ẩn KẸT lại kể cả khi cửa sổ đã
   * lên tiền cảnh. Đo được trên chính app này: cửa sổ đang bày trên màn hình mà
   * trang chính báo `document.visibilityState === 'hidden'` và
   * `requestAnimationFrame` không bao giờ nổ — trong khi cả bốn webview con
   * đều tự thấy mình "visible". Hậu quả người dùng nhìn thấy: vùng trang web
   * trong panel trắng trơn dù trang đã nạp xong và tự vẽ được trong bộ nhớ
   * (ảnh chụp qua CDP vẫn đầy đủ), vì trang chủ ngừng phát khung hình nên bề
   * mặt của guest không bao giờ được ghép lên màn.
   *
   * Phải đặt TRƯỚC `app.whenReady()` — sau đó Chromium đã đọc xong cờ.
   */
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

  app.setName('Harness Desktop')
  // Windows gắn thông báo vào một AppUserModelID; không đặt thì toast hiện
  // dưới tên tiến trình Electron thay vì tên app.
  app.setAppUserModelId('com.harness-desktop.app')
  app.on('second-instance', () => { revealWindow() })

  void app.whenReady().then(async () => {
    logShell(`app: starting ${app.getName()} ${app.getVersion()} (packaged: ${String(app.isPackaged)})`)
    // Lần chạy trước có thể bị tắt cứng và để lại engine giữ cổng.
    reapOrphanEngine()
    // Phải xong TRƯỚC khi engine lên: engine quét cây plugin lúc khởi động.
    linkPlugins()
    createTray({
      open: revealWindow,
      openDataDir: () => { void shell.openPath(dshHome()) },
      openLog: () => { void shell.openPath(engineLogPath()) },
      openShellLog: () => { void shell.openPath(shellLogPath()) },
      openRelease: openReleasePage,
      openAbout: () => {
        void showAbout({
          name: app.getName(),
          appVersion: app.getVersion(),
          dshVersion: dshVersion(),
          nodeVersion: nodeVersion(),
          electronVersion: process.versions.electron,
          dataDir: dshHome(),
        })
      },
      quit: quitApp,
    })
    createWindow({ onAction: handleAction, onHiddenToTray: hintHiddenToTray })
    startUpdateChecks((update) => { setTrayUpdate(update.version) })
    await boot()
  })

  // Cửa sổ đóng chỉ là thu về khay, nên nhánh này chỉ chạy khi thoát thật.
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    beginQuit()
    stopNotifier()
    stopShotLink()
    stopUpdateChecks()
    destroyTray()
    stopEngine()
  })
}

/** Khởi động engine rồi trỏ cửa sổ vào nó; hỏng thì hiện trang lỗi. */
async function boot(): Promise<void> {
  setTrayStatus('Starting…')
  try {
    const engine = await startEngine((tail) => {
      setTrayStatus('Engine stopped')
      stopNotifier()
      stopShotLink()
      void showError({ message: 'The engine stopped unexpectedly while running.', tail })
    })
    setTrayStatus('Running')
    startNotifier(engine.url, { isWindowActive, reveal: revealWindow })
    // Đường chụp ảnh trang web cho agent. Lớp vỏ gọi ĐI tới engine, không mở
    // thêm cổng nào trên máy — xem `shot-link.ts`.
    startShotLink(engine.url)
    await showEngine(engine.url)
  } catch (error) {
    setTrayStatus('Failed to start')
    await showError(error instanceof EngineStartError
      ? { message: error.message, tail: error.tail }
      : { message: String(error), tail: '' })
  }
}

/** Thoát hẳn: dừng engine rồi đóng app. */
function quitApp(): void {
  beginQuit()
  app.quit()
}

/** Các nút trên trang lỗi. */
function handleAction(action: string): void {
  if (action === 'open-log') {
    void shell.openPath(engineLogPath())
    return
  }
  if (action === 'retry') {
    stopNotifier()
    stopShotLink()
    stopEngine()
    void showSplash().then(boot)
  }
}
