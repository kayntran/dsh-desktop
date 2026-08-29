/**
 * Keeping the app up to date, and telling the page about it.
 *
 * ## Why this is shell work and not a plugin
 *
 * The app's own files are what an update replaces, and the only process that can
 * replace them is the one running from them. The engine is a separate `node.exe`
 * this process started; it cannot swap out an Electron installation, let alone
 * restart into it. So the mechanism lives here, and everything the user SEES lives
 * in `plugins/updater/` — the split this project's second rule asks for.
 *
 * ## Which way the messages travel
 *
 * Out. This file POSTs each change to the plugin and holds a request open on
 * `/hdw/update/wait` for anything the page wants back. It never listens. Same
 * reasoning as `engine-restart.ts` and `shot-link.ts`, and worth repeating because
 * the easier design is the wrong one: a listening port in the shell is a new door
 * on the user's machine that every other process can knock on, while an outgoing
 * request is work the shell already does.
 *
 * ## What it will not do
 *
 * It never restarts the app by itself. A turn can be running, a terminal can have
 * a shell open in it, and the user is the only one who knows whether now is a good
 * time. It downloads quietly and then waits to be asked. The staged package is
 * applied when the app closes normally, so a user who never presses the button
 * still ends up on the new version at some point of their own choosing.
 * @module
 */

import { app } from 'electron'
import { createRequire } from 'node:module'
import { logShell } from './log.js'

/**
 * `electron-updater` is CommonJS and this shell is ESM, so it has to be REQUIRED
 * rather than imported.
 *
 * Written as a plain `import { autoUpdater } from 'electron-updater'` the app dies
 * at launch — not at build time. TypeScript is happy, esbuild is happy, and Node
 * then refuses: "The requested module 'electron-updater' does not provide an export
 * named 'autoUpdater'", because its ESM loader cannot see named exports inside a
 * CommonJS module it did not analyse. Measured the hard way: the window never
 * appeared, only Electron's own error box.
 *
 * `createRequire` is the interop Node documents for exactly this, and the cast
 * keeps the types the package ships — nothing here is `any`.
 */
const { autoUpdater } = createRequire(import.meta.url)('electron-updater') as typeof import('electron-updater')

/** The route the plugin holds open for us. */
const WAIT_PATH = '/hdw/update/wait'

/** The route that takes a state report. */
const STATE_PATH = '/hdw/update/state'

/**
 * Ceiling on one wait. Longer than the plugin's own 25s so a normal "nothing yet"
 * answer arrives first and this never fires in the ordinary case.
 */
const WAIT_TIMEOUT_MS = 40_000

/** Backoff steps after a failed wait, in milliseconds. Same shape as `engine-restart.ts`. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000]

/**
 * How long after startup the first check waits.
 *
 * The engine is still booting and the window is still painting; a download started
 * now competes with both for the same connection. Nothing is lost by waiting — the
 * user cannot act on the answer until it finishes anyway.
 */
const FIRST_CHECK_MS = 60_000

/** How often to check after that. */
const EVERY_MS = 6 * 60 * 60 * 1_000

/** Where a build that cannot update itself sends the user instead. */
const DOWNLOAD_PAGE = 'https://github.com/kayntran/dsh-desktop/releases/latest'

/** The shape the plugin stores and the page renders. Mirrors `plugins/updater/src/state.ts`. */
interface UpdateState {
  phase: 'unknown' | 'checking' | 'current' | 'downloading' | 'ready' | 'error' | 'unsupported'
  current: string
  next?: string
  percent?: number
  reason?: string
  downloadPage?: string
}

let running = false
let attempt = 0
let timer: NodeJS.Timeout | undefined
let checkTimer: NodeJS.Timeout | undefined
let controller: AbortController | undefined
let engineUrl = ''
let state: UpdateState = { phase: 'unknown', current: app.getVersion() }

/**
 * Whether this build can replace itself.
 *
 * Two things have to be true. A build run from source has no installer behind it,
 * and `electron-updater` refuses outright. A portable build has an installer
 * nowhere either: it unpacks to a temporary folder on each run, and
 * `PORTABLE_EXECUTABLE_DIR` is how electron-builder marks that at runtime. Both
 * cases are reported to the page rather than hidden, because silence there reads
 * as "you are up to date" forever.
 * @returns true when an update could actually be applied.
 */
function cannotUpdateBecause(): string | undefined {
  if (!app.isPackaged) return 'Running from source — updates are off.'
  if (process.env['PORTABLE_EXECUTABLE_DIR'] !== undefined) {
    return 'This portable build cannot update itself — download a new one when you want it.'
  }
  return undefined
}

/**
 * The state to report for a build that cannot replace itself.
 * @param reason - the sentence naming which of the two cases this is.
 * @returns the state to send.
 */
function blockedState(reason: string): UpdateState {
  return {
    phase: 'unsupported',
    current: app.getVersion(),
    reason,
    downloadPage: DOWNLOAD_PAGE,
  }
}

/**
 * Tell the page where things stand.
 *
 * Failing to report is not worth surfacing: the page polls, so the next change
 * carries the same news, and a user cannot act on "the shell could not reach the
 * engine" anyway.
 * @param next - the new state.
 */
function report(next: UpdateState): void {
  state = next
  if (engineUrl === '') return
  void fetch(new URL(STATE_PATH, engineUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(next),
  }).catch(() => {
    // See above.
  })
}

/** Ask again, after the backoff for however many failures have piled up. */
function retry(): void {
  if (!running) return
  const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 15_000
  attempt += 1
  timer = setTimeout(() => { void poll() }, wait)
  timer.unref()
}

/** Carry out what the page asked for. */
function obey(command: string): void {
  if (command === 'check') {
    logShell('updater: the page asked for a check')
    void check()
    return
  }
  if (command === 'install') {
    logShell('updater: the page asked to restart and install')
    installUpdate()
  }
}

/** Hold one request open, then either act on it or go round again. */
async function poll(): Promise<void> {
  if (!running) return

  const abort = new AbortController()
  controller = abort
  const cutoff = setTimeout(() => { abort.abort() }, WAIT_TIMEOUT_MS)
  cutoff.unref()

  try {
    const res = await fetch(new URL(WAIT_PATH, engineUrl), {
      signal: abort.signal,
      headers: { accept: 'application/json' },
    })
    clearTimeout(cutoff)
    if (!res.ok) {
      // The plugin may be disabled, or an older engine may not serve this route.
      // Keep asking quietly rather than reporting to the user.
      retry()
      return
    }
    const body = await res.json() as { command?: unknown }
    attempt = 0
    if (typeof body.command === 'string') obey(body.command)
    void poll()
  } catch {
    clearTimeout(cutoff)
    retry()
  }
}

/** Ask GitHub whether there is anything newer. */
async function check(): Promise<void> {
  const blocked = cannotUpdateBecause()
  if (blocked !== undefined) {
    report(blockedState(blocked))
    return
  }
  report({ phase: 'checking', current: app.getVersion() })
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    // The handler below reports it; this catch only stops an unhandled rejection.
    logShell(`updater: check threw — ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Restart into the version already downloaded.
 *
 * Exported for the tray, which offers the same thing from outside the window — a
 * user who has the app minimised should not have to open it to say yes.
 */
export function installUpdate(): void {
  // SILENT, and this is not a preference.
  //
  // The first version passed `false` here, reasoning that the user should see the
  // installer if it had anything to say. Watching a real update run showed what
  // that means with this project's NSIS settings: `oneClick: false` is what lets a
  // FIRST-TIME installer offer a folder and a per-user/all-users choice, and a
  // non-silent update replays that whole wizard — "Who should this application be
  // installed for?", Next, Next — every single time. Nobody agreed to click
  // through a setup program to receive a patch; that is the opposite of the
  // "quietly in the background" this feature promises.
  //
  // `isForceRunAfter` so the app comes back on its own rather than leaving the user
  // at a desktop wondering whether it worked.
  autoUpdater.quitAndInstall(true, true)
}

/**
 * Start the updater. Called once the engine is up.
 * @param baseUrl - the engine's address, for the two routes above.
 * @param onReady - called with the version once a download is staged, so the tray
 * can offer the restart too.
 */
export function startUpdater(baseUrl: string, onReady: (version: string) => void): void {
  if (running) return
  running = true
  attempt = 0
  engineUrl = baseUrl

  // Downloading is the whole point of choosing "quietly in the background"; the
  // user is asked only about the restart.
  autoUpdater.autoDownload = true
  // Applied when the app closes on its own terms. Never a restart of our doing.
  autoUpdater.autoInstallOnAppQuit = true
  // electron-updater's own logging goes to the shell's log, so a bug report has
  // the whole story in one file.
  autoUpdater.logger = {
    info: (message: unknown) => { logShell(`updater: ${String(message)}`) },
    warn: (message: unknown) => { logShell(`updater: WARN ${String(message)}`) },
    error: (message: unknown) => { logShell(`updater: ERROR ${String(message)}`) },
    debug: () => { /* too chatty for a file the user may be asked to send. */ },
  }

  autoUpdater.on('update-available', (info: { version: string }) => {
    report({ phase: 'downloading', current: app.getVersion(), next: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    report({ phase: 'current', current: app.getVersion() })
  })
  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    report({
      phase: 'downloading',
      current: app.getVersion(),
      ...(state.next === undefined ? {} : { next: state.next }),
      percent: progress.percent,
    })
  })
  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    logShell(`updater: version ${info.version} is downloaded and staged`)
    report({ phase: 'ready', current: app.getVersion(), next: info.version })
    onReady(info.version)
  })
  autoUpdater.on('error', (error: Error) => {
    report({
      phase: 'error',
      current: app.getVersion(),
      // The raw message names files and URLs; this is the sentence a user can act on.
      reason: 'Could not reach the update server. It will try again later.',
    })
    logShell(`updater: ${error.message}`)
  })

  // Say hello straight away so the settings row has a version to show even before
  // the first check runs.
  const blockedAtStart = cannotUpdateBecause()
  report(blockedAtStart === undefined
    ? { phase: 'unknown', current: app.getVersion() }
    : blockedState(blockedAtStart))

  void poll()

  const first = setTimeout(() => { void check() }, FIRST_CHECK_MS)
  first.unref()
  checkTimer = setInterval(() => { void check() }, EVERY_MS)
  checkTimer.unref()
}

/** Stop the updater. Safe to call when it was never started. */
export function stopUpdater(): void {
  running = false
  if (timer !== undefined) { clearTimeout(timer); timer = undefined }
  if (checkTimer !== undefined) { clearInterval(checkTimer); checkTimer = undefined }
  // Abort the held-open request too: without this the shell would sit on a
  // connection to an engine it is about to kill.
  controller?.abort()
  controller = undefined
}
