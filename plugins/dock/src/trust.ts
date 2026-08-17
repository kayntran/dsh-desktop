/**
 * The browser trust gate for every `/hdw/*` route.
 *
 * This is a deliberate copy of upstream's `isTrustedApiRequest`
 * (`_upstream_dsh/packages/client/connection/src/api-request-trust.ts`). It cannot be
 * imported: the plugin resolves modules from its own directory, and
 * `@deepseek-ai/dsh-client-connection` is not there. Our gate has to be the equal of
 * theirs, so copying the logic is the right call — and on every engine upgrade,
 * re-compare against the original named above.
 *
 * It defends against the two "confused deputy" routes a browser opens in front of an
 * API running on the machine: DNS rebinding (a `Host` header carrying the attacker's
 * domain while the socket still lands on this server) and cross-site requests fired by
 * a hostile page.
 *
 * It is NOT an authentication layer: another process on the same machine can still
 * call in. That is equally true of upstream's `/api`, where the agent runs shell
 * commands — so our routes do not widen the attack surface that already exists.
 * @module
 */

import type { IncomingMessage } from 'node:http'

/**
 * Whether a hostname is a loopback address.
 * @param hostname - a WHATWG-normalized hostname (IPv6 keeps its brackets).
 * @returns true for localhost, IPv6 loopback, or any IPv4 inside 127/8.
 */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Normalize a `Host` header authority, or undefined when it will not parse. */
function parseAuthority(authority: string): URL | undefined {
  try {
    // `http:` is a WHATWG "special scheme": once it parses, the hostname is non-empty,
    // or the parse throws.
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Whether this request may touch the plugin's routes.
 * @param req - the incoming HTTP request.
 * @returns true when `Host` is ours and every browser signal agrees on the origin.
 */
export function isTrustedRequest(req: IncomingMessage): boolean {
  // The Host gate, applied to EVERY request: an ordinary browser read over plain HTTP
  // (an image, a navigation) carries neither Origin nor Fetch-Metadata and looks no
  // different from curl — so there is no shortcut based on signals. `Host` is the one
  // thing rebinding cannot fake.
  const host = header(req, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname)) return false

  // The cross-site gate: a modern browser labels every fetch with its relationship to
  // the initiator. A cross-site label is refused, whatever Origin says.
  if (header(req, 'sec-fetch-site') === 'cross-site') return false

  // The Origin gate: when an Origin is present it has to equal this authority. No
  // Origin is normal — the Host gate above already binds it. The string "null" (a
  // sandboxed iframe, a file: page) is an opaque origin, so it is refused.
  const origin = header(req, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
