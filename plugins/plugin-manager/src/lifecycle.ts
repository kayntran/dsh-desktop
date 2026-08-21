/**
 * Asking the shell to restart the engine, and leaving a note in case it will not
 * come back.
 *
 * ## Why the shell has to do it
 *
 * A newly installed plugin is only read at boot: the engine loads
 * `dsh.profile.bundles` once and never again. So an install is not finished until
 * the engine is restarted, and the only process that can restart the engine is
 * the one that started it.
 *
 * ## Why the shell asks rather than listens
 *
 * The shell holds a request open against this route and waits. Nothing new
 * listens on the user's machine — the same reasoning `src/main/shot-link.ts`
 * records for the screenshot path: a listening port in the shell is a door every
 * other process on the machine can knock on, while an outgoing request is work
 * the shell already does.
 *
 * Plain HTTP rather than a WebSocket, deliberately. A socket server would mean a
 * runtime dependency (`ws`) for this plugin, which today has none at all — that
 * is what lets it ship as three files. One held-open GET carries exactly as much
 * as is needed: a single yes.
 *
 * ## The note
 *
 * A plugin written for a different engine version can stop the engine from
 * starting. When that happens this page cannot help — it is inside the engine
 * that will not start. So the last install is written down where the SHELL can
 * find it, and the shell's error screen offers to undo it. Removed again as soon
 * as a boot succeeds, so the offer only ever names a genuinely suspect install.
 * @module
 */

import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './state.ts'

/** How long one wait is held before answering "nothing yet". */
const WAIT_MS = 25_000

/** Where the shell looks for the note. Must match `src/main/paths.ts`. */
export function lastInstallPath(): string {
  return join(dshHome(), 'harness-desktop-last-install.json')
}

/** Waiters currently held open. Usually exactly one: the shell. */
const waiting = new Set<(restart: boolean) => void>()

/**
 * Hold a request until a restart is asked for, or until the wait runs out.
 * @returns true when the caller should restart the engine.
 */
export function waitForRestart(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const answer = (restart: boolean): void => {
      if (settled) return
      settled = true
      waiting.delete(answer)
      clearTimeout(timer)
      resolve(restart)
    }
    const timer = setTimeout(() => { answer(false) }, WAIT_MS)
    waiting.add(answer)
  })
}

/** Release every held request with "yes, restart". */
export function requestRestart(): void {
  for (const answer of [...waiting]) answer(true)
}

/**
 * Write down a package that was just installed, for the shell to offer to undo.
 * @param pkg - the npm package name.
 * @param label - the name the user saw on the card.
 */
export function noteInstall(pkg: string, label: string): void {
  try {
    writeFileSync(lastInstallPath(), JSON.stringify({ pkg, label, at: Date.now() }))
  } catch {
    // Losing the note costs the undo button, not the install. Nothing to tell
    // the user that they could act on.
  }
}

/** Drop the note: whatever it named is gone, so there is nothing to undo. */
export function clearInstallNote(): void {
  try {
    rmSync(lastInstallPath(), { force: true })
  } catch {
    // Same reasoning as above.
  }
}
