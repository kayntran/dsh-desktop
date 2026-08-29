/**
 * The dsh engine process lifecycle: start it, wait for the ready signal, stop it
 * cleanly, and reap the corpse of the previous run.
 *
 * The app does not embed the engine inside the Electron process; it spawns it
 * separately, running on the node.exe shipped with the app (see `nodeExePath`). That
 * way the user needs no Node.js installation, while the engine still runs exactly as
 * it would from `dsh web` in a terminal — on the runtime upstream actually targets.
 * @module
 */

import { spawn, execFile, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync, createWriteStream, readFileSync, rmSync, writeFileSync, type WriteStream } from 'node:fs'
import { logShell } from './log.js'
import {
  dockPatchPath,
  dshBinPath,
  engineLogPath,
  enginePidPath,
  growthPatchPath,
  nodeExePath,
  minimaxRelayPatchPath,
  pluginManagerPatchPath,
  pluginStatePath,
  updaterPatchPath,
  thinkTagsPatchPath,
} from './paths.js'

/**
 * The line dsh prints to stdout once the plugin tree has settled. Upstream treats
 * this as the official ready signal: once it appears, RPC calls work.
 */
const READY_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/m

/**
 * How long to wait for the engine to be ready. The very first run spends extra time
 * initializing the profile and building the symlink tree in `%USERPROFILE%\.dsh`, so
 * the budget has to be generous.
 */
const READY_TIMEOUT_MS = 180_000

/** How many log characters to keep in memory, to show if the engine dies. */
const TAIL_LIMIT = 4000

/**
 * Contents of the state file when nothing is disabled yet: an empty list.
 *
 * It has to be valid YAML and a top-level array — the engine treats an unreadable
 * `--patch` file as a startup failure, so a missing or malformed file means the app
 * does not open at all.
 */
const EMPTY_PLUGIN_STATE = `# Plugins currently turned off in Harness Desktop.
#
# The app writes this file when you flip a switch in Settings > Plugins > On/off.
#
# ESCAPE HATCH: if the app will not start after you disabled something, delete the
# contents of this file and replace them with the two characters [] , then reopen
# the app. Every plugin returns to its default.

[]
`

/**
 * Make sure the state file exists before the engine is spawned.
 *
 * The engine treats an unreadable `--patch` file as a startup failure, and on the
 * very first run nobody has created this file yet. Created only when missing — never
 * overwrites the user's choices.
 */
function ensurePluginState(): void {
  const path = pluginStatePath()
  if (existsSync(path)) return
  try {
    writeFileSync(path, EMPTY_PLUGIN_STATE)
    logShell(`plugin: created empty state file ${path}`)
  } catch (error) {
    logShell(`plugin: could NOT create the state file — ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** A running engine. */
export interface Engine {
  /** The Web UI's loopback URL, e.g. `http://127.0.0.1:53211`. */
  readonly url: string
  /** The engine process's PID. */
  readonly pid: number
}

let child: ChildProcess | undefined
let logStream: WriteStream | undefined
let tail = ''

/**
 * The app is deliberately stopping the engine (quitting, or the user pressed Retry).
 *
 * Without this flag, a death we caused ourselves would also travel the "the engine
 * stopped unexpectedly" branch and raise the error page — right in the middle of the
 * app closing, or on top of the splash screen of a restart.
 */
let stopping = false

/** The engine died before it became ready, carrying the log tail to display. */
export class EngineStartError extends Error {
  constructor(message: string, readonly tail: string) {
    super(message)
    this.name = 'EngineStartError'
  }
}

/**
 * Kill the whole process tree. `child.kill()` only takes down the parent, leaving the
 * engine's own workers running and holding the port — on Windows that needs
 * `taskkill /T`.
 */
function killTree(pid: number): void {
  try {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {})
  } catch {
    // If the process is already dead there is nothing left to do.
  }
}

/** The previous run's engine mark, enough to recognize that exact process again. */
interface EngineMark {
  pid: number
  /** When the app spawned the engine, in epoch milliseconds. */
  spawnedAt: number
}

/**
 * The tolerance between when the app spawned and when the operating system records
 * the process as born. Those two moments sit milliseconds apart; five seconds is
 * generous while still narrow enough to rule out another process handed the same PID
 * — such a process can only be born AFTER the old engine died, which is far later
 * than the stored moment.
 */
const MARK_TOLERANCE_MS = 5_000

/** When the operating system created the process carrying this PID, or undefined if unknown. */
function processCreationTime(pid: number): number | undefined {
  try {
    // Asked as TWO statements, with a null check before calling the method.
    //
    // The one-statement version `(Get-CimInstance ...).CreationDate.ToFileTimeUtc()`
    // fails in exactly the most common case: the previous run's engine process is
    // already dead. `Get-CimInstance` does not error there — it returns EMPTY — so
    // `-ErrorAction Stop` rescues nothing, and PowerShell prints six red lines of
    // *"You cannot call a method on a null-valued expression"* right across the user's
    // startup screen. The function still returns the correct `undefined`, so the app
    // still behaves correctly; only the user gets frightened.
    const query = '$p = Get-CimInstance Win32_Process -Filter "ProcessId=' + String(pid) + '"'
      + ' -ErrorAction SilentlyContinue; if ($p) { $p.CreationDate.ToFileTimeUtc() }'
    const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', query], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
      // Do not let PowerShell's stderr flow straight into the user's terminal.
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    const fileTime = Number(output)
    if (!Number.isFinite(fileTime) || fileTime <= 0) return undefined
    // FILETIME counts 100-nanosecond units from 1601-01-01; convert to epoch milliseconds.
    return fileTime / 10_000 - 11_644_473_600_000
  } catch {
    return undefined
  }
}

/**
 * Reap an engine left over from the previous run (the app was killed hard and never
 * got to stop it). Only does anything when the previous exit was unclean.
 *
 * Windows hands a dead process's PID to a new process, so "the PID is alive" is NOT
 * enough to conclude anything — killing a reused PID by mistake kills an innocent
 * process of the user's. The pair (PID, creation time) is what uniquely identifies a
 * process on Windows, and that is what gets compared here.
 */
export function reapOrphanEngine(): void {
  const pidFile = enginePidPath()
  if (!existsSync(pidFile)) return

  let mark: EngineMark | undefined
  try {
    const parsed: unknown = JSON.parse(readFileSync(pidFile, 'utf8'))
    const candidate = parsed as Partial<EngineMark>
    if (Number.isInteger(candidate.pid) && Number.isFinite(candidate.spawnedAt)) {
      mark = candidate as EngineMark
    }
  } catch {
    // A corrupt file, or the old format — not enough grounds to kill anything.
  }
  rmSync(pidFile, { force: true })
  if (mark === undefined || mark.pid <= 0) return

  const createdAt = processCreationTime(mark.pid)
  // If it cannot be looked up, better to leave a process behind than kill the wrong one.
  if (createdAt === undefined) return
  if (Math.abs(createdAt - mark.spawnedAt) > MARK_TOLERANCE_MS) return
  killTree(mark.pid)
}

/**
 * Start the engine and wait until it can serve.
 * @param onExit - called when the engine dies unexpectedly AFTER it became ready.
 * @returns the running engine.
 * @throws {EngineStartError} when the engine dies early or the wait runs out.
 */
export async function startEngine(onExit: (tail: string) => void): Promise<Engine> {
  const bin = dshBinPath()
  if (!existsSync(bin)) {
    throw new EngineStartError(`The dsh engine was not found at:\n${bin}`, '')
  }
  const node = nodeExePath()
  if (!existsSync(node)) {
    throw new EngineStartError(`The Node runtime was not found at:\n${node}`, '')
  }

  logStream = createWriteStream(engineLogPath(), { flags: 'w' })
  tail = ''
  stopping = false

  // The engine spawns further child processes of its own — Windows' directory
  // picker is one — through its own `process.execPath`, so the whole child tree runs
  // on this node.exe rather than falling back to the Electron binary.
  //
  // `--profile` and `--patch` are launcher flags and must come BEFORE `--port`,
  // which is forwarded to the app.
  //
  // SEVEN `--patch` LAYERS, AND THE ORDER IS MANDATORY. The engine applies them in
  // command-line order, and a layer can only edit rows that already exist when it
  // applies:
  //
  //   1. the right-hand panel (Files / Terminal / Browser)
  //   2. the plugin on/off switch
  //   3. the think-tag rewriter
  //   4. the MiniMax relay
  //   5. Soul and Memory
  //   6. the app-update surface
  //   7. the user's own choices — MUST COME LAST
  //
  // Put the last layer earlier and it cannot see the rows the ones above insert, so a
  // user who disables the panel — or the switch itself — finds them enabled again on
  // the next launch, with nothing reporting an error. Measured:
  // `npm run spike:loader`, checks 9 and 10.
  ensurePluginState()
  const spawned = spawn(node, [
    bin, '--profile', 'web',
    '--patch', dockPatchPath(),
    '--patch', pluginManagerPatchPath(),
    '--patch', thinkTagsPatchPath(),
    '--patch', minimaxRelayPatchPath(),
    '--patch', growthPatchPath(),
    '--patch', updaterPatchPath(),
    '--patch', pluginStatePath(),
    '--port', '0',
    // From dsh 0.1.1-rc.2 the web profile opens the user's default browser on
    // startup. That is right for someone running `dsh web` in a terminal and wrong
    // here: the app already shows the UI in its own window, so the browser tab is a
    // second copy nobody asked for.
    //
    // It is not merely untidy. That tab loads the panel plugin too and joins the
    // panel's control bridge, and an ordinary browser has no `<webview>` — so the
    // agent's "read this page", "screenshot it", "navigate it" commands were routed
    // into the browser tab and died there while the panel in this window sat unused.
    // Measured: `npm run spike:dock` fell from 62/62 to 40/62 on the upgrade, and
    // every one of the 22 failures was a command that had gone to the wrong copy.
    '--no-open',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  child = spawned

  const pid = spawned.pid
  if (pid === undefined) throw new EngineStartError('The engine process could not be spawned.', '')
  const mark: EngineMark = { pid, spawnedAt: Date.now() }
  writeFileSync(enginePidPath(), JSON.stringify(mark))
  logShell(`engine: spawned pid ${String(pid)} — ${node} running ${bin}`)

  const collect = (chunk: string): void => {
    logStream?.write(chunk)
    tail = (tail + chunk).slice(-TAIL_LIMIT)
  }
  spawned.stdout?.setEncoding('utf8')
  spawned.stderr?.setEncoding('utf8')
  spawned.stderr?.on('data', collect)

  let ready = false
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new EngineStartError(`The engine did not answer within ${READY_TIMEOUT_MS / 1000} seconds.`, tail))
    }, READY_TIMEOUT_MS)
    const settle = (fn: () => void): void => { clearTimeout(timer); fn() }

    let stdout = ''
    spawned.stdout?.on('data', (chunk: string) => {
      collect(chunk)
      if (ready) return
      stdout += chunk
      const match = READY_LINE.exec(stdout)
      if (match?.[1] !== undefined) {
        const found = match[1]
        settle(() => { ready = true; resolve(found) })
      }
    })
    // The engine can print the URL line and still die right afterwards (a sibling
    // plugin failing at mount), so exit has to be watched rather than trusting the
    // URL line alone.
    spawned.on('exit', (code) => {
      // News about an engine that has already been replaced is not news about the
      // running one. A restart kills the old process and Windows delivers that
      // exit ASYNCHRONOUSLY — measured: often after the replacement is already
      // serving. Without this guard the old engine's death was reported against
      // the new one, and the app threw up its "could not start" page over a
      // perfectly healthy engine. `stopping` alone cannot catch it: the next
      // `startEngine` clears that flag before the late exit arrives.
      if (spawned !== child) return
      if (ready) {
        if (stopping) return
        logShell(`engine: exited unexpectedly with code ${String(code)}`)
        onExit(tail)
        return
      }
      settle(() => reject(new EngineStartError(`The engine exited early with code ${String(code)}.`, tail)))
    })
    spawned.on('error', (error) => {
      if (spawned !== child) return
      if (ready) return
      settle(() => reject(new EngineStartError(error.message, tail)))
    })
  }).catch((error: unknown) => {
    logShell(`engine: failed to start — ${error instanceof Error ? error.message : String(error)}`)
    killTree(pid)
    rmSync(enginePidPath(), { force: true })
    throw error
  })

  logShell(`engine: ready at ${url}`)
  return { url, pid }
}

/** Stop the engine and remove the PID mark. Safe to call repeatedly. */
export function stopEngine(): void {
  stopping = true
  const pid = child?.pid
  child = undefined
  logStream?.end()
  logStream = undefined
  rmSync(enginePidPath(), { force: true })
  if (pid !== undefined) killTree(pid)
}
