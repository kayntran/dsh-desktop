/**
 * The way back in when a freshly installed plugin stops the engine from starting.
 *
 * ## The failure this exists for
 *
 * A plugin from the market is written by someone else, against some version of
 * the engine, and it is only loaded at boot. So the moment it can break the app
 * is the boot after it was installed — and at that moment the Plugins page is
 * unreachable, because the Plugins page lives inside the engine that will not
 * start. Without this file the user's only remaining move is to reinstall the
 * app.
 *
 * ## How it knows what to undo
 *
 * The Plugins page writes down each install (`plugins/plugin-manager/src/
 * lifecycle.ts`), and the shell deletes that note as soon as a boot succeeds. So
 * a note that is still there when the engine fails names exactly one suspect: the
 * plugin installed since the last time this app was known to work.
 *
 * The undo runs the engine's own CLI, the same command the install ran in
 * reverse. Nothing here parses or edits the profile by hand — that would be a
 * second implementation of a contract that already has one.
 * @module
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { logShell } from './log.js'
import { dshBinPath, dshHome, lastInstallPath, nodeExePath, toolsBinDir } from './paths.js'

/** The profile the engine is started with. Same literal as `engine.ts`. */
const PROFILE = 'web'

/** Ceiling on one undo. Past it the user is told rather than left watching. */
const UNDO_TIMEOUT_MS = 5 * 60 * 1000

/** What the last install was, as far as the note says. */
export interface LastInstall {
  pkg: string
  label: string
}

/**
 * The plugin installed since the last successful start, if there is one.
 * @returns the note, or undefined when there is nothing to undo.
 */
export function lastInstall(): LastInstall | undefined {
  try {
    const note = JSON.parse(readFileSync(lastInstallPath(), 'utf8')) as Partial<LastInstall>
    if (typeof note.pkg !== 'string' || note.pkg.length === 0) return undefined
    return { pkg: note.pkg, label: typeof note.label === 'string' ? note.label : note.pkg }
  } catch {
    // No note, or one written by an older version. Either way: nothing to offer.
    return undefined
  }
}

/**
 * Forget the note. Called once a boot succeeds — from then on the install is not
 * a suspect, and offering to undo it would be offering to break a working app.
 */
export function clearLastInstall(): void {
  try {
    rmSync(lastInstallPath(), { force: true })
  } catch {
    // A note that will not delete costs a stale offer, not a broken app.
  }
}

/**
 * Remove the plugin named in the note.
 * @returns nothing on success.
 * @throws {Error} with a sentence for the user when the removal does not finish.
 */
export async function undoLastInstall(): Promise<void> {
  const note = lastInstall()
  if (note === undefined) throw new Error('There is no recent plugin install to undo.')

  const node = nodeExePath()
  const bin = dshBinPath()
  if (!existsSync(node) || !existsSync(bin)) {
    throw new Error('The app could not find the engine command needed to remove the plugin.')
  }

  const tools = toolsBinDir()
  const path = process.env['PATH'] ?? ''
  logShell(`plugin-undo: removing ${note.pkg}`)

  await new Promise<void>((resolve, reject) => {
    execFile(
      node,
      [bin, 'plugin', '--profile', PROFILE, 'remove', note.pkg],
      {
        cwd: dshHome(),
        timeout: UNDO_TIMEOUT_MS,
        windowsHide: true,
        env: { ...process.env, ...(tools === undefined ? {} : { PATH: `${tools};${path}` }) },
      },
      (error, _stdout, stderr) => {
        if (error === null) { resolve(); return }
        logShell(`plugin-undo: failed — ${error.message} ${stderr}`)
        reject(new Error(`Could not remove ${note.label}: ${error.message}`))
      },
    )
  })

  clearLastInstall()
  logShell(`plugin-undo: removed ${note.pkg}`)
}
