/**
 * The one sentence each plugin says about itself.
 *
 * Every plugin — DeepSeek's and ours — already carries a `description` in its
 * `package.json`. Nothing else on disk describes a plugin, so that field is the
 * single source: nobody has to keep a second list in step, and a plugin added
 * later shows its own words without this file being touched.
 *
 * They are read out of the engine's own resolution tree, and there are TWO of
 * them:
 *
 * - `profiles/<name>/node_modules` — where the package manager puts anything
 *   installed from the market. Searched first, because it is the one the user
 *   chose to add.
 * - `profiles/node_modules` — the junction farm upstream maintains for every
 *   package it ships (`healProfilesModuleFallback`), plus ours added beside them
 *   by `src/main/plugin-link.ts`.
 *
 * Looking in only the second one was the first version, and it left every
 * market-installed plugin with a blank card — the plugins whose names say the
 * least about them. Found by installing two and looking at the result.
 *
 * Reading the manifest directly rather than through `require.resolve` is
 * deliberate: a package whose `exports` map omits `./package.json` cannot be
 * resolved that way, and the failure would look exactly like a missing plugin.
 * @module
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { profilesDir } from './state.ts'

/**
 * Cache keyed by package name. The list route runs on every open and every flip,
 * while the answer only changes when the app restarts against a different engine.
 * `null` is a cached miss, so a package without a description is not re-read.
 */
const cache = new Map<string, string | null>()

/** The profile the shell starts the engine with. Same literal as `install.ts`. */
const PROFILE = 'web'

/** Where a plugin's manifest can be, most specific first. */
const MANIFEST_ROOTS = (): string[] => [
  join(profilesDir(), PROFILE, 'node_modules'),
  join(profilesDir(), 'node_modules'),
]

/**
 * The plugin's own one-line description.
 * @param moduleName - the package name as the loader knows it.
 * @returns the description, or undefined when the package has none.
 */
export function describe(moduleName: string): string | undefined {
  const hit = cache.get(moduleName)
  if (hit !== undefined) return hit ?? undefined

  let description: string | null = null
  for (const root of MANIFEST_ROOTS()) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(root, ...moduleName.split('/'), 'package.json'), 'utf8'),
      ) as { description?: unknown }
      if (typeof manifest.description === 'string' && manifest.description.trim().length > 0) {
        description = manifest.description.trim()
        break
      }
    } catch {
      // Not under this root, or unreadable JSON. Try the next one; when none has
      // it the card falls back to the package name, which beats an error the user
      // cannot act on.
    }
  }

  cache.set(moduleName, description)
  return description ?? undefined
}
