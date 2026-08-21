/**
 * The engine's restart request: the shell waits, the Plugins page rings.
 *
 * ## Why this exists
 *
 * A plugin installed from the market is only read at boot — the engine loads its
 * bundle list once and never again. So the install is not finished until the
 * engine restarts, and the engine is a child of this process: nothing inside it
 * can restart it.
 *
 * ## Why the shell CALLS OUT rather than LISTENING
 *
 * Same reasoning as `shot-link.ts`, and it is worth repeating because the easier
 * design is the wrong one: a listening port in the shell is a new door on the
 * user's machine, and every other process on that machine can knock on it too.
 * The shell already makes outbound connections to the engine for notifications
 * and for screenshots, so one more costs nothing new.
 *
 * ## Why a held-open GET rather than a WebSocket
 *
 * The plugin serving this route has NO runtime dependencies, which is what lets
 * it ship as three files; a socket server would add one. A request the engine
 * holds open until it has something to say carries exactly as much as is needed
 * here — a single yes — and it fails the same way a socket would: the request
 * ends, and this file tries again.
 * @module
 */

import { logShell } from './log.js'

/** The route the plugin holds open. */
const WAIT_PATH = '/hdw/lifecycle/wait'

/**
 * Ceiling on one wait. Longer than the plugin's own 25s so a normal "nothing
 * yet" answer arrives first and this never fires in the ordinary case.
 */
const WAIT_TIMEOUT_MS = 40_000

/** Backoff steps after a failed wait, in milliseconds. Same shape as `shot-link.ts`. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000]

let running = false
let attempt = 0
let timer: NodeJS.Timeout | undefined
let controller: AbortController | undefined

/** Ask again, after the backoff for however many failures have piled up. */
function retry(baseUrl: string, onRestart: () => void): void {
  if (!running) return
  const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 15_000
  attempt += 1
  timer = setTimeout(() => { void poll(baseUrl, onRestart) }, wait)
  timer.unref()
}

/** Hold one request open, then either act on it or go round again. */
async function poll(baseUrl: string, onRestart: () => void): Promise<void> {
  if (!running) return

  const abort = new AbortController()
  controller = abort
  const cutoff = setTimeout(() => { abort.abort() }, WAIT_TIMEOUT_MS)
  cutoff.unref()

  try {
    const res = await fetch(new URL(WAIT_PATH, baseUrl), {
      signal: abort.signal,
      headers: { accept: 'application/json' },
    })
    clearTimeout(cutoff)
    if (!res.ok) {
      // The plugin may be disabled, or an older engine may not serve this route.
      // Either way, keep asking quietly rather than reporting to the user.
      retry(baseUrl, onRestart)
      return
    }
    const body = await res.json() as { restart?: unknown }
    attempt = 0
    if (body.restart === true) {
      logShell('engine-restart: the Plugins page asked for a restart')
      onRestart()
      return
    }
    // A plain "nothing yet". Straight back in, no backoff — this is the loop
    // running normally, not recovering from anything.
    void poll(baseUrl, onRestart)
  } catch {
    clearTimeout(cutoff)
    retry(baseUrl, onRestart)
  }
}

/**
 * Start listening for restart requests. Called once the engine is up.
 * @param baseUrl - the engine's address.
 * @param onRestart - what to do when the page asks; must not return here.
 */
export function startRestartLink(baseUrl: string, onRestart: () => void): void {
  if (running) return
  running = true
  attempt = 0
  void poll(baseUrl, onRestart)
}

/** Stop listening. Safe to call when it was never started. */
export function stopRestartLink(): void {
  running = false
  if (timer !== undefined) { clearTimeout(timer); timer = undefined }
  // Abort the held-open request too: without this the shell would sit on a
  // connection to an engine it is about to kill.
  controller?.abort()
  controller = undefined
}
