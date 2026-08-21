/**
 * Where this plugin's own files live on disk.
 *
 * Everything sits under the dsh data directory rather than Electron's userData:
 * the Node half runs inside the engine process, which knows `DSH_HOME` and nothing
 * about the shell. The soul file is placed NEXT TO the engine's skill roots, never
 * inside one — a file called `SOUL.md` under `skills/` would be scanned as a flat
 * skill and rejected, because `SOUL` is not a kebab-case skill name.
 * @module
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * The dsh data directory. Same rule as upstream's `resolveDshHome`, as the shell's
 * `dshHome()` (`src/main/paths.ts`) and as the plugin manager's copy: an empty
 * value counts as unset, and `~` is expanded. Drift here means the plugin writes
 * files the engine never reads.
 * @returns absolute path of the dsh home directory.
 */
export function dshHome(): string {
  const fromEnv = process.env['DSH_HOME']
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  return resolve(selected.startsWith('~') ? join(homedir(), selected.slice(1)) : selected)
}

/**
 * The directory holding everything this plugin owns on disk.
 * @returns absolute path, not created by this call.
 */
export function growthDir(): string {
  return join(dshHome(), 'growth')
}

/**
 * The persona file: how the assistant should behave.
 * @returns absolute path of SOUL.md.
 */
export function soulPath(): string {
  return join(growthDir(), 'SOUL.md')
}

/**
 * The profile file: who the user is.
 *
 * Deliberately a second file rather than a second heading inside SOUL.md. The two
 * answer different questions — one describes the assistant, the other describes
 * the person — and they have different budgets, different editors in the UI, and
 * different reasons to change.
 * @returns absolute path of USER.md.
 */
export function userPath(): string {
  return join(growthDir(), 'USER.md')
}

/**
 * The first-run script. Present only until the setup conversation happens, then
 * deleted — its existence IS the "not set up yet" flag, so there is no separate
 * piece of state that could disagree with it.
 * @returns absolute path of START.md.
 */
export function startPath(): string {
  return join(growthDir(), 'START.md')
}

/**
 * Where a global skill goes.
 *
 * Not a directory of this plugin's own: this is the engine's own user-level
 * skill root, already watched by its discovery. Writing a bundle here makes the
 * skill available to the model without a restart and without this plugin doing
 * any discovery work of its own.
 * @returns absolute path of the user skill root.
 */
export function userSkillsDir(): string {
  return join(dshHome(), 'skills')
}

/**
 * Where a project-scoped skill goes: the highest-priority root the engine scans,
 * inside the project itself, so it travels with the repository.
 * @param projectPath - absolute path of the project directory.
 * @returns absolute path of that project's skill root.
 */
export function projectSkillsDir(projectPath: string): string {
  return join(resolve(projectPath), '.dsh', 'skills')
}
