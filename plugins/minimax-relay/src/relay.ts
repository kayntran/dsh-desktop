/**
 * The pieces of the MiniMax relay that are pure functions of their input, kept
 * apart from the plumbing so the spike can measure them directly.
 *
 * The relay exists for one request field. MiniMax returns its chain of thought
 * inside the answer, wrapped in `<think>` tags, unless the request carries
 * `reasoning_split: true` — with that field set it returns the thinking in
 * `reasoning_content`, which is the field the engine already reads and renders
 * as the Think row. Neither pi-ai nor the harness's provider profile has a
 * spelling for an extra request field, so the field is added on the wire: the
 * route's `baseURL` points here, and this forwards to MiniMax with the field in
 * place.
 *
 * The upstream endpoint travels in the URL rather than in a state file, so the
 * relay holds no state at all and re-reads its own address correctly after any
 * kind of shutdown. It also means someone reading `settings.yaml` can see where
 * their requests actually go.
 * @module
 */

/** Path prefix this relay answers on. */
export const RELAY_PREFIX = '/hdw/minimax'

/**
 * Endpoints the relay will forward to.
 *
 * An allowlist rather than "whatever the URL says": the route is reachable by
 * anything that can reach the engine's own port, and a relay that forwards
 * anywhere is an open proxy. MiniMax serves two endpoints, global and China.
 */
export const MINIMAX_HOSTS: readonly string[] = ['api.minimax.io', 'api.minimaxi.com']

/** Request field that moves MiniMax's thinking out of the answer. */
export const REASONING_SPLIT = 'reasoning_split'

/**
 * Whether a URL names an endpoint this relay may forward to.
 * @param url - the candidate endpoint.
 * @returns true for an https MiniMax endpoint.
 */
export function isMinimaxEndpoint(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return parsed.protocol === 'https:' && MINIMAX_HOSTS.includes(parsed.hostname)
}

/**
 * The `baseURL` a provider route should carry so its requests come here.
 * @param origin - the engine's own origin, e.g. `http://127.0.0.1:52075`.
 * @param upstream - the real MiniMax endpoint the route named.
 * @returns the relay address for that endpoint.
 */
export function relayBaseUrl(origin: string, upstream: string): string {
  return `${origin}${RELAY_PREFIX}/${encodeURIComponent(upstream)}`
}

/** A relay address taken apart: where it forwards, and what is left of the path. */
export interface RelayTarget {
  upstream: string
  /** Path below the endpoint, e.g. `/chat/completions`; empty for the endpoint itself. */
  tail: string
}

/**
 * Take apart a request path that arrived on the relay prefix.
 * @param pathname - the request's pathname, still percent-encoded.
 * @returns the endpoint and remaining path, or undefined when the path names no allowed endpoint.
 */
export function parseRelayPath(pathname: string): RelayTarget | undefined {
  if (!pathname.startsWith(`${RELAY_PREFIX}/`)) return undefined
  const rest = pathname.slice(RELAY_PREFIX.length + 1)
  const cut = rest.indexOf('/')
  const encoded = cut === -1 ? rest : rest.slice(0, cut)
  const tail = cut === -1 ? '' : rest.slice(cut)

  let upstream: string
  try {
    upstream = decodeURIComponent(encoded)
  } catch {
    return undefined
  }
  if (!isMinimaxEndpoint(upstream)) return undefined
  return { upstream, tail }
}

/**
 * Read the endpoint back out of a `baseURL` this relay wrote earlier.
 *
 * This is what makes the rewiring idempotent: the engine's port changes on every
 * launch, so a stored relay address is stale by definition, and the plugin has
 * to recognize its own handwriting to correct it rather than relaying to itself.
 * @param baseUrl - a provider route's configured baseURL.
 * @returns the endpoint it really points at, or undefined when this is not a relay address.
 */
export function upstreamOfRelayUrl(baseUrl: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return undefined
  }
  if (parsed.hostname !== '127.0.0.1') return undefined
  return parseRelayPath(parsed.pathname)?.upstream
}

/**
 * Add the field that keeps MiniMax's thinking out of the answer.
 *
 * A body that already carries the field is left alone — if some later engine
 * learns to send it, its choice wins over ours. Anything that is not a JSON
 * object travels untouched: this relay forwards, and only reaches into a body
 * whose shape it recognizes.
 * @param body - the request body as received.
 * @returns the body to forward.
 */
export function withReasoningSplit(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return body
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return body
  const request = parsed as Record<string, unknown>
  if (REASONING_SPLIT in request) return body
  return JSON.stringify({ ...request, [REASONING_SPLIT]: true })
}

/**
 * Headers that must not be copied from one hop to the next.
 *
 * `host` names this relay, not MiniMax; the length and encoding headers describe
 * a body that is about to be re-encoded; `connection` governs one socket.
 */
const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'accept-encoding',
])

/**
 * Copy request headers for the outbound hop.
 *
 * The credential rides through untouched and is never read: pi-ai has already
 * resolved it, so the relay is a pipe rather than a second place that knows the
 * user's key.
 * @param incoming - headers as Node parsed them.
 * @returns headers for the outbound request.
 */
export function forwardRequestHeaders(incoming: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(incoming)) {
    if (HOP_BY_HOP.has(name.toLowerCase())) continue
    if (value === undefined) continue
    out[name] = Array.isArray(value) ? value.join(', ') : value
  }
  return out
}

/** Response headers that describe the hop we are ending, not the payload. */
const DROP_FROM_RESPONSE = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection'])

/**
 * Copy response headers back to the caller.
 * @param response - the upstream response.
 * @returns headers safe to send on this hop.
 */
export function forwardResponseHeaders(response: Response): Record<string, string> {
  const out: Record<string, string> = {}
  response.headers.forEach((value, name) => {
    if (DROP_FROM_RESPONSE.has(name.toLowerCase())) return
    out[name] = value
  })
  return out
}

/**
 * Cut a byte stream on safe boundaries.
 *
 * A Vietnamese letter is two or three bytes, and a network chunk can end in the
 * middle of one. Adding a hop re-cuts the stream at different places than the
 * provider did, so a consumer that turns each chunk into text on its own —
 * rather than carrying the leftover bytes to the next one — starts producing `?`
 * marks mid-word where none were before. The reply is right on the wire and
 * wrong on screen, which is the worst kind of wrong to debug.
 *
 * The fix costs nothing in feel: this holds a chunk back only until the end of
 * the event it belongs to. Server-sent events end with a blank line, one event
 * carries one token, so the reader still gets its text a token at a time — and
 * every piece handed on is whole lines of whole characters.
 */
/** Blank line that ends one server-sent event. */
const EVENT_END = '\n\n'

export class EventFramer {
  private held: Buffer = Buffer.alloc(0)

  /**
   * Take the next chunk of the response.
   * @param chunk - bytes as they arrived.
   * @returns bytes safe to hand on, possibly empty.
   */
  push(chunk: Buffer): Buffer {
    this.held = this.held.length === 0 ? chunk : Buffer.concat([this.held, chunk])
    // Everything up to the last completed event goes; the tail waits.
    const cut = this.held.lastIndexOf(EVENT_END)
    if (cut === -1) return Buffer.alloc(0)
    const ready = this.held.subarray(0, cut + EVENT_END.length)
    this.held = this.held.subarray(cut + EVENT_END.length)
    return ready
  }

  /**
   * Whatever is still held when the stream ends.
   * @returns the remaining bytes; nothing is ever dropped.
   */
  flush(): Buffer {
    const rest = this.held
    this.held = Buffer.alloc(0)
    return rest
  }
}
