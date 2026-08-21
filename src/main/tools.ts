/**
 * The private command directory: how the app hands `pnpm` to the engine.
 *
 * ## The problem
 *
 * Installing a plugin runs the engine's own command, `dsh plugin --profile web
 * add <package>`, and that command shells out to `pnpm` found on `PATH`. On a
 * developer's machine there is one. On the machine of someone who installed a
 * desktop app there is not, and the failure is `exit 127` with the words "pnpm
 * not found on PATH" — a sentence that tells that user nothing they can act on.
 *
 * ## The fix, and its two boundaries
 *
 * The app ships pnpm and writes a one-line wrapper into `<DSH_HOME>/tools/bin`,
 * which is then prepended to the PATH of the CHILD process only. Two things are
 * deliberately not done:
 *
 * - **The machine's PATH is never touched.** An app that edits the user's
 *   environment changes how every other program on that machine resolves `pnpm`,
 *   and it survives the app being uninstalled.
 * - **A pnpm the user already has is not preferred over ours.** Same version
 *   everywhere means an install that works here works there; "whichever pnpm
 *   happens to be first on PATH" is how a bug becomes unreproducible.
 *
 * A `.cmd` wrapper is enough because the engine's CLI spawns pnpm through the
 * shell on Windows. It would not be enough for a plugin that spawned `pnpm`
 * itself with `shell: false` — worth remembering if that ever comes up, since the
 * fix then is a real executable rather than a batch file.
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logShell } from './log.js'
import { dshHome, nodeExePath, pnpmEntryPath } from './paths.js'

/**
 * Write the pnpm wrapper, so the engine's plugin command can find one.
 *
 * Called before the engine starts. Never throws: a missing wrapper costs the
 * ability to install plugins, while throwing here would cost the whole app.
 */
export function ensureTools(): void {
  const node = nodeExePath()
  const pnpm = pnpmEntryPath()
  if (!existsSync(node) || !existsSync(pnpm)) {
    logShell('tools: pnpm was not shipped with this build; installing plugins will not work')
    return
  }

  // `@echo off` so the wrapper does not print itself into the install log the
  // user reads. `%*` forwards every argument, and cmd hands back the exit code of
  // the last command on its own, which is what the CLI checks.
  const body = `@echo off\r\n"${node}" "${pnpm}" %*\r\n`
  const dir = join(dshHome(), 'tools', 'bin')
  const file = join(dir, 'pnpm.cmd')

  try {
    // Rewritten whenever it does not match — the app may have been reinstalled to
    // a different folder since, and a wrapper pointing at a node.exe that is no
    // longer there fails in a way that reads like a broken package manager.
    if (existsSync(file) && readFileSync(file, 'utf8') === body) return
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, body)
    logShell(`tools: wrote the pnpm wrapper to ${file}`)
  } catch (error) {
    logShell(`tools: could not write the pnpm wrapper — ${error instanceof Error ? error.message : String(error)}`)
  }
}
