/**
 * Report when a new version exists. The app does NOT install it — it only says so
 * and opens the download page.
 *
 * This matters more than it looks: the dsh engine is in its rc phase and upstream
 * states plainly that breaking changes are coming, so a user stuck on an old buggy
 * version without knowing it is an easy outcome.
 * @module
 */

import { app, Notification, shell } from 'electron'

/**
 * The GitHub release repository, as `owner/repo`.
 *
 * Leave it empty until a repository exists: every check is then skipped rather than
 * calling the network or reporting an error. Filling this in switches the feature on.
 */
const REPOSITORY = ''

/** Wait a while after launch before asking — startup has more important work. */
const FIRST_CHECK_DELAY_MS = 10_000

/** How often to re-ask when the app runs for days. */
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

/** The new version that was found, if any. */
export interface AvailableUpdate {
  /** The new version number, e.g. `1.2.0`. */
  version: string
  /** The release page the user downloads from. */
  url: string
}

let timers: NodeJS.Timeout[] = []
let available: AvailableUpdate | undefined
let announced = false
let onFound: ((update: AvailableUpdate) => void) | undefined

/** Split `v1.2.3-rc.4` into comparable numbers; the pre-release suffix is ignored. */
function parseVersion(raw: string): { parts: number[]; prerelease: boolean } | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(raw.trim())
  if (match === null) return undefined
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] !== undefined,
  }
}

/**
 * Whether `candidate` is newer than `current`.
 *
 * The three main numbers are compared first; when they are equal, a final release
 * counts as newer than a pre-release carrying the same numbers. The pre-release
 * suffix is not compared any deeper: a user on a public release does not need to
 * know rc.3 from rc.4.
 */
function isNewer(candidate: string, current: string): boolean {
  const next = parseVersion(candidate)
  const now = parseVersion(current)
  if (next === undefined || now === undefined) return false
  for (let index = 0; index < 3; index++) {
    const a = next.parts[index] ?? 0
    const b = now.parts[index] ?? 0
    if (a !== b) return a > b
  }
  return now.prerelease && !next.prerelease
}

/** Ask GitHub once. Every failure stays silent — this is not worth bothering anyone about. */
async function check(): Promise<void> {
  if (REPOSITORY === '') return
  try {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return
    const release = await response.json() as { tag_name?: unknown; html_url?: unknown; draft?: unknown }
    if (release.draft === true) return
    const tag = typeof release.tag_name === 'string' ? release.tag_name : undefined
    const url = typeof release.html_url === 'string' ? release.html_url : undefined
    if (tag === undefined || url === undefined || !isNewer(tag, app.getVersion())) return

    available = { version: tag.replace(/^v/, ''), url }
    onFound?.(available)
    // Say it exactly once per run; repeating every six hours is harassment.
    if (announced) return
    announced = true
    if (!Notification.isSupported()) return
    const notification = new Notification({
      title: `${app.getName()} ${available.version} is available`,
      body: 'Click to open the download page.',
    })
    notification.on('click', () => { openReleasePage() })
    notification.show()
  } catch {
    // No network, GitHub rate limiting, unexpected JSON — none of it is the user's
    // problem.
  }
}

/**
 * Start watching for new versions.
 * @param onUpdateFound - called when one is found, so the tray menu can add a download entry.
 */
export function startUpdateChecks(onUpdateFound: (update: AvailableUpdate) => void): void {
  onFound = onUpdateFound
  timers.push(setTimeout(() => { void check() }, FIRST_CHECK_DELAY_MS))
  timers.push(setInterval(() => { void check() }, RECHECK_INTERVAL_MS))
}

/** The pending new version, if one was found. */
export function pendingUpdate(): AvailableUpdate | undefined {
  return available
}

/** Open the new version's release page. */
export function openReleasePage(): void {
  if (available !== undefined) void shell.openExternal(available.url)
}

/** Stop watching on quit. */
export function stopUpdateChecks(): void {
  for (const timer of timers) clearTimeout(timer)
  timers = []
}
