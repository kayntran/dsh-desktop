/**
 * Node half of the plugin switch: read the engine's plugin tree, flip one row, and
 * remember the choice so the next launch matches.
 *
 * Every flip does two things, down two different paths:
 *
 *   1. `loader.update` — takes effect IMMEDIATELY, no restart. But the engine does
 *      not remember it: it writes into a file that is wiped on every boot.
 *   2. the app's state file (`src/state.ts`) — remembers, but only takes effect
 *      from the next launch onward.
 *
 * Without (1) the user sees nothing until they restart; without (2) reopening the
 * app turns every switch back on. Both facts are measured — see
 * `npm run spike:loader`.
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { catalog, itemById, search, type MarketSort } from './catalog.ts'
import { bareId, lockOf, SELF_ID, type LockReason } from './guard.ts'
import { busy, currentJob, install, installedPackages, remove } from './install.ts'
import { requestRestart, waitForRestart } from './lifecycle.ts'
import { describe } from './pkg-meta.ts'
import { readChoices, statePath, writeChoices } from './state.ts'
import { isTrustedRequest } from './trust.ts'

// Pull in the webserver package's declaration merging: it attaches `webServer` to
// `Context`, and the merge only applies when the module is part of the program.
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'harness-desktop-plugin-manager'

/**
 * `loader` to read and edit the plugin tree, `webServer` to expose routes to the
 * client half. Cordis keeps the fiber pending until both exist, so there is no
 * need to check for them.
 */
export const inject = ['loader', 'webServer']

/** Package-name prefix of plugins written by this project. */
const OURS_PREFIX = 'harness-desktop-'

/** Body size ceiling for the toggle route. */
const MAX_BODY_BYTES = 4096

/**
 * Catalog results per request. Small enough that the page paints at once, large
 * enough that scrolling is not a request per row.
 */
const PAGE_SIZE = 60

/**
 * Runtime mirror of `FiberState` — it is a const enum shared across packages, so
 * its values cannot be read at runtime and the table has to be rebuilt. Same
 * approach upstream's `plugin-inventory` takes.
 */
const FIBER_PHASE: Record<number, string | null> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading',
}

/**
 * Who put a plugin here.
 *
 * Three origins, not two. The first version knew only "ours or DeepSeek's", so
 * the moment a plugin was installed from the market the page called it "one of
 * DeepSeek's core plugins" and made the user acknowledge a warning to turn off
 * something they had added themselves five minutes earlier. Found by installing
 * one in the real app and clicking Disable.
 */
export type PluginOrigin = 'ours' | 'market' | 'core'

/**
 * Classify one plugin by its package name.
 * @param moduleName - the package name as the loader knows it.
 * @param fromMarket - packages listed in the profile's own dependencies.
 * @returns where this plugin came from.
 */
function originOf(moduleName: string, fromMarket: ReadonlySet<string>): PluginOrigin {
  if (moduleName.startsWith(OURS_PREFIX)) return 'ours'
  // A loader row can name a sub-path (`pkg/thing`) while the dependency list
  // holds the package, so the package part is compared too.
  const pkg = moduleName.startsWith('@')
    ? moduleName.split('/').slice(0, 2).join('/')
    : moduleName.split('/')[0] ?? moduleName
  return fromMarket.has(moduleName) || fromMarket.has(pkg) ? 'market' : 'core'
}

/**
 * A package that is on disk but not in the plugin tree yet.
 *
 * The engine reads its bundle list once, at boot, so a plugin installed while the
 * app is running exists on disk and nowhere else. Left out of the list, the page
 * answered a user who had just installed something with "Installed from the
 * market (0)" — reported from the real app, and a fair reading of it: they did
 * install it, and the page said otherwise.
 */
interface PendingView {
  pkg: string
  description?: string
}

/** One plugin row, trimmed for the UI. */
interface PluginView {
  entryId: string
  bareId: string
  moduleName: string
  enabled: boolean
  fiberPhase: string | null
  /** The plugin's own sentence about itself, when its manifest carries one. */
  description?: string
  /** Who put this plugin here — which decides how it is grouped and how it warns. */
  origin: PluginOrigin
  locked: boolean
  lockReason?: LockReason
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(text)),
  })
  res.end(text)
}

/**
 * Read a JSON body with a size ceiling.
 * @returns the parsed value, or undefined when the body is too large or not JSON.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/**
 * Snapshot of the current plugin tree.
 *
 * Two kinds of row are dropped because they are not plugins:
 *
 * - `group` rows — containers, the same rule upstream's `pluginInventory` uses;
 * - rows carrying a SUBTREE (`entry.subtree`) — that is the `include` row loading
 *   the profile's whole config file. It used to show up in the list named
 *   "include", which says nothing to a user, while disabling it costs the entire
 *   app. It stays in `guard.ts`'s lock list so a hand-sent request cannot reach it
 *   either.
 * @param ctx - the plugin's context.
 * @returns every plugin row with its verdict on whether it may be flipped.
 */
/**
 * Packages installed from the market that the running engine has not loaded.
 *
 * The difference between what the profile depends on and what the plugin tree
 * actually holds. Anything in that gap was installed since this engine started,
 * and it stays invisible until the next one.
 * @param entries - the rows the loader currently has.
 * @returns one entry per package waiting for a restart.
 */
function pendingInstalls(entries: readonly PluginView[]): PendingView[] {
  const loaded = new Set<string>()
  for (const view of entries) {
    const name = view.moduleName
    loaded.add(name)
    // A row can name a sub-path; the dependency list holds the package.
    loaded.add(name.startsWith('@')
      ? name.split('/').slice(0, 2).join('/')
      : name.split('/')[0] ?? name)
  }

  const waiting: PendingView[] = []
  for (const pkg of installedPackages()) {
    if (loaded.has(pkg)) continue
    const description = describe(pkg)
    waiting.push({ pkg, ...(description === undefined ? {} : { description }) })
  }
  return waiting
}

function snapshot(ctx: Context): PluginView[] {
  const entries = [...ctx.loader.entries()]
    .filter((entry) => entry.options.group !== true && entry.subtree === undefined)
  // Count bare ids first: when two rows share one bare id, a single config line
  // targets both, so neither can be persisted precisely.
  const bareCount = new Map<string, number>()
  for (const entry of entries) {
    const bare = bareId(entry.id)
    bareCount.set(bare, (bareCount.get(bare) ?? 0) + 1)
  }

  // Read once per snapshot rather than per row: it is a file read, and the answer
  // cannot change halfway through building one list.
  const fromMarket = installedPackages()

  const views: PluginView[] = []
  for (const entry of entries) {
    const bare = bareId(entry.id)
    const verdict = lockOf(entry.id, bareCount.get(bare) ?? 1)
    const state: FiberState | undefined = entry.fiber?.state
    const description = describe(entry.options.name)
    views.push({
      entryId: entry.id,
      bareId: bare,
      moduleName: entry.options.name,
      enabled: entry.disabled !== true,
      fiberPhase: state === undefined ? null : FIBER_PHASE[state] ?? null,
      ...(description === undefined ? {} : { description }),
      origin: originOf(entry.options.name, fromMarket),
      locked: verdict.locked,
      ...(verdict.reason === undefined ? {} : { lockReason: verdict.reason }),
    })
  }
  return views
}

/**
 * Plugin body.
 * @param ctx - the plugin's context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
      if (isTrustedRequest(req)) return true
      json(res, 403, { reason: 'request did not pass the trust gate' })
      return false
    }

    const offList = ctx.webServer.register({
      kind: 'exact',
      path: '/hdw/plugins/list',
      handler: (req, res) => {
        if (!guard(req, res)) return
        const entries = snapshot(ctx)
        json(res, 200, {
          entries,
          pending: pendingInstalls(entries),
          statePath: statePath(),
          selfId: SELF_ID,
        })
      },
    })

    const offToggle = ctx.webServer.register({
      kind: 'exact',
      path: '/hdw/plugins/toggle',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') {
          json(res, 405, { reason: 'this route only accepts POST' })
          return
        }
        const body = await readJsonBody(req)
        const wanted = body as { entryId?: unknown, enabled?: unknown } | undefined
        if (typeof wanted?.entryId !== 'string' || typeof wanted.enabled !== 'boolean') {
          json(res, 400, { reason: 'entryId (string) and enabled (boolean) are required' })
          return
        }

        const current = snapshot(ctx).find((view) => view.entryId === wanted.entryId)
        if (current === undefined) {
          json(res, 404, { reason: `no plugin carries the id "${wanted.entryId}"` })
          return
        }
        if (current.locked) {
          // Second gate, behind the one in the UI: even a hand-sent request cannot
          // disable a plugin that keeps the app alive.
          json(res, 409, { reason: 'this plugin is locked and cannot be disabled', lockReason: current.lockReason })
          return
        }

        // Step 1 — immediate effect. `null` rather than `false`: that is how the
        // field is cleared from the config, exactly as upstream writes an
        // enable row.
        try {
          await ctx.loader.update(current.entryId, { disabled: wanted.enabled ? null : true })
        } catch (error) {
          json(res, 500, {
            reason: `the engine refused the flip: ${error instanceof Error ? error.message : String(error)}`,
          })
          return
        }

        // Step 2 — so the next launch matches. Written only after step 1 succeeds:
        // persisting a state the engine just rejected would boot the app into a
        // state the user never chose.
        let saved = true
        let saveError: string | undefined
        try {
          // Write the choice EXPLICITLY, in both directions. Deleting the line
          // instead lets the bundle layer underneath speak again — and with the
          // twenty-odd rows the web composition ships disabled, "enable" would not
          // survive a single relaunch.
          const choices = readChoices()
          choices.set(current.bareId, !wanted.enabled)
          writeChoices(choices)
        } catch (error) {
          saved = false
          saveError = error instanceof Error ? error.message : String(error)
        }

        const after = snapshot(ctx).find((view) => view.entryId === current.entryId)
        json(res, 200, {
          entry: after ?? current,
          saved,
          ...(saveError === undefined ? {} : { saveError }),
        })
      },
    })

    // --- the catalog side: what could be installed, not what is.

    const offMarket = ctx.webServer.register({
      kind: 'exact',
      path: '/hdw/market/list',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        // `req.url` is a path, so it needs a base to parse against. The base is
        // thrown away; only the query is read.
        const params = new URL(req.url ?? '/', 'http://localhost').searchParams
        const sort = params.get('sort')
        try {
          const page = await search({
            q: params.get('q') ?? '',
            category: params.get('category') ?? '',
            sort: sort === 'stars' || sort === 'updated' ? sort satisfies MarketSort : 'installs',
            page: Math.max(0, Number(params.get('page') ?? '0') || 0),
            perPage: PAGE_SIZE,
          })
          // Which of these are already here. Sent with the page rather than asked
          // for separately, so a card can never render an Install button for
          // something that is already installed.
          json(res, 200, { ...page, installed: [...installedPackages()] })
        } catch (error) {
          json(res, 502, {
            reason: `could not read the plugin catalog: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
      },
    })

    const offRefresh = ctx.webServer.register({
      kind: 'exact',
      path: '/hdw/market/refresh',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') {
          json(res, 405, { reason: 'this route only accepts POST' })
          return
        }
        try {
          const fresh = await catalog(true)
          json(res, 200, { fetchedAt: fresh.fetchedAt, total: fresh.items.length })
        } catch (error) {
          json(res, 502, {
            reason: `could not refresh the plugin catalog: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
      },
    })

    // --- installing and removing. One job at a time, and it lives in this
    // process, so closing the page does not cancel it.

    const offInstall = ctx.webServer.register({
      kind: 'exact',
      path: '/hdw/market/install',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') {
          json(res, 405, { reason: 'this route only accepts POST' })
          return
        }
        const body = await readJsonBody(req) as { id?: unknown } | undefined
        if (typeof body?.id !== 'string') {
          json(res, 400, { reason: 'id (string) is required' })
          return
        }
        if (busy()) {
          json(res, 409, { reason: 'another plugin is being installed right now' })
          return
        }

        // Look the package up in the catalog rather than taking it from the
        // request. The page can only ask for something the catalog carries, so a
        // hand-sent request cannot name an arbitrary package.
        let item
        try {
          item = await itemById(body.id)
        } catch (error) {
          json(res, 502, {
            reason: `could not read the plugin catalog: ${error instanceof Error ? error.message : String(error)}`,
          })
          return
        }
        if (item === undefined) {
          json(res, 404, { reason: 'the catalog does not carry that plugin' })
          return
        }

        const started = await install({
          pkg: item.pkg,
          version: item.version,
          label: item.name,
          repo: item.repo,
        })
        if ('reason' in started) {
          json(res, 409, { reason: started.reason })
          return
        }
        json(res, 200, { job: started.job })
      },
    })

    const offRemove = ctx.webServer.register({
      kind: 'exact',
      path: '/hdw/market/remove',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') {
          json(res, 405, { reason: 'this route only accepts POST' })
          return
        }
        const body = await readJsonBody(req) as { pkg?: unknown } | undefined
        if (typeof body?.pkg !== 'string') {
          json(res, 400, { reason: 'pkg (string) is required' })
          return
        }
        // Only something this profile installed on purpose can be removed. The
        // engine's own packages are not in that list, so no request can reach them.
        if (!installedPackages().has(body.pkg)) {
          json(res, 404, { reason: 'that package was not installed from the market' })
          return
        }
        // Which stored on/off rows belonged to this package. Taken BEFORE the
        // removal, while the loader still knows: afterwards the mapping from a
        // bare id back to its package is gone.
        const bareIds = snapshot(ctx)
          .filter((view) => view.moduleName === body.pkg || view.moduleName.startsWith(`${body.pkg}/`))
          .map((view) => view.bareId)
        const started = remove(body.pkg, body.pkg, bareIds)
        if ('reason' in started) {
          json(res, 409, { reason: started.reason })
          return
        }
        json(res, 200, { job: started.job })
      },
    })

    const offJob = ctx.webServer.register({
      kind: 'exact',
      path: '/hdw/market/job',
      handler: (req, res) => {
        if (!guard(req, res)) return
        json(res, 200, { job: currentJob() ?? null, installed: [...installedPackages()] })
      },
    })

    // --- the restart handshake. The shell holds `wait` open; the page rings the
    // bell. Nothing new listens on this machine — see `lifecycle.ts`.

    const offWait = ctx.webServer.register({
      kind: 'exact',
      path: '/hdw/lifecycle/wait',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const restart = await waitForRestart()
        json(res, 200, { restart })
      },
    })

    const offRestart = ctx.webServer.register({
      kind: 'exact',
      path: '/hdw/lifecycle/restart',
      handler: (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') {
          json(res, 405, { reason: 'this route only accepts POST' })
          return
        }
        requestRestart()
        json(res, 200, { asked: true })
      },
    })

    return () => {
      offList(); offToggle(); offMarket(); offRefresh()
      offInstall(); offRemove(); offJob(); offWait(); offRestart()
    }
  }, 'hdw-plugin-manager: plugin tree, toggle, catalog, install and lifecycle routes')
}
