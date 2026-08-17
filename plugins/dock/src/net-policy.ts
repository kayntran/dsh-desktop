/**
 * The single place that decides whether a URL points outside this machine and
 * outside the local network. The agent asks here before opening a page.
 *
 * **This gate applies to the AGENT only.** A user typing into the address bar can
 * still reach their router, their NAS, or a server running on this machine — that
 * is legitimate, and it travels through `normalizeUrl` in
 * `client/browser-stage.ts`, not through here. What this gate stops is a hostile
 * web page talking the agent into scanning the user's home network and reading the
 * results back out.
 *
 * ## Where it came from, and why it was copied
 *
 * The logic is ported from the reference project `D:\AI\DeepSeek Agentic AI`, file
 * `app/src/core/net-policy.ts`. Copied rather than imported because that is a
 * separate project; re-compare if it changes there. Same reason and same approach
 * as `trust.ts`.
 *
 * The original records **three vulnerabilities** it paid to close, and all three
 * are the silent kind — the gate still runs, still answers, it just answers wrong:
 *
 *   1. `new URL("http://[::1]/").hostname` returns `"[::1]"` — **brackets
 *      included**. Compared against `"::1"` it never matches, and
 *      `startsWith("fd")` does not match `"[fd00::1]"` either. Result: every
 *      private IPv6 address slipped through.
 *   2. Listing only `127.0.0.1` let the rest of `127.0.0.0/8` walk straight past,
 *      and `0.0.0.0` with it (on Windows and Linux that resolves to localhost).
 *   3. `startsWith("fc")` aimed at IPv6's ULA range but matched `fc2.com` by
 *      accident. The false-positive column matters just as much: a gate that
 *      blocks a real site is a gate that will be switched off.
 *
 * ## What it DELIBERATELY does not do
 *
 * It does not resolve host names. A public name whose DNS answer is `127.0.0.1`
 * passes here, and so does a name that answers differently on the second lookup
 * (DNS rebinding). Closing that requires a check at the connection layer, below
 * the URL layer. Treat this as a filter for obvious internal targets, not as a
 * fence that survives an attacker who controls DNS.
 * @module
 */

/** The 16-bit groups of an IPv6 address, or undefined when it will not parse. */
function parseIpv6(text: string): number[] | undefined {
  const halves = text.split('::')
  if (halves.length > 2) return undefined

  const toGroups = (part: string): number[] | undefined => {
    if (part === '') return []
    const out: number[] = []
    for (const piece of part.split(':')) {
      // Embedded IPv4 tail, e.g. `::ffff:127.0.0.1`.
      if (piece.includes('.')) {
        const embedded = parseIpv4(piece)
        if (embedded === undefined) return undefined
        const [a = 0, b = 0, c = 0, d = 0] = embedded
        out.push((a << 8) | b, (c << 8) | d)
        continue
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return undefined
      out.push(Number.parseInt(piece, 16))
    }
    return out
  }

  const head = toGroups(halves[0] ?? '')
  const tail = halves.length === 2 ? toGroups(halves[1] ?? '') : []
  if (head === undefined || tail === undefined) return undefined

  if (halves.length === 1) return head.length === 8 ? head : undefined
  const gap = 8 - head.length - tail.length
  if (gap < 1) return undefined
  return [...head, ...Array<number>(gap).fill(0), ...tail]
}

/** The four octets of a dotted IPv4 address, or undefined. */
function parseIpv4(text: string): number[] | undefined {
  const parts = text.split('.')
  if (parts.length !== 4) return undefined
  const octets: number[] = []
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return undefined
    const n = Number(p)
    if (n > 255) return undefined
    octets.push(n)
  }
  return octets
}

/** Ranges that mean this machine, this link, or this local network. */
function isPrivateIpv4(octets: number[]): boolean {
  const a = octets[0] ?? -1
  const b = octets[1] ?? -1
  if (a === 0) return true // 0.0.0.0/8 — "this host"
  if (a === 10) return true // RFC1918
  if (a === 127) return true // loopback, the WHOLE /8
  if (a === 169 && b === 254) return true // link-local, including cloud metadata addresses
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking range
  if (a >= 224) return true // multicast + reserved + broadcast
  return false
}

function isPrivateIpv6(groups: number[]): boolean {
  const onlyLast = (n: number): boolean => groups.slice(0, 7).every((x) => x === 0) && groups[7] === n
  if (onlyLast(1)) return true // ::1 loopback
  if (groups.every((x) => x === 0)) return true // :: unspecified
  // Compared by BIT MASK, not by string prefix — see vulnerability 3 above.
  if (((groups[0] ?? 0) & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if (((groups[0] ?? 0) & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  // Embedded IPv4 (`::ffff:a.b.c.d` and the compatible form): judge the v4 part inside.
  const embedded = groups.slice(0, 5).every((x) => x === 0)
  if (embedded && (groups[5] === 0xffff || groups[5] === 0)) {
    const g6 = groups[6] ?? 0
    const g7 = groups[7] ?? 0
    return isPrivateIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff])
  }
  return false
}

/**
 * Whether a hostname points at this machine, this link, or a local network.
 *
 * Takes **`URL.hostname`**, meaning a string that is already normalized: the
 * WHATWG parser turns `2130706433`, `0x7f000001`, `0177.0.0.1` and `127.1` into
 * `127.0.0.1` before this function ever sees them, and lowercases every domain
 * name. Passing a raw host string that never went through `new URL()` throws all
 * of that normalization away.
 *
 * Anything that will not parse counts as private: a shape we do not understand
 * fails closed, not open.
 * @param hostname - a normalized `URL.hostname`.
 * @returns true when the address belongs to this machine or a local network.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  if (host === '') return true

  // IPv6 inside `URL.hostname` ALWAYS keeps its brackets — see vulnerability 1 above.
  if (host.startsWith('[') && host.endsWith(']')) {
    const groups = parseIpv6(host.slice(1, -1))
    return groups === undefined ? true : isPrivateIpv6(groups)
  }

  const octets = parseIpv4(host)
  if (octets !== undefined) return isPrivateIpv4(octets)

  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal')) return true
  if (host.endsWith('.home.arpa')) return true
  // A single label has no public parent domain to resolve against; it can only be
  // a name inside the local network's search domain.
  if (!host.includes('.')) return true

  return false
}

/**
 * Add `https://` when the address carries no scheme.
 *
 * A scheme is recognized by **`://`**, not by a colon. That distinction decides
 * the outcome, and it has been wrong in both directions:
 *
 * - `example.com:8080` — the colon here is a PORT. Read as a scheme, `new URL`
 *   returns a URL whose protocol is `example.com:`, the http/https check refuses
 *   it, and a perfectly valid public address gets blocked.
 * - bare `example.com` — models offer this shape constantly, and an earlier
 *   version refused it with "not a valid URL": technically true and useless to
 *   whoever reads it.
 *
 * `javascript:alert(1)` is still blocked: it has no `://`, so it becomes
 * `https://javascript:alert(1)`, and that string does not parse.
 * @param raw - an address typed by the user or offered by the model.
 * @returns an address that definitely carries a scheme.
 */
export function withScheme(raw: string): string {
  const text = raw.trim()
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`
}

/** http(s) pointing somewhere that is neither this machine nor a local network. */
export function isPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return !isPrivateHost(parsed.hostname)
  } catch {
    return false
  }
}

/**
 * The same check, but it says which rule refused — this sentence goes straight to
 * the model.
 * @param url - the address the agent wants to open.
 * @returns the parsed URL, reusable.
 * @throws when the URL is invalid, carries the wrong scheme, or points at a local network.
 */
export function assertPublicUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(withScheme(url))
  } catch {
    throw new Error('Not a valid URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https are allowed.')
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error(
      'Cannot open a private address (localhost, *.local, RFC1918 ranges, link-local, loopback). '
      + 'The user can still type that address into the address bar themselves.',
    )
  }
  return parsed
}
