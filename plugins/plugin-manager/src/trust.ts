/**
 * Browser trust gate for every `/hdw/plugins/*` route.
 *
 * Second deliberate copy in this project of upstream's `isTrustedApiRequest`
 * (`_upstream_dsh/packages/client/connection/src/api-request-trust.ts`), for the
 * same reason as `plugins/dock/src/trust.ts`: a plugin resolves modules from its
 * own directory, which has no `@deepseek-ai/dsh-client-connection`, and plugins
 * cannot import across each other either.
 *
 * The gate matters even more here than there: these routes can DISABLE other
 * plugins. A malicious page open in the user's browser reaching this endpoint
 * would strip features from the app, or worse, turn off the rows that keep the
 * screen alive.
 *
 * Re-check against the upstream file after every engine upgrade.
 * @module
 */

import type { IncomingMessage } from 'node:http'

/**
 * Whether a hostname is a loopback address.
 * @param hostname - WHATWG-normalized hostname (IPv6 keeps its brackets).
 * @returns true for localhost, IPv6 loopback, or any IPv4 in 127/8.
 */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Normalize a `Host` authority, or undefined when it cannot be parsed. */
function parseAuthority(authority: string): URL | undefined {
  try {
    // `http:` is a WHATWG special scheme: parsing either yields a non-empty
    // hostname or throws.
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
 * @returns true when `Host` is ours and every browser signal is same-origin.
 */
export function isTrustedRequest(req: IncomingMessage): boolean {
  // Host gate, applied to EVERY request: a plain browser read (an image, a
  // navigation) carries neither Origin nor Fetch Metadata and looks no different
  // from curl, so there is no shortcut through those signals. `Host` is the one
  // thing DNS rebinding cannot forge.
  const host = header(req, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname)) return false

  // Cross-site gate: modern browsers label every fetch with its relationship to
  // the initiator. A cross-site label is refused regardless of Origin.
  if (header(req, 'sec-fetch-site') === 'cross-site') return false

  // Origin gate: when present it must equal this authority. Absent is normal —
  // the Host gate above already binds it. The literal string "null" (sandboxed
  // iframe, file: page) is an opaque origin, so refuse it.
  const origin = header(req, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
