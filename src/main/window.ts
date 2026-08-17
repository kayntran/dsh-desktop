/**
 * The main window: a splash screen while the engine comes up, the dsh UI once it is
 * ready, and an error page when it cannot start.
 *
 * The two internal pages (splash, error) need neither a preload nor IPC: the main
 * process injects their content with `executeJavaScript`, and their buttons report
 * back by navigating to a private scheme that `will-navigate` intercepts. That keeps
 * the window on Electron's default sandbox for the dsh UI loaded from loopback.
 * @module
 */

import { app, BrowserWindow, Menu, nativeTheme, session, shell } from 'electron'
import { logShell } from './log.js'
import { resourcePath } from './paths.js'
import { trackGuest } from './shot-link.js'
import { restoreState, trackState } from './window-state.js'

/** The navigation prefix the internal pages' buttons use to call back into the main process. */
const ACTION_SCHEME = 'harness-action:'

/**
 * A separate session for every page opened in a Browser tab.
 *
 * `persist:` keeps cookies alive across launches — sign in once and be done. Kept
 * apart from the app's own session so a web page can read nothing belonging to the
 * dsh UI, and so a future "clear browsing data" button touches nothing else.
 */
const BROWSER_PARTITION = 'persist:hdw-browser'

/** The error page's content. */
export interface EngineErrorPayload {
  /** The sentence describing the failure to the user. */
  message: string
  /** The engine's log tail, for someone technical. */
  tail: string
}

let window: BrowserWindow | undefined
let quitting = false

/**
 * The engine's origin (`http://127.0.0.1:<port>`), once it is up.
 *
 * Kept so the fourth guard knows what to block. The engine picks its own port at
 * runtime, so it cannot be hard-coded.
 */
let engineOrigin: string | undefined

/** The main window, if one exists. */
export function mainWindow(): BrowserWindow | undefined {
  return window
}

/**
 * Mark that the app is really quitting, so the next window close is not turned into
 * a retreat to the tray.
 */
export function beginQuit(): void {
  quitting = true
}

/** Show the window and bring it forward, restoring it if minimized or hidden. */
export function revealWindow(): void {
  const target = window
  if (target === undefined) return
  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
}

/** Whether the window is in front of the user right now — used to decide whether to notify. */
export function isWindowActive(): boolean {
  const target = window
  return target !== undefined && target.isVisible() && !target.isMinimized() && target.isFocused()
}

/** The things the window calls back into the main process. */
export interface WindowHandlers {
  /** Receives the name of the action the user clicked on an internal page. */
  onAction: (action: string) => void
  /** Called when the window has just retreated to the tray instead of closing for good. */
  onHiddenToTray: () => void
}

/**
 * Record the engine's origin so guard 4 knows what to block.
 *
 * Split out of {@link showEngine} so the test suite can call it:
 * `scripts/spike-dock-ui.cjs` builds its own window and uses **these very** guard
 * functions rather than copying them. A copy is the thing that drifts away from the
 * original with nobody noticing, and a guard verified against a copy of itself
 * verifies nothing.
 * @param url - the running engine's address.
 */
export function setEngineOrigin(url: string): void {
  try {
    engineOrigin = new URL(url).origin
  } catch {
    engineOrigin = undefined
  }
}

/**
 * Four safety guards for every `<webview>` tag the plugin attaches to the page.
 *
 * The guards have to live here, out of the plugin's reach — a guard the blocked party
 * can set for itself is not a guard. A web page opened in a Browser tab is untrusted
 * content: it can be any page at all, and the agent may have been talked into going
 * there by that very page.
 *
 * Every value below was measured by `scripts/spike-webview.cjs` as actually taking
 * effect (check 2 reads the guest's `getLastWebPreferences()` back to confirm).
 * @param win - the main window.
 */
export function guardWebviews(win: BrowserWindow): void {
  // Guard 1 — force the guest's configuration, ignoring anything the page declares.
  win.webContents.on('will-attach-webview', (_event, prefs, params) => {
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    // Background pages keep running at full pace. Without this line Chromium throttles
    // the timers of a tab that is not on screen, and the agent's "wait until an element
    // appears" would time out unfairly on the very tabs it just opened.
    prefs.backgroundThrottling = false
    // Force the session: which cookie jar a web page shares is the shell's decision,
    // not the HTML tag's.
    params.partition = BROWSER_PARTITION
    // No popups from an embedded page. Deleting this attribute blocks it early, before
    // guard 2's handler even gets a chance to run.
    delete params.allowpopups
  })

  // Guard 2 — an embedded page cannot spawn a new window. `target=_blank` and
  // `window.open` both arrive here; external links open in the default browser.
  win.webContents.on('did-attach-webview', (_event, guest) => {
    // Record it on the screenshot path's allow list. Only pages the shell attached
    // itself can be captured — nobody can capture the engine UI or any other window
    // of the app.
    trackGuest(guest)
    guest.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })

  // Guard 3 — flatly refuse camera, microphone, location and every other sensitive
  // permission on the browsing session. The user has no way to enable one by mistake,
  // because there is no dialog to click.
  const browserSession = session.fromPartition(BROWSER_PARTITION)
  browserSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })

  // Guard 4 — no web tab may open the engine's own UI.
  //
  // This is the most dangerous escalation hole, and it does not travel the path the
  // address gate watches: the agent supplies a perfectly valid public address, and
  // that page returns a redirect to `http://127.0.0.1:<engine port>/`. The check at
  // open time already ran and already allowed it; the redirect happens afterwards. The
  // result: the agent holds a controllable tab standing INSIDE the engine UI, and it
  // can press buttons there on the user's behalf.
  //
  // Blocking at the request layer catches all three routes — a direct open, a server
  // redirect, and the page changing its own address by script.
  //
  // This guard lives in the shell rather than the plugin, deliberately: a guard the
  // blocked party can set for itself is a guard that party can also remove. The shell
  // protects the engine it started.
  //
  // The cost to the user is zero: nobody has a reason to open the engine UI inside a
  // Browser tab of that same engine.
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    if (engineOrigin === undefined) { callback({}); return }
    try {
      if (new URL(details.url).origin === engineOrigin) {
        logShell(`blocked a web tab from entering the engine UI: ${details.url}`)
        callback({ cancel: true })
        return
      }
    } catch { /* an unusual URL (data:, blob:) — not the engine's origin */ }
    callback({})
  })
}

/** Create the window and show the splash screen immediately. */
export function createWindow({ onAction, onHiddenToTray }: WindowHandlers): BrowserWindow {
  // Electron's default menu (File/Edit/View/Window/Help) does not belong to this app —
  // its Help even points at Electron's own site. Window functions live in the system
  // tray menu instead of a menu bar taking up space.
  Menu.setApplicationMenu(null)

  const state = restoreState()
  const created = new BrowserWindow({
    ...state.bounds,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // A background matching the two internal pages, so page transitions do not flash white.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16161a' : '#fbfbfd',
    title: app.getName(),
    icon: resourcePath('icon.ico'),
    webPreferences: {
      // Lets the plugin use `<webview>` tags — the foundation of the Browser tab.
      //
      // This is NOT a relaxation of the host page's security: `webviewTag` only opens
      // the ability to *embed* another page, and every permission that embedded page
      // gets is decided by `will-attach-webview` below, not declared by the page
      // itself. No API lets a page turn this flag on for itself.
      webviewTag: true,
    },
  })

  guardWebviews(created)

  // External links (docs, GitHub…) open in the default browser rather than spawning
  // another bare Electron window with no address bar.
  created.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  created.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ACTION_SCHEME)) return
    event.preventDefault()
    onAction(url.slice(ACTION_SCHEME.length))
  })

  // Upstream's UI sets the document title to "DeepSeek Harness" itself. This app is
  // not DeepSeek's official build, so the title bar carries the app's own name;
  // upstream's credit lives in the About window.
  created.on('page-title-updated', (event) => {
    event.preventDefault()
    created.setTitle(app.getName())
  })

  // With no menu bar there are no default shortcuts either. Two are kept for
  // supporting a user remotely: open the console and reload the page. The handled key
  // is swallowed as well, or upstream's UI would receive it too and one press would
  // become two actions.
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

  // Clicking X retreats to the tray rather than quitting: the agent may be part way
  // through a long job, and closing a window is not an intent to stop it. Only Quit
  // really stops it.
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

/** Go back to the splash screen (used when the user presses Retry). */
export async function showSplash(): Promise<void> {
  await window?.loadFile(resourcePath('splash.html'))
}

/** Switch the window to the dsh UI. */
export async function showEngine(url: string): Promise<void> {
  setEngineOrigin(url)
  await window?.loadURL(url)
}

/** The About window's content. */
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
 * Open the About window — where upstream is credited and it is stated plainly that
 * this is not an official product. A small separate window; it does not replace the
 * running UI.
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

/** Switch the window to the error page, with a description and the log tail. */
export async function showError(payload: EngineErrorPayload): Promise<void> {
  const target = window
  if (target === undefined) return
  await target.loadFile(resourcePath('error.html'))
  // The error page is the app's own resource and the payload is built by us, so
  // injecting it through one function call is enough — two buttons do not need an IPC
  // bridge.
  await target.webContents.executeJavaScript(`window.__setError(${JSON.stringify(payload)})`)
}
