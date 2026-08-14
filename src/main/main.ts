/**
 * Điểm vào của app: dựng cửa sổ và khay, đưa engine lên, nối chúng lại.
 * @module
 */

import { app, shell } from 'electron'
import { EngineStartError, reapOrphanEngine, startEngine, stopEngine } from './engine.js'
import { logShell, shellLogPath } from './log.js'
import { dshVersion, engineLogPath, nodeVersion } from './paths.js'
import { startNotifier, stopNotifier } from './notifier.js'
import {
  createTray, destroyTray, dshHome, hintHiddenToTray, setTrayStatus, setTrayUpdate,
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
  app.setName('Harness Desktop')
  // Windows gắn thông báo vào một AppUserModelID; không đặt thì toast hiện
  // dưới tên tiến trình Electron thay vì tên app.
  app.setAppUserModelId('com.harness-desktop.app')
  app.on('second-instance', () => { revealWindow() })

  void app.whenReady().then(async () => {
    logShell(`app: khởi động ${app.getName()} ${app.getVersion()} (đã đóng gói: ${String(app.isPackaged)})`)
    // Lần chạy trước có thể bị tắt cứng và để lại engine giữ cổng.
    reapOrphanEngine()
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
    stopUpdateChecks()
    destroyTray()
    stopEngine()
  })
}

/** Khởi động engine rồi trỏ cửa sổ vào nó; hỏng thì hiện trang lỗi. */
async function boot(): Promise<void> {
  setTrayStatus('Đang khởi động…')
  try {
    const engine = await startEngine((tail) => {
      setTrayStatus('Engine đã dừng')
      stopNotifier()
      void showError({ message: 'Engine dừng đột ngột trong lúc đang chạy.', tail })
    })
    setTrayStatus('Đang chạy')
    startNotifier(engine.url, { isWindowActive, reveal: revealWindow })
    await showEngine(engine.url)
  } catch (error) {
    setTrayStatus('Không khởi động được')
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
    stopEngine()
    void showSplash().then(boot)
  }
}
