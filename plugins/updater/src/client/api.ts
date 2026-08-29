/**
 * Talking to this plugin's own Node half, and nothing else.
 *
 * Every address here is same-origin with the page, which is also the condition the
 * trust gate on the other side requires — see `../trust.ts`.
 * @module
 */

import type { UpdateCommand, UpdateState } from '../state.ts'

/** Shown when the engine cannot be reached at all. */
const OFFLINE: UpdateState = { phase: 'unknown', current: '' }

/**
 * Read where the update stands.
 *
 * Never throws: this runs on a timer behind a settings row and a floating pill, and
 * a failed poll is not something the user can act on. It reports "unknown", which
 * draws exactly what an app that has not checked yet draws.
 * @returns the state, or the unknown state when the read failed.
 */
export async function fetchState(): Promise<UpdateState> {
  try {
    const res = await fetch('/hdw/update/status', { cache: 'no-store' })
    if (!res.ok) return OFFLINE
    return await res.json() as UpdateState
  } catch {
    return OFFLINE
  }
}

/**
 * Ask the shell to do something.
 * @param command - check for a new version, or install the one already downloaded.
 * @returns true when the request was accepted.
 */
export async function ask(command: UpdateCommand): Promise<boolean> {
  try {
    const res = await fetch('/hdw/update/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command }),
    })
    return res.ok
  } catch {
    return false
  }
}
