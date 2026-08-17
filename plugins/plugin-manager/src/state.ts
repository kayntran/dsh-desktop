/**
 * Where the on/off state lives, and why we have to store it ourselves.
 *
 * The engine's loader can disable a plugin at runtime, but it does NOT remember:
 * it writes the plugin tree into `<DSH_HOME>/profiles/web/cordis.yml`, and the
 * engine overwrites that file with an empty list on every boot — deliberately, so
 * bundle inserts are not duplicated. Measured by `npm run spike:loader`: disable
 * something, reopen the app, and it is enabled again.
 *
 * So the state lives here instead: an app-owned patch layer that the Electron
 * shell passes to the engine with `--patch`, AFTER the dock overlay. That order is
 * mandatory, not cosmetic — a layer can only edit rows that already exist when it
 * applies, so with the layers reversed our own plugins could never be turned off.
 *
 * Only the app writes this file, so a minimal parser is enough — no need to pull a
 * YAML library into the plugin.
 * @module
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/**
 * The dsh data directory. Same rule as upstream's `resolveDshHome` and as the
 * shell's `dshHome()` (`src/main/paths.ts`): an empty value counts as unset, and
 * `~` is expanded. Drift here means the app writes a file the engine never reads.
 */
function dshHome(): string {
  const fromEnv = process.env['DSH_HOME']
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  return resolve(selected.startsWith('~') ? join(homedir(), selected.slice(1)) : selected)
}

/** Path of the state file. The shell must pass exactly this file via `--patch`. */
export function statePath(): string {
  return join(dshHome(), 'harness-desktop-plugins.cordis.yml')
}

const HEADER = `# Plugins you turned on or off yourself in Harness Desktop.
#
# The app writes this file when you flip a switch in Settings > Plugins > On/off.
# The engine reads it as the topmost configuration layer, so it can disable both
# DeepSeek's own plugins and the app's.
#
# ESCAPE HATCH: if the app will not start after you disabled something, delete the
# contents of this file and replace them with the two characters [] , then reopen
# the app. Every plugin returns to its default. Do not delete the file itself.
`

/**
 * The user's choices: bare id -> disabled or not.
 *
 * BOTH directions have to be stored, not just a list of what to disable. Reason,
 * measured on the real page: upstream's web composition ships more than twenty
 * rows already disabled (`tool-bash`, `tool-fs`, `plan-mode`...). If this file
 * only listed what to disable, enabling one of those would work immediately and
 * then revert on the next launch — the bundle layer underneath still says
 * "disabled" and our layer would say nothing at all.
 *
 * The price of writing choices explicitly: if upstream changes a row's default,
 * our line pins the old value. Only rows the user flipped by hand land here, so
 * the pinned set is exactly the set they chose.
 */
export type PluginChoices = Map<string, boolean>

/**
 * Read the stored choices.
 * @returns bare id -> true when disabled, false when explicitly enabled; empty when no file yet.
 */
export function readChoices(): PluginChoices {
  let text: string
  try {
    text = readFileSync(statePath(), 'utf8')
  } catch {
    return new Map()
  }
  const choices: PluginChoices = new Map()
  // One `- id: <x>` block with `disabled: <true|false>` right below it. Only the
  // app writes this file, so the shape always matches what `writeChoices` emits.
  const pattern = /^-\s+id:\s*(\S+)\s*\n\s+disabled:\s*(true|false)\s*$/gm
  for (const match of text.matchAll(pattern)) {
    if (match[1] !== undefined) choices.set(match[1], match[2] === 'true')
  }
  return choices
}

/**
 * Rewrite the whole file with the given choices.
 * @param choices - bare id -> disabled or not.
 */
export function writeChoices(choices: PluginChoices): void {
  const sorted = [...choices.entries()].sort(([a], [b]) => a.localeCompare(b))
  const body = sorted.length === 0
    ? '[]\n'
    : sorted.map(([id, disabled]) => `- id: ${id}\n  disabled: ${String(disabled)}\n`).join('')
  const path = statePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${HEADER}\n${body}`)
}
