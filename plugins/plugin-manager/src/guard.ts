/**
 * Three layers of protection so one flipped switch cannot cost you the app.
 *
 * The lock list below is MEASURED, not guessed: `npm run spike:guard` disables
 * every row in the tree one at a time and, after each one, checks whether the
 * engine still answers, whether the route into Settings still exists, and whether
 * re-enabling brings the plugin back to a running state. Result on `0.1.0-rc.6`:
 * 119 plugins safe, 15 problem rows — and exactly those 15 are handled here.
 *
 * RE-MEASURE AFTER EVERY `/nang-cap-engine`. When upstream adds or renames rows
 * this list drifts, and it drifts the dangerous way: a new plugin that keeps the
 * UI alive would have nothing locking it.
 * @module
 */

/** Why a plugin cannot be turned off — shown to the user verbatim. */
export type LockReason =
  | 'kills-engine'
  | 'breaks-ui'
  | 'no-return'
  | 'generated-id'
  | 'ambiguous-id'
  | 'self'

/**
 * Bare ids that must never be disabled, each with the reason we measured.
 *
 * Bare ids rather than full tree ids: this is what a configuration row matches,
 * so the list survives upstream reshaping the tree.
 */
export const LOCKED_IDS: Readonly<Record<string, LockReason>> = {
  // Disable these and the engine stops answering — blank app, nothing left to click.
  'include': 'kills-engine',
  'webserver': 'kills-engine',
  'web-startup': 'kills-engine',
  // Engine survives, but the route into Settings disappears — and with it the switch.
  'modules': 'breaks-ui',
  'connection': 'breaks-ui',
  'client-runtime': 'breaks-ui',
  'ui-layout': 'breaks-ui',
  'ui-sidebar': 'breaks-ui',
  'ui-settings': 'breaks-ui',
  'ui-settings-plugins': 'breaks-ui',
  // These do turn off, but re-enabling does NOT bring them back — no way home.
  'hmr': 'no-return',
  'bash-sandbox': 'no-return',
}

/** Bare id of this plugin itself — disabling it throws away the switch. */
export const SELF_ID = 'hdw-plugin-manager'

/**
 * Ids the engine generates at runtime (eight hex digits), not ids from a config
 * file. Three such rows exist in the tree: two for directory-picker and one for
 * HMR, each created by another plugin through `loader.create`.
 *
 * They are locked because the id changes on every boot, so writing it into the
 * state file would target the wrong row next time. The measurement also shows
 * `loader.update` rejecting them outright at runtime.
 */
export function hasGeneratedId(bareId: string): boolean {
  return /^[0-9a-f]{8}$/.test(bareId)
}

/** Full tree id -> the bare id used in configuration files. */
export function bareId(entryId: string): string {
  const parts = entryId.split(':')
  return parts[parts.length - 1] ?? entryId
}

/** Verdict for one entry: may it be flipped, and if not, why. */
export interface LockVerdict {
  locked: boolean
  reason?: LockReason
}

/**
 * Whether this plugin may be turned off.
 * @param entryId - full id inside the loader tree.
 * @param bareIdCount - how many entries share this bare id; more than one cannot be persisted precisely.
 * @returns the verdict with its reason.
 */
export function lockOf(entryId: string, bareIdCount: number): LockVerdict {
  const bare = bareId(entryId)
  if (bare === SELF_ID) return { locked: true, reason: 'self' }
  const listed = LOCKED_IDS[bare]
  if (listed !== undefined) return { locked: true, reason: listed }
  if (hasGeneratedId(bare)) return { locked: true, reason: 'generated-id' }
  // Two rows with the same bare id in different trees: one patch line targets both,
  // so there is no way to disable one and keep the other.
  if (bareIdCount > 1) return { locked: true, reason: 'ambiguous-id' }
  return { locked: false }
}
