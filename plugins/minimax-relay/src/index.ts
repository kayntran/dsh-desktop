/**
 * Node half of the MiniMax relay: serve the forwarding route, and point the
 * MiniMax provider routes at it.
 *
 * Why a relay rather than a rewrite of what MiniMax sends back: the fix is one
 * request field (`reasoning_split`), and with it MiniMax speaks the same shape
 * every other provider speaks — thinking in its own field, answer in the answer.
 * Nothing downstream has to be corrected, so the reply renders natively, the
 * provider's own replay state stays valid, and the model keeps seeing its own
 * thinking on later turns. Neither pi-ai nor the harness profile has a spelling
 * for an extra request field, and both are upstream's to change, so the field is
 * added where we are allowed to stand: on the wire, in our own process.
 *
 * What this costs, stated plainly because it is not free: the provider route's
 * `baseURL` now names this relay. Turning the plugin off restores the real
 * endpoint (the disposer runs), but a machine that loses power mid-session
 * leaves the relay address stored — harmless, because the next launch rewrites
 * it, unless the plugin is also disabled before that launch.
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  EventFramer,
  forwardRequestHeaders,
  forwardResponseHeaders,
  isMinimaxEndpoint,
  parseRelayPath,
  relayBaseUrl,
  RELAY_PREFIX,
  upstreamOfRelayUrl,
  withReasoningSplit,
} from './relay.ts'

export const name = 'harness-desktop-minimax-relay'

/** `webServer` to serve the route, `settings` to point the provider routes at it. */
export const inject = ['webServer', 'settings']

/**
 * The namespace holding provider routes.
 *
 * Branded by cast rather than through the package's own `settingsNamespace()`,
 * because that would be a RUNTIME import of an engine package. This plugin lives
 * outside the engine's dependency tree — Node resolves from the real directory,
 * which reaches the app's `node_modules`, not the engine's — so every import from
 * `@deepseek-ai/*` here has to be type-only or the plugin fails to load. The
 * helper only checks a kebab-case pattern this literal already satisfies.
 */
const LLM_NAMESPACE = 'llm-pi-ai' as SettingsNamespace

/**
 * Body size ceiling for one forwarded request. A long session's history is the
 * biggest thing that travels here; the ceiling exists so a runaway caller cannot
 * grow this process without bound, not to police legitimate requests.
 */
const MAX_BODY_BYTES = 64 * 1024 * 1024

/** Read a whole request body, or undefined when it runs past the ceiling. */
async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** Only this machine may use the relay; it forwards to a paid endpoint. */
function isLoopback(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function fail(res: ServerResponse, status: number, reason: string): void {
  const body = JSON.stringify({ error: { message: `minimax-relay: ${reason}` } })
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

/**
 * Forward one request to MiniMax and stream the answer straight back.
 * @param ctx - the plugin's context, for logging a failed hop.
 * @param req - the incoming request from the engine's own model client.
 * @param res - the response this handler owns end to end.
 */
async function forward(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopback(req)) {
    fail(res, 403, 'only this machine may use the relay')
    return
  }
  const requested = new URL(req.url ?? '/', 'http://127.0.0.1')
  const target = parseRelayPath(requested.pathname)
  if (target === undefined) {
    fail(res, 404, 'the path names no MiniMax endpoint this relay serves')
    return
  }

  const body = await readBody(req)
  if (body === undefined) {
    fail(res, 413, 'request body is too large to forward')
    return
  }

  // Only the completions call carries the field; a model listing and anything
  // else this route never saw before travel exactly as they arrived.
  const isCompletions = req.method === 'POST' && target.tail === '/chat/completions'
  const outbound = isCompletions ? Buffer.from(withReasoningSplit(body.toString('utf8')), 'utf8') : body

  // The caller giving up must reach MiniMax, or a cancelled turn keeps
  // generating tokens the user already stopped waiting for.
  const abort = new AbortController()
  req.on('close', () => { if (!res.writableEnded) abort.abort() })

  let response: Response
  try {
    response = await fetch(`${target.upstream}${target.tail}${requested.search}`, {
      method: req.method ?? 'GET',
      headers: forwardRequestHeaders(req.headers),
      ...outbound.length > 0 ? { body: outbound } : {},
      signal: abort.signal,
    })
  } catch (error) {
    if (abort.signal.aborted) {
      res.destroy()
      return
    }
    ctx.logger.warn(`minimax-relay: could not reach ${target.upstream} — ${String(error)}`)
    fail(res, 502, `could not reach ${target.upstream}`)
    return
  }

  res.writeHead(response.status, forwardResponseHeaders(response))
  if (response.body === null) {
    res.end()
    return
  }
  // Piped rather than buffered: this is the token stream, and holding it would
  // turn a live reply into one that arrives all at once when it is finished.
  // An event stream is re-cut on event boundaries on the way through, so this
  // hop never hands on half a character — see EventFramer.
  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  const eventStream = (response.headers.get('content-type') ?? '').includes('text/event-stream')
  try {
    if (!eventStream) {
      await pipeline(source, res)
      return
    }
    const framer = new EventFramer()
    await pipeline(source, async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        const ready = framer.push(chunk)
        if (ready.length > 0) yield ready
      }
      const rest = framer.flush()
      if (rest.length > 0) yield rest
    }, res)
  } catch {
    res.destroy()
  }
}

/** How long the startup sweep keeps looking for the provider routes. */
const STARTUP_SWEEP_MS = 500
const STARTUP_SWEEPS = 40

/** One provider route this plugin found, and what it really means. */
interface Rewired {
  route: string
  upstream: string
  /** The baseURL as it stands right now, so an unchanged one is left alone. */
  current: string
}

/**
 * Find the MiniMax routes in the settings document.
 * @param ctx - the plugin's context.
 * @returns each route's name and its real endpoint, relay addresses decoded back.
 */
function minimaxRoutes(ctx: Context): Rewired[] {
  const descriptor = ctx.settings.describe().find(entry => entry.ns === LLM_NAMESPACE)
  const value = descriptor?.value
  if (typeof value !== 'object' || value === null) return []
  const providers = (value as Record<string, unknown>)['providers']
  if (typeof providers !== 'object' || providers === null) return []

  const found: Rewired[] = []
  for (const [route, profile] of Object.entries(providers as Record<string, unknown>)) {
    if (typeof profile !== 'object' || profile === null) continue
    const baseUrl = (profile as Record<string, unknown>)['baseURL']
    if (typeof baseUrl !== 'string') continue
    // Our own handwriting from an earlier launch: the endpoint is inside it,
    // and the port in front of it is stale.
    const stored = upstreamOfRelayUrl(baseUrl)
    if (stored !== undefined) found.push({ route, upstream: stored, current: baseUrl })
    else if (isMinimaxEndpoint(baseUrl)) found.push({ route, upstream: baseUrl, current: baseUrl })
  }
  return found
}

/** Point one route's baseURL at a value. */
async function setBaseUrl(ctx: Context, route: string, baseUrl: string): Promise<void> {
  await ctx.settings.mutate(LLM_NAMESPACE, [
    { op: 'set', path: ['providers', route, 'baseURL'], value: baseUrl },
  ])
}

/**
 * Plugin body.
 * @param ctx - the plugin's context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const off = ctx.webServer.register({
      kind: 'prefix',
      path: RELAY_PREFIX,
      handler: (req, res) => forward(ctx, req, res),
    })
    return off
  }, 'hdw-minimax-relay: forwarding route')

  ctx.effect(() => {
    const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
    /** Routes currently pointed here, and the endpoint each really means. */
    const rewired = new Map<string, string>()

    const sweep = (): void => {
      for (const entry of minimaxRoutes(ctx)) {
        rewired.set(entry.route, entry.upstream)
        const wanted = relayBaseUrl(origin, entry.upstream)
        // Already correct — and this is also what stops the loop, since our own
        // write comes back as a change notification.
        if (entry.current === wanted) continue
        void setBaseUrl(ctx, entry.route, wanted)
          .then(() => { ctx.logger.info(`minimax-relay: route "${entry.route}" now reaches ${entry.upstream} through this relay`) })
          .catch((error: unknown) => { ctx.logger.warn(`minimax-relay: could not rewire route "${entry.route}" — ${String(error)}`) })
      }
    }

    // The provider routes may not exist yet: this plugin and the one owning the
    // model settings both load at startup, in an order neither declares. So the
    // first sweep is repeated for a short while, and after that a change to the
    // settings document is what wakes it — which is also how a MiniMax route the
    // user adds later gets picked up without a restart.
    let attempts = 0
    const timer = setInterval(() => {
      attempts += 1
      if (attempts > STARTUP_SWEEPS || rewired.size > 0) clearInterval(timer)
      sweep()
    }, STARTUP_SWEEP_MS)
    const offSettings = ctx.on('settings/updated', (ns: string) => {
      if (ns === LLM_NAMESPACE) sweep()
    })
    sweep()

    // Give the routes their real endpoints back when this plugin unloads, so
    // turning it off in Settings leaves a working provider rather than one
    // pointing at a relay that no longer answers.
    return () => {
      clearInterval(timer)
      offSettings()
      for (const [route, upstream] of rewired) {
        void setBaseUrl(ctx, route, upstream).catch(() => {
          // Nothing useful is left to do here: the fiber is already going away,
          // and the next launch rewrites the address anyway.
        })
      }
    }
  }, 'hdw-minimax-relay: provider route rewiring')
}
