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
import { bareId, lockOf, SELF_ID, type LockReason } from './guard.ts'
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

/** One plugin row, trimmed for the UI. */
interface PluginView {
  entryId: string
  bareId: string
  moduleName: string
  enabled: boolean
  fiberPhase: string | null
  /** Written by this project (flip freely) or one of DeepSeek's own. */
  ours: boolean
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

  const views: PluginView[] = []
  for (const entry of entries) {
    const bare = bareId(entry.id)
    const verdict = lockOf(entry.id, bareCount.get(bare) ?? 1)
    const state: FiberState | undefined = entry.fiber?.state
    views.push({
      entryId: entry.id,
      bareId: bare,
      moduleName: entry.options.name,
      enabled: entry.disabled !== true,
      fiberPhase: state === undefined ? null : FIBER_PHASE[state] ?? null,
      ours: entry.options.name.startsWith(OURS_PREFIX),
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
        json(res, 200, {
          entries: snapshot(ctx),
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

    return () => { offList(); offToggle() }
  }, 'hdw-plugin-manager: plugin tree read and toggle routes')
}
