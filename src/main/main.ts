/**
 * The app's entry point: build the window and the tray, bring the engine up, wire
 * them together.
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
 * Allow only one copy of the app to run. Two copies would build two engines writing
 * into the same data folder — corrupted session history, duplicated background jobs,
 * duplicated notifications. The second copy steps aside and wakes the running one.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  /**
   * Turn off Chromium's window-occlusion detection on Windows.
   *
   * That detection marks a "fully covered" window as hidden to save battery, and it
   * carries a by-now classic bug: the hidden state STICKS even after the window
   * comes to the foreground. Measured on this very app: the window was on screen
   * while the host page reported `document.visibilityState === 'hidden'` and
   * `requestAnimationFrame` never fired — while all four child webviews considered
   * themselves "visible". What the user saw: the web area inside the panel was blank
   * even though the page had loaded and was painting itself in memory (a CDP capture
   * came back complete), because the host page stopped producing frames and so the
   * guest's surface was never composited onto the screen.
   *
   * Must be set BEFORE `app.whenReady()` — after that Chromium has already read the
   * flags.
   */
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

  app.setName('Harness Desktop')
  // Windows attaches notifications to an AppUserModelID; without setting one, the
  // toast appears under the Electron process name instead of the app's name.
  app.setAppUserModelId('com.harness-desktop.app')
  app.on('second-instance', () => { revealWindow() })

  void app.whenReady().then(async () => {
    logShell(`app: starting ${app.getName()} ${app.getVersion()} (packaged: ${String(app.isPackaged)})`)
    // The previous run may have been killed hard, leaving an engine holding the port.
    reapOrphanEngine()
    // Must finish BEFORE the engine starts: the engine scans the plugin tree at boot.
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

  // Closing the window only retreats to the tray, so this branch only runs on a real quit.
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

/** Start the engine and point the window at it; on failure, show the error page. */
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
    // The screenshot path the agent uses. The shell calls OUT to the engine and opens
    // no extra port on the machine — see `shot-link.ts`.
    startShotLink(engine.url)
    await showEngine(engine.url)
  } catch (error) {
    setTrayStatus('Failed to start')
    await showError(error instanceof EngineStartError
      ? { message: error.message, tail: error.tail }
      : { message: String(error), tail: '' })
  }
}

/** Quit for real: stop the engine, then close the app. */
function quitApp(): void {
  beginQuit()
  app.quit()
}

/** The buttons on the error page. */
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
