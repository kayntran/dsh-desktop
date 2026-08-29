/**
 * Locate the paths that depend on whether the app runs from source or packaged.
 * @module
 */

import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * The data directory dsh uses — `~/.dsh` by default, overridable by environment
 * variable.
 *
 * The environment handling must match upstream's `resolveDshHome`
 * (`_upstream_dsh/packages/util/home-paths/src/index.ts:87`): an empty or
 * whitespace-only value counts as unset, and `~` is expanded. Drifting here points
 * the app and the engine at two different directories with nothing reporting it.
 */
export function dshHome(): string {
  const fromEnv = process.env['DSH_HOME']
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  return resolve(selected.startsWith('~') ? join(homedir(), selected.slice(1)) : selected)
}

/**
 * The directory holding the engine's dependency tree.
 *
 * The engine lives apart from the app's node_modules and is copied wholesale into
 * `resources/engine` at packaging time. Two reasons: it runs in its own Node process
 * and so must resolve modules through real paths on disk (it cannot see inside an
 * asar), and dsh's packages declare their dependencies as peerDependencies, which the
 * packager does not follow — copying wholesale means npm has already done the
 * resolving. See `engine/package.json`.
 */
function engineRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'engine')
    : join(app.getAppPath(), 'engine')
}

/** The dsh CLI's entry point — what the engine spawn runs. */
export function dshBinPath(): string {
  return join(engineRoot(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

/**
 * The Node runtime shipped with the app, where the dsh engine actually runs.
 *
 * The app does NOT use the Electron binary in Node mode for this. V8 inside Electron
 * enables the memory cage, so N-API cannot create an external ArrayBuffer; koffi —
 * how upstream calls Windows' directory picker — needs exactly that capability, and
 * without it the process dies outright (`FATAL ERROR: Error::New`) rather than
 * throwing something catchable. An official node.exe avoids that entire class of
 * failure.
 *
 * Downloaded by `npm run runtime:install`; see `scripts/fetch-node.ps1`.
 */
export function nodeExePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'runtime', 'node.exe')
    : join(app.getAppPath(), 'runtime', 'node.exe')
}

/** The dsh version in use, shown in the About window. */
export function dshVersion(): string {
  try {
    const manifest = join(engineRoot(), 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
    const version = (parsed as { version?: unknown }).version
    return typeof version === 'string' ? version : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * The bundled Node runtime's version, shown in the About window. Asked of the binary
 * directly rather than hard-coded, so what is displayed is always what actually runs.
 */
export function nodeVersion(): string {
  try {
    return execFileSync(nodeExePath(), ['-v'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    }).trim()
  } catch {
    return 'unknown'
  }
}

/**
 * The directory holding the app's own plugins.
 *
 * Same reason as `engineRoot`: the engine runs in its own Node process and so must
 * read plugins through real paths on disk; it cannot see inside an asar. At packaging
 * time `electron-builder.yml` copies `plugins/` into `resources/plugins`.
 */
export function pluginsRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'plugins')
    : join(app.getAppPath(), 'plugins')
}

/** Directory of the right-hand panel plugin (Files / Terminal / Browser). */
export function dockPluginDir(): string {
  return join(pluginsRoot(), 'dock')
}

/** Config file that enables the right-hand panel plugin, passed to the engine via `--patch`. */
export function dockPatchPath(): string {
  return join(dockPluginDir(), 'cordis.patch.yml')
}

/** Directory of the plugin switch (Settings > Plugins > On/off). */
export function pluginManagerDir(): string {
  return join(pluginsRoot(), 'plugin-manager')
}

/** Config file that enables the plugin switch, passed to the engine via `--patch`. */
export function pluginManagerPatchPath(): string {
  return join(pluginManagerDir(), 'cordis.patch.yml')
}

/** Directory of the think-tag rewriter (no UI; it only rewrites model output). */
export function thinkTagsDir(): string {
  return join(pluginsRoot(), 'think-tags')
}

/** Config file that enables the think-tag rewriter, passed to the engine via `--patch`. */
export function thinkTagsPatchPath(): string {
  return join(thinkTagsDir(), 'cordis.patch.yml')
}

/** Directory of the MiniMax relay (no UI; it only forwards provider requests). */
export function minimaxRelayDir(): string {
  return join(pluginsRoot(), 'minimax-relay')
}

/** Config file that enables the MiniMax relay, passed to the engine via `--patch`. */
export function minimaxRelayPatchPath(): string {
  return join(minimaxRelayDir(), 'cordis.patch.yml')
}

/** Directory of the app-update surface: the Settings row and the ready-to-restart pill. */
export function updaterDir(): string {
  return join(pluginsRoot(), 'updater')
}

/** Config file that enables the app-update surface, passed to the engine via `--patch`. */
export function updaterPatchPath(): string {
  return join(updaterDir(), 'cordis.patch.yml')
}

/** Directory of Soul and Memory: what the assistant knows about the user. */
export function growthDir(): string {
  return join(pluginsRoot(), 'growth')
}

/** Config file that enables Soul and Memory, passed to the engine via `--patch`. */
export function growthPatchPath(): string {
  return join(growthDir(), 'cordis.patch.yml')
}

/**
 * File recording which plugins are turned off.
 *
 * It lives under `<DSH_HOME>` rather than Electron's `userData`, because the switch
 * plugin's Node half runs inside the engine process and only knows `DSH_HOME`. This
 * path must match `statePath()` in `plugins/plugin-manager/src/state.ts`; drift
 * means the app writes a file the engine never reads, and the switch forgets every
 * time the app is reopened.
 */
export function pluginStatePath(): string {
  return join(dshHome(), 'harness-desktop-plugins.cordis.yml')
}

/**
 * Note left by the Plugins page naming the plugin it just installed.
 *
 * Written inside the engine process, read out here — so like `pluginStatePath()`
 * it lives under `<DSH_HOME>` and this path must match `lastInstallPath()` in
 * `plugins/plugin-manager/src/lifecycle.ts`. Drift means the error page never
 * offers to undo anything, and a plugin that stops the engine from starting
 * leaves the user with no way back in.
 */
export function lastInstallPath(): string {
  return join(dshHome(), 'harness-desktop-last-install.json')
}

/**
 * The package manager the engine's plugin command shells out to.
 *
 * Shipped with the app rather than expected on the user's machine: `dsh plugin
 * add` runs `pnpm` from `PATH` and exits with "not found" when there is none, and
 * most people installing a desktop app have never installed pnpm. It is the
 * plain JavaScript build, run on the same `node.exe` the engine runs on — the
 * standalone executable is 93 MB against this one's 19 MB.
 */
export function pnpmEntryPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'pnpm', 'bin', 'pnpm.cjs')
    : join(app.getAppPath(), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
}

/**
 * The app's private command directory, when it has been laid down.
 *
 * Installing a plugin runs the engine's CLI, which shells out to `pnpm` from
 * `PATH`. A packaged app cannot assume the user has one, so the app writes its
 * own wrapper here and prepends this directory to the CHILD's `PATH` only — never
 * the machine's. A developer machine that already has pnpm works without it,
 * which is why this is optional rather than required.
 * @returns the directory, or undefined when the app has not written one.
 */
export function toolsBinDir(): string | undefined {
  const dir = join(dshHome(), 'tools', 'bin')
  return existsSync(dir) ? dir : undefined
}

/** Static resources shipped with the app (splash, error page, icons). */
export function resourcePath(...parts: string[]): string {
  return join(app.getAppPath(), 'resources', ...parts)
}

/** The engine's stdout/stderr log, so the error page and the tray menu can open it. */
export function engineLogPath(): string {
  return join(app.getPath('userData'), 'engine.log')
}

/** The file recording the engine's PID, used to reap a leftover process after a hard kill. */
export function enginePidPath(): string {
  return join(app.getPath('userData'), 'engine.pid')
}
