/**
 * Make the app's own plugins resolvable from the engine's side.
 *
 * Why this step is needed: the engine finds a plugin's client half through
 * `createRequire(<profile dir>).resolve('<package name>/package.json')`. The profile
 * directory lives inside `~/.dsh`, while our plugins live inside the app directory —
 * Node has no route from one to the other. A junction inside the profile's
 * resolution tree joins them.
 *
 * Declaring an absolute path in `cordis.patch.yml` instead of a package name still
 * loads the Node half, the engine reports no error, and the panel simply never
 * appears — so this step has no shortcut that is any safer.
 *
 * The junction goes into `<DSH_HOME>/profiles/node_modules/`, the very directory
 * upstream builds and repairs its own junction tree in
 * (`healProfilesModuleFallback`), and that routine only adds; it never deletes names
 * it does not recognize.
 * @module
 */

import { lstatSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { logShell } from './log.js'
import { dockPluginDir, dshHome, minimaxRelayDir, pluginManagerDir, thinkTagsDir } from './paths.js'

/**
 * Each plugin's package name and its real directory. The name must match that
 * plugin's own `package.json` and `cordis.patch.yml`.
 */
const PLUGIN_PACKAGES: readonly { name: string, dir: () => string }[] = [
  { name: 'harness-desktop-dock', dir: dockPluginDir },
  { name: 'harness-desktop-plugin-manager', dir: pluginManagerDir },
  { name: 'harness-desktop-think-tags', dir: thinkTagsDir },
  { name: 'harness-desktop-minimax-relay', dir: minimaxRelayDir },
]

function lstatOrUndefined(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

/**
 * Create a junction pointing at a directory; safe to call repeatedly.
 *
 * It always recreates rather than comparing the old target: on Windows, `readlink`
 * on a junction returns the `\\?\D:\...` form, so string comparison is
 * unreliable, and recreating is cheap.
 * @param link - the junction path that must exist.
 * @param target - the real directory it points at.
 * @throws when a real directory already occupies the junction's place.
 */
function ensureJunction(link: string, target: string): void {
  const info = lstatOrUndefined(link)
  if (info?.isSymbolicLink() === true) {
    unlinkSync(link)
  } else if (info !== undefined) {
    throw new Error(`${link} is a real directory, not a junction — stopping rather than deleting someone else's files`)
  }
  // A junction on Windows needs no administrator rights, unlike an ordinary symlink.
  symlinkSync(target, link, 'junction')
}

/**
 * Link the app's plugins into the dsh profile's module resolution tree.
 *
 * It runs on every launch, so it self-heals: if the user moves the app directory, or
 * some tool cleans the junction away, the next launch puts it back.
 *
 * It never throws outward: a broken link costs the app its panel, while throwing
 * costs the app its engine. That trade has only one correct direction.
 */
export function linkPlugins(): void {
  const dir = join(dshHome(), 'profiles', 'node_modules')
  // One `try` per plugin: a broken link costs only that plugin, the rest still get
  // linked.
  for (const plugin of PLUGIN_PACKAGES) {
    try {
      mkdirSync(dir, { recursive: true })
      ensureJunction(join(dir, plugin.name), plugin.dir())
      logShell(`plugin: linked ${plugin.name} into ${dir}`)
    } catch (error) {
      logShell(`plugin: could NOT link ${plugin.name} — ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
