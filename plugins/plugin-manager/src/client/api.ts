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
  /** The plugin's own sentence about itself, read from its package manifest. */
  description?: string
  /** Who put it here. Mirrors `PluginOrigin` in the Node half. */
  origin: 'ours' | 'market' | 'core'
  locked: boolean
  lockReason?: LockReason
}

/** A package on disk that this engine has not loaded yet. */
export interface PendingView {
  pkg: string
  description?: string
}

export interface PluginListResult {
  entries: PluginView[]
  /** Installed since the engine started, so not in the tree until it restarts. */
  pending: PendingView[]
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

// ------------------------------------------------------------------- market

/** One catalog entry. Mirrors `MarketItem` in the Node half. */
export interface MarketItem {
  id: string
  name: string
  owner: string
  repo: string
  category: string
  description: string
  stars: number
  installs: number
  updatedAt: string
  pkg: string
  version: string
}

export interface MarketCategory {
  id: string
  label: string
  count: number
}

/** One page of catalog results. */
export interface MarketPage {
  items: MarketItem[]
  total: number
  page: number
  perPage: number
  categories: MarketCategory[]
  /** When the catalog was last fetched, epoch milliseconds. */
  fetchedAt: number
  /** Package names this profile has installed, so a card knows which button to show. */
  installed: string[]
}

/** How the catalog is ordered. */
export type MarketSort = 'installs' | 'stars' | 'updated'

/**
 * Search the catalog.
 * @param query - text, category, ordering and page.
 * @throws when the catalog cannot be read.
 */
export async function fetchMarket(query: {
  q: string
  category: string
  sort: MarketSort
  page: number
}): Promise<MarketPage> {
  const params = new URLSearchParams({
    q: query.q,
    category: query.category,
    sort: query.sort,
    page: String(query.page),
  })
  const res = await fetch(`/hdw/market/list?${params.toString()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(await readError(res))
  return await res.json() as MarketPage
}

/**
 * Fetch the catalog again, ignoring the cached copy.
 * @throws when the catalog cannot be reached.
 */
export async function refreshMarket(): Promise<{ fetchedAt: number, total: number }> {
  const res = await fetch('/hdw/market/refresh', { method: 'POST' })
  if (!res.ok) throw new Error(await readError(res))
  return await res.json() as { fetchedAt: number, total: number }
}

// ------------------------------------------------------- installing/removing

/** One install or removal, as the Node half reports it. Mirrors `Job`. */
export interface Job {
  kind: 'install' | 'remove'
  pkg: string
  version: string
  label: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
  log: string
  error?: string
}

/**
 * Start installing one catalog entry.
 * @param id - the catalog id from the card.
 * @throws when the package fails its checks, or another job is running.
 */
export async function installPlugin(id: string): Promise<Job> {
  const res = await fetch('/hdw/market/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json() as { job: Job }).job
}

/**
 * Remove a package this profile installed.
 * @param pkg - the npm package name.
 * @throws when the package was not installed here, or another job is running.
 */
export async function removePlugin(pkg: string): Promise<Job> {
  const res = await fetch('/hdw/market/remove', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pkg }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json() as { job: Job }).job
}

/**
 * The job in flight, or the last one to finish, plus what is installed now.
 *
 * Polled rather than pushed: the job lives in the engine process and survives the
 * page, so there is nothing to keep a socket open for.
 */
export async function fetchJob(): Promise<{ job: Job | null, installed: string[] }> {
  const res = await fetch('/hdw/market/job', { cache: 'no-store' })
  if (!res.ok) throw new Error(await readError(res))
  return await res.json() as { job: Job | null, installed: string[] }
}

/**
 * Ask the app to restart the engine, so a newly installed plugin is loaded.
 *
 * The page cannot do this itself: the engine only reads its plugin list at boot,
 * and only the app around it can start it again.
 * @throws when the app is not listening for the request.
 */
export async function restartEngine(): Promise<void> {
  const res = await fetch('/hdw/lifecycle/restart', { method: 'POST' })
  if (!res.ok) throw new Error(await readError(res))
}
