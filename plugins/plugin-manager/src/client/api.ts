/**
 * The two calls into the Node half. Same origin as the page, so `fetch` is enough —
 * the app window points straight at the engine's web UI, the same path every
 * upstream plugin takes.
 * @module
 */

/** Why a plugin cannot be turned off. Mirrors `LockReason` in the Node half. */
export type LockReason =
  | 'kills-engine'
  | 'breaks-ui'
  | 'no-return'
  | 'generated-id'
  | 'ambiguous-id'
  | 'self'

/** One plugin row as the Node half returns it. */
export interface PluginView {
  entryId: string
  bareId: string
  moduleName: string
  enabled: boolean
  fiberPhase: string | null
  ours: boolean
  locked: boolean
  lockReason?: LockReason
}

export interface PluginListResult {
  entries: PluginView[]
  /** The state file, shown to the user as the escape hatch. */
  statePath: string
  selfId: string
}

/** Outcome of one flip. */
export interface ToggleResult {
  entry: PluginView
  /** false when the flip took effect but could not be written to disk. */
  saved: boolean
  saveError?: string
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json() as { reason?: unknown }
    if (typeof body.reason === 'string') return body.reason
  } catch {
    // Not JSON, so the status code is the answer.
  }
  return `the engine returned status ${res.status}`
}

/**
 * Read the current plugin list.
 * @throws when the engine does not answer or refuses.
 */
export async function fetchPlugins(): Promise<PluginListResult> {
  const res = await fetch('/hdw/plugins/list', { cache: 'no-store' })
  if (!res.ok) throw new Error(await readError(res))
  return await res.json() as PluginListResult
}

/**
 * Whether this plugin has a part that shows on screen.
 *
 * Asked by checking whether the engine serves the package's client bundle — the
 * trace that decides whether a plugin is present in the browser at all. Must be
 * asked BEFORE disabling: once disabled, that route returns 404 for every package.
 * @param moduleName - the plugin's package name.
 * @returns true when a client half is being served.
 */
export async function hasClientHalf(moduleName: string): Promise<boolean> {
  try {
    const res = await fetch(`/plugins/${moduleName}/client.js`, { method: 'HEAD', cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Enable or disable a plugin: immediate effect, and saved for the next launch.
 * @param entryId - full id of the row inside the plugin tree.
 * @param enabled - true to enable, false to disable.
 * @throws when the engine refuses, including when the plugin is locked.
 */
export async function togglePlugin(entryId: string, enabled: boolean): Promise<ToggleResult> {
  const res = await fetch('/hdw/plugins/toggle', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entryId, enabled }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return await res.json() as ToggleResult
}
