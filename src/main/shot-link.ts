/**
 * The agent's screenshot path: the shell **calls out** to the engine.
 *
 * ## Why the shell and not the plugin
 *
 * Measured (check 15b): calling `capturePage()` from inside the host page
 * **hard-locks the whole window's event loop** on a real https page — even a wrapping
 * `setTimeout` never fires, so there is no way to rescue it. The main-process path
 * runs 23KB in 5ms. Same function name, two call sites, two outcomes.
 *
 * So the screenshot command cannot travel the plugin's route. It has to run here.
 *
 * ## Why the shell CALLS OUT rather than LISTENING
 *
 * The easier design is to open a listening port in the shell for the plugin to call
 * into. Not done: a listening port is a new door on the user's machine, and every
 * other process on that machine can knock on it too.
 *
 * The shell already connects to the engine to show Windows notifications
 * (`notifier.ts`), so one more outbound connection is work it already does. The shell
 * is the caller; no new door opens.
 *
 * ## Only the web pages inside the panel can be captured
 *
 * The shell keeps a list of the `webContents` of the `<webview>` tags it attached
 * itself (`did-attach-webview`). A capture request carries an id, and an id outside
 * that list is refused — nobody can capture the engine UI, the About window, or
 * anything else.
 * @module
 */

import { type WebContents } from 'electron'
import { logShell } from './log.js'

/** The WebSocket path the plugin leaves open for the shell. */
const SHOT_PATH = '/hdw/shell'

/** Backoff steps after a dropped connection, in milliseconds. Same shape as `notifier.ts`. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000]

/** Time ceiling for one capture. Past it the answer is "could not capture". */
const CAPTURE_TIMEOUT_MS = 8_000

let socket: WebSocket | undefined
let timer: NodeJS.Timeout | undefined
let attempt = 0
let running = false

/**
 * The guest pages the shell attached to the main window itself.
 *
 * This is an allow list, not a cache: only ids in here can be captured. A `Map` keyed
 * by id gives a fast lookup and a place to clean up when a page dies.
 */
const guests = new Map<number, WebContents>()

/**
 * Record a guest page that was just attached to the window.
 *
 * Called from the shell's `did-attach-webview`. It cleans itself up when the page is
 * destroyed, so the list does not grow with every tab the user opened and closed.
 * @param guest - the `<webview>` tag's `webContents`.
 */
export function trackGuest(guest: WebContents): void {
  const id = guest.id
  guests.set(id, guest)
  guest.once('destroyed', () => { guests.delete(id) })
}

/** The captured image, as base64 PNG, plus its real dimensions. */
interface Shot {
  data: string
  width: number
  height: number
}

/**
 * Capture one guest page by id.
 * @param id - the guest page's `webContents` id.
 * @returns the PNG image as base64.
 * @throws when the id is not on the allow list, or the capture takes too long.
 */
async function capture(id: number): Promise<Shot> {
  const guest = guests.get(id)
  if (guest === undefined || guest.isDestroyed()) {
    throw new Error('no web page in the panel carries that id')
  }
  // The timeout is mandatory, not surplus caution: `capturePage` has hung forever on
  // another path, and a Promise that never settles holds a slot in the bridge's
  // pending table until the ceiling is reached.
  const image = await Promise.race([
    guest.capturePage(),
    new Promise<undefined>((resolve) => {
      const t = setTimeout(() => { resolve(undefined) }, CAPTURE_TIMEOUT_MS)
      t.unref()
    }),
  ])
  if (image === undefined) throw new Error('the screenshot took too long and was abandoned')
  const size = image.getSize()
  return { data: image.toPNG().toString('base64'), width: size.width, height: size.height }
}

/** Connect to the engine and serve capture requests. */
function connect(baseUrl: string): void {
  if (!running) return
  const url = new URL(SHOT_PATH, baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

  const ws = new WebSocket(url.toString())
  socket = ws

  ws.addEventListener('open', () => {
    attempt = 0
    logShell('shot-link: connected to the engine')
  })

  ws.addEventListener('message', (event) => {
    let frame: { id?: unknown, wc_id?: unknown }
    try {
      frame = JSON.parse(String(event.data)) as typeof frame
    } catch {
      return
    }
    if (typeof frame.id !== 'number' || typeof frame.wc_id !== 'number') return
    const callId = frame.id

    capture(frame.wc_id).then(
      (shot) => { ws.send(JSON.stringify({ id: callId, ok: true, ...shot })) },
      (error: unknown) => {
        ws.send(JSON.stringify({
          id: callId,
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        }))
      },
    )
  })

  ws.addEventListener('close', () => {
    socket = undefined
    if (!running) return
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 15_000
    attempt += 1
    timer = setTimeout(() => { connect(baseUrl) }, wait)
    timer.unref()
  })

  // Every failure path ends in `close`, so reconnecting here as well would reconnect
  // twice.
  ws.addEventListener('error', () => {})
}

/**
 * Turn the screenshot path on. Called once the engine is up.
 * @param baseUrl - the engine's address.
 */
export function startShotLink(baseUrl: string): void {
  if (running) return
  running = true
  attempt = 0
  connect(baseUrl)
}

/**
 * Capture a guest page, for the test suite.
 *
 * Exported so `scripts/spike-dock-ui.cjs` measures THIS function rather than a
 * near-copy of it. The lesson from check 17a: a guard verified against a copy of
 * itself verifies nothing.
 *
 * Not used by the app: there, the call always arrives from the engine over the
 * WebSocket.
 * @param webContentsId - the guest page's id.
 * @returns the PNG image as base64.
 */
export async function captureForSpike(webContentsId: number): Promise<Shot> {
  return capture(webContentsId)
}

/** Turn the screenshot path off and clean up. */
export function stopShotLink(): void {
  running = false
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  socket?.close()
  socket = undefined
  guests.clear()
}
