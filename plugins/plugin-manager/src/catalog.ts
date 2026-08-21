/**
 * The plugin catalog: what the world has published for this engine.
 *
 * The engine ships no registry of any kind — discovery is out of band, and the
 * only supported route is a user typing a package name. So the list comes from a
 * community catalog, `deepseek1024.com`, which indexes the `dsh-plugin` topic on
 * GitHub and probes each entry for a way to install it.
 *
 * ## Three decisions worth keeping
 *
 * **Only entries with a VERIFIED npm package survive.** The catalog offers two
 * install routes per plugin: a GitHub spec, which runs the author's build script
 * on this machine, and an npm package. Only the npm ones with `repository_backlink`
 * verification — the package points back at the repository the catalog indexed —
 * are kept. That drops roughly six thousand entries to fourteen hundred, and the
 * ones dropped are exactly the ones nobody can vouch for. The install path itself
 * re-checks against npm before touching anything (`npm-check.ts`); this is the
 * first gate, not the only one.
 *
 * **Fetched whole, once, then filtered in memory.** The endpoint takes a `q`
 * parameter, but a request per keystroke would put the user's typing on someone
 * else's server. One 8.6 MB fetch, trimmed to the dozen fields the cards use,
 * costs about 350 KB and answers every later search instantly and privately.
 *
 * **Cached on disk with the fetch time.** A day-old list is fine — plugins do not
 * appear by the minute — and a cached list means the page opens instantly and
 * still opens when the catalog is down.
 * @module
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './state.ts'

/** Where the catalog lives. Anonymous, no key, CORS open, cached 4h at their edge. */
const ENDPOINT = 'https://deepseek1024.com/api/v1/plugins'

/** Give up on a slow catalog rather than hold a route open. */
const FETCH_TIMEOUT_MS = 45_000

/** How long a cached copy is served before a refetch is due. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

/** One catalog entry, trimmed to what a card shows and an install needs. */
export interface MarketItem {
  /** Catalog id — stable, and what the install route is asked for. */
  id: string
  name: string
  owner: string
  /** The repository the package must point back at. */
  repo: string
  category: string
  description: string
  stars: number
  installs: number
  /** Last push to the repository, ISO date. */
  updatedAt: string
  /** npm package name. */
  pkg: string
  /** Exact version the catalog verified. Never a range. */
  version: string
}

/** A category as the catalog names it, with how many entries we kept in it. */
export interface MarketCategory {
  id: string
  label: string
  count: number
}

interface CacheFile {
  fetchedAt: number
  items: MarketItem[]
}

/** Semver, exact and stable: no ranges, no prerelease tags. */
const EXACT_VERSION = /^\d+\.\d+\.\d+$/

/** npm package name, scoped or not. */
const PKG_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/** Human labels for the catalog's category ids. */
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  tools: 'Tools & capabilities',
  ui: 'UI enhancements',
  dev: 'Development & runtime',
  session: 'Sessions & messages',
  model: 'Models & providers',
  skill: 'Skills',
  workflow: 'Workflow & automation',
  notify: 'Notifications & integrations',
  fun: 'Just for fun',
  theme: 'Themes & appearance',
  memory: 'Memory',
  unclassified: 'Uncategorized',
}

function cachePath(): string {
  return join(dshHome(), 'harness-desktop-market.json')
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Pick the one install method we are willing to offer.
 * @param raw - the entry's `installMethods` array, unvalidated.
 * @returns package name and exact version, or undefined when there is none.
 */
function verifiedNpm(raw: unknown): { pkg: string, version: string } | undefined {
  if (!Array.isArray(raw)) return undefined
  for (const entry of raw) {
    const method = entry as Record<string, unknown>
    if (method['kind'] !== 'npm') continue
    if (method['verification'] !== 'verified') continue
    const pkg = text(method['spec'])
    const version = text(method['revision'])
    if (!PKG_NAME.test(pkg) || !EXACT_VERSION.test(version)) continue
    return { pkg, version }
  }
  return undefined
}

/**
 * Trim one raw catalog entry down to a card.
 * @param raw - one element of the catalog's `packages` array.
 * @returns the trimmed item, or undefined when it is not installable.
 */
function normalize(raw: unknown): MarketItem | undefined {
  const entry = raw as Record<string, unknown>
  const method = verifiedNpm(entry['installMethods'])
  if (method === undefined) return undefined

  const id = text(entry['id'])
  const name = text(entry['name'])
  if (id.length === 0 || name.length === 0) return undefined

  // The repository must be on GitHub: it is the identity the npm package is
  // checked against later, and a link we are willing to show the user.
  const repo = text(entry['url'])
  if (!repo.startsWith('https://github.com/')) return undefined

  const described = entry['description'] as Record<string, unknown> | undefined
  const category = text(entry['category']) || 'unclassified'

  return {
    id,
    name,
    owner: text(entry['owner']),
    repo,
    category,
    description: text(described?.['en']),
    stars: count(entry['stars']),
    installs: count(entry['installCount']),
    updatedAt: text(entry['pushedAt']),
    pkg: method.pkg,
    version: method.version,
  }
}

/** The list as it stands in memory, and when it was fetched. */
let loaded: CacheFile | undefined

function readCache(): CacheFile | undefined {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), 'utf8')) as Partial<CacheFile>
    if (typeof parsed.fetchedAt !== 'number' || !Array.isArray(parsed.items)) return undefined
    return { fetchedAt: parsed.fetchedAt, items: parsed.items }
  } catch {
    // No cache yet, or a file from an older shape. Either way, fetch.
    return undefined
  }
}

/**
 * Fetch the catalog and trim it.
 * @throws when the catalog cannot be reached or does not answer with a list.
 */
async function fetchCatalog(): Promise<MarketItem[]> {
  const res = await fetch(ENDPOINT, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`the plugin catalog answered with status ${res.status}`)
  const body = await res.json() as { packages?: unknown }
  if (!Array.isArray(body.packages)) throw new Error('the plugin catalog did not return a list')

  const items: MarketItem[] = []
  for (const raw of body.packages) {
    const item = normalize(raw)
    if (item !== undefined) items.push(item)
  }
  if (items.length === 0) throw new Error('the plugin catalog returned nothing installable')
  return items
}

/**
 * The catalog, from memory, then from disk, then from the network.
 * @param force - true to refetch even when the cached copy is still fresh.
 * @returns the items and the moment they were fetched.
 */
export async function catalog(force = false): Promise<CacheFile> {
  if (!force) {
    loaded ??= readCache()
    if (loaded !== undefined && Date.now() - loaded.fetchedAt < MAX_AGE_MS) return loaded
  }

  let fetched: MarketItem[]
  try {
    fetched = await fetchCatalog()
  } catch (error) {
    // A stale list beats an empty page. Only when there is nothing at all does
    // the failure reach the user.
    if (loaded !== undefined) return loaded
    throw error
  }

  const next: CacheFile = { fetchedAt: Date.now(), items: fetched }
  loaded = next
  try {
    writeFileSync(cachePath(), JSON.stringify(next))
  } catch {
    // Serving from memory still works; only the next launch pays for this.
  }
  return next
}

/** How a list of results is ordered. */
export type MarketSort = 'installs' | 'stars' | 'updated'

export interface MarketQuery {
  q: string
  category: string
  sort: MarketSort
  page: number
  perPage: number
}

export interface MarketPage {
  items: MarketItem[]
  total: number
  page: number
  perPage: number
  categories: MarketCategory[]
  fetchedAt: number
}

function matches(item: MarketItem, query: string): boolean {
  if (query.length === 0) return true
  return [item.name, item.pkg, item.owner, item.description]
    .some((value) => value.toLocaleLowerCase().includes(query))
}

/**
 * Search, filter, sort and slice the catalog.
 * @param query - what the page asked for.
 * @returns one page of results, plus the category counts for the whole catalog.
 */
export async function search(query: MarketQuery): Promise<MarketPage> {
  const { items, fetchedAt } = await catalog()
  const normalized = query.q.trim().toLocaleLowerCase()

  // Category counts are taken BEFORE the category filter and AFTER the text
  // filter, so the chips show how many results each category would give for
  // what is typed — the number a user is about to act on.
  const searched = items.filter((item) => matches(item, normalized))
  const counts = new Map<string, number>()
  for (const item of searched) counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
  const categories: MarketCategory[] = [...counts.entries()]
    .map(([id, n]) => ({ id, label: CATEGORY_LABELS[id] ?? id, count: n }))
    .sort((a, b) => b.count - a.count)

  const filtered = query.category === ''
    ? searched
    : searched.filter((item) => item.category === query.category)

  const sorted = [...filtered].sort((a, b) => {
    if (query.sort === 'stars') return b.stars - a.stars
    if (query.sort === 'updated') return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
    return b.installs - a.installs
  })

  const start = query.page * query.perPage
  return {
    items: sorted.slice(start, start + query.perPage),
    total: sorted.length,
    page: query.page,
    perPage: query.perPage,
    categories,
    fetchedAt,
  }
}

/**
 * One item by its catalog id, for the install route.
 * @param id - the catalog id.
 * @returns the item, or undefined when the catalog does not carry it.
 */
export async function itemById(id: string): Promise<MarketItem | undefined> {
  const { items } = await catalog()
  return items.find((item) => item.id === id)
}
