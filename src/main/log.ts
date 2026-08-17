/**
 * The app shell's log — kept separate from the engine's log.
 *
 * The app ships to many people, and its most common failures ("notifications never
 * appear", "it opens completely blank") leave no trace on screen. Without this file
 * every bug report from a user turns into guesswork.
 * @module
 */

import { app } from 'electron'
import { appendFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Truncate the log past this size, so it cannot grow forever on a long-running machine. */
const MAX_BYTES = 1_000_000

/** Path to the shell's log, so the tray menu can open it. */
export function shellLogPath(): string {
  return join(app.getPath('userData'), 'shell.log')
}

/** Append one timestamped line. Never throws. */
export function logShell(message: string): void {
  const path = shellLogPath()
  try {
    if ((statSync(path, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) writeFileSync(path, '')
    appendFileSync(path, `${new Date().toISOString()}  ${message}\n`)
  } catch {
    // Failing to write the log must never break the work in progress.
  }
}
