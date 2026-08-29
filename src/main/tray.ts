/**
 * The system tray icon and its context menu.
 *
 * The tray is where the app lives once the window is closed: the agent may be part
 * way through a long job, and closing a window should not kill it.
 * @module
 */

import { app, Menu, Tray } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome, resourcePath } from './paths.js'

/** The things the tray menu calls back into the main process. */
export interface TrayHandlers {
  /** Show and focus the window. */
  open: () => void
  /** Open dsh's data folder. */
  openDataDir: () => void
  /** Open the engine's log file. */
  openLog: () => void
  /** Open the app shell's log file. */
  openShellLog: () => void
  /** Open the About window. */
  openAbout: () => void
  /**
   * Restart into the version already downloaded.
   *
   * Only ever reachable when one is staged: the entry appears with the version
   * and disappears with it.
   */
  installUpdate: () => void
  /** Quit for real, stopping the engine too. */
  quit: () => void
}

let tray: Tray | undefined
let handlers: TrayHandlers | undefined
let status = 'Starting…'
let updateVersion: string | undefined

function buildMenu(): Menu {
  const bound = handlers
  return Menu.buildFromTemplate([
    { label: `Open ${app.getName()}`, click: () => bound?.open() },
    { type: 'separator' },
    { label: status, enabled: false },
    ...updateVersion === undefined ? [] : [{
      label: `Version ${updateVersion} is ready — restart to update`,
      click: () => bound?.installUpdate(),
    }],
    { type: 'separator' },
    { label: 'Open data folder', click: () => bound?.openDataDir() },
    { label: 'Open engine log', click: () => bound?.openLog() },
    { label: 'Open app log', click: () => bound?.openShellLog() },
    { type: 'separator' },
    { label: 'About', click: () => bound?.openAbout() },
    { label: 'Quit', click: () => bound?.quit() },
  ])
}

function refresh(): void {
  tray?.setToolTip(`${app.getName()} — ${status}`)
  tray?.setContextMenu(buildMenu())
}

/** Build the tray icon. Called once, after the app is ready. */
export function createTray(trayHandlers: TrayHandlers): void {
  handlers = trayHandlers
  // Electron picks tray@2x.png by itself on a high-DPI display.
  tray = new Tray(resourcePath('tray.png'))
  tray.on('click', () => { trayHandlers.open() })
  tray.on('double-click', () => { trayHandlers.open() })
  refresh()
}

/** Update the status line in the menu and the tooltip. */
export function setTrayStatus(text: string): void {
  status = text
  refresh()
}

/** Add the download-a-new-version entry to the tray menu. */
export function setTrayUpdate(version: string): void {
  updateVersion = version
  refresh()
}

/**
 * Explain exactly once that the app retreats to the tray rather than quitting.
 *
 * A user who clicks X, sees the window vanish and finds the process still running
 * assumes the app has hung; say it clearly once and then stop, because by the next
 * time the behaviour is familiar.
 */
export function hintHiddenToTray(): void {
  const marker = join(app.getPath('userData'), 'tray-hint-shown')
  if (existsSync(marker)) return
  try {
    writeFileSync(marker, '')
  } catch {
    // A failed write means at worst the hint appears once more — not worth blocking on.
  }
  tray?.displayBalloon({
    title: `${app.getName()} is still running`,
    content: 'The app stays in the system tray so the agent can finish its work. Right-click the icon to reopen it or quit.',
    iconType: 'info',
  })
}

/** Remove the tray icon on quit. */
export function destroyTray(): void {
  tray?.destroy()
  tray = undefined
}
