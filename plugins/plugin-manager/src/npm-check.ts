/**
 * The gate a package passes before anything is written to disk.
 *
 * The catalog already says a package is verified. This asks npm the same
 * questions directly, because "the catalog says so" and "npm says so" are two
 * different claims and only the second one is about the bytes that will actually
 * be installed. The catalog is an index; it is not the thing being run.
 *
 * Four questions, all fail-closed:
 *
 * 1. **Does this exact version exist?** No ranges, no `latest` — the version the
 *    card showed is the version installed, or nothing is.
 * 2. **Does it run code at install time?** A package with `preinstall`,
 *    `install`, `postinstall` or `prepare` executes the author's script the
 *    moment it lands, before anyone has looked at it. Refused outright.
 * 3. **Does it point back at the repository we showed the user?** The user
 *    decided based on a GitHub link. A package claiming a different repository is
 *    not the thing they agreed to.
 * 4. **Does npm serve it over https?** A plain-http tarball is refused.
 * @module
 */

/** Give up rather than hold the install route open on a slow registry. */
const TIMEOUT_MS = 20_000

/** Lifecycle hooks that run somebody else's code as a side effect of installing. */
const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare'] as const

/** The verdict. `ok: false` always carries a sentence the user can read. */
export type CheckResult = { ok: true } | { ok: false, reason: string }

/**
 * The `owner/repo` part of a GitHub URL, lowercased.
 * @param url - any string that may be a GitHub URL.
 * @returns the slug, or undefined when the URL is not a GitHub repository.
 */
function githubSlug(url: string): string | undefined {
  const match = /github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?]|$)/i.exec(url)
  if (match === null) return undefined
  return `${match[1]}/${match[2]}`.toLowerCase()
}

/**
 * Ask npm about one exact version of one package.
 * @param pkg - the package name.
 * @param version - the exact version, already known to be plain semver.
 * @param repo - the repository URL the catalog showed the user.
 * @returns whether this package may be installed, and why not when it may not.
 */
export async function checkPackage(pkg: string, version: string, repo: string): Promise<CheckResult> {
  // A scoped name carries a slash, which would otherwise read as a path segment.
  const url = `https://registry.npmjs.org/${pkg.replace('/', '%2f')}/${version}`

  let manifest: Record<string, unknown>
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    if (res.status === 404) {
      return { ok: false, reason: `npm has no version ${version} of ${pkg}.` }
    }
    if (!res.ok) {
      return { ok: false, reason: `npm answered with status ${res.status} for ${pkg}@${version}.` }
    }
    manifest = await res.json() as Record<string, unknown>
  } catch (error) {
    return {
      ok: false,
      reason: `could not reach npm to check ${pkg}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (manifest['name'] !== pkg || manifest['version'] !== version) {
    return {
      ok: false,
      reason: `npm returned ${String(manifest['name'])}@${String(manifest['version'])}`
        + ` when asked for ${pkg}@${version}.`,
    }
  }

  const scripts = manifest['scripts'] as Record<string, unknown> | undefined
  if (scripts !== undefined) {
    const found = LIFECYCLE.filter((hook) => typeof scripts[hook] === 'string')
    if (found.length > 0) {
      return {
        ok: false,
        reason: `${pkg} runs its own code while installing (${found.join(', ')}),`
          + ' so it is not offered here.',
      }
    }
  }

  const wanted = githubSlug(repo)
  const repository = manifest['repository']
  const declared = typeof repository === 'string'
    ? repository
    : typeof (repository as { url?: unknown } | undefined)?.url === 'string'
      ? (repository as { url: string }).url
      : ''
  const got = githubSlug(declared)
  if (wanted === undefined || got === undefined || got !== wanted) {
    return {
      ok: false,
      reason: `${pkg} on npm does not point back at ${repo}`
        + `${declared === '' ? ' (it names no repository)' : ` (it names ${declared})`}.`,
    }
  }

  const tarball = (manifest['dist'] as { tarball?: unknown } | undefined)?.tarball
  if (typeof tarball !== 'string' || !tarball.startsWith('https://')) {
    return { ok: false, reason: `npm does not serve ${pkg}@${version} over https.` }
  }

  return { ok: true }
}
