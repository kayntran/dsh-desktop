/**
 * Installing and removing a plugin, by driving the engine's own CLI.
 *
 * ## Why the CLI and not our own installer
 *
 * `dsh plugin --profile web add <package>` already exists upstream. It does two
 * things, and the second is the one worth borrowing: after the package manager
 * finishes it re-reads the profile manifest and reconciles
 * `dsh.profile.bundles` — every dependency that declares `dsh.bundle.patch` is
 * added to the list the engine loads at boot, and every one that stopped
 * declaring it is dropped. Reimplementing that is reimplementing the contract
 * between a plugin and the engine, which is exactly the kind of thing that
 * silently drifts one engine upgrade later.
 *
 * So this file spawns their CLI. It knows two things the CLI does not: which
 * `node.exe` to run it on (`process.execPath` — the engine is already running on
 * the one the app ships) and where the CLI lives (`process.argv[1]` — the engine
 * was started by running exactly that file). Both are facts about the running
 * process, not guesses about the install layout.
 *
 * ## One job at a time
 *
 * Two package-manager runs against one profile directory would fight over the
 * same lock file and the same manifest. The route refuses a second job while one
 * is running, rather than queueing: a queue implies the second one still happens,
 * and after an install the app has to restart anyway.
 *
 * ## The job outlives the page
 *
 * The record lives here, in the engine process, not in the browser. Closing the
 * Plugins page mid-install does not cancel anything and does not lose the log —
 * the page reads the job back when it reopens. The dock plugin paid for the
 * opposite arrangement once, when hiding a panel killed a running command.
 * @module
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clearInstallNote, noteInstall } from './lifecycle.ts'
import { checkPackage } from './npm-check.ts'
import { dshHome, forgetChoices } from './state.ts'

/** The profile the shell starts the engine with. Same literal as `src/main/engine.ts`. */
const PROFILE = 'web'

/** Ceiling on the kept log, in characters. Enough for a full pnpm run and its error. */
const MAX_LOG = 60_000

/** A run that has not finished in this long is reported as stuck rather than hung. */
const JOB_TIMEOUT_MS = 10 * 60 * 1000

export type JobKind = 'install' | 'remove'
export type JobStatus = 'running' | 'done' | 'failed'

/** What the page polls for. */
export interface Job {
  kind: JobKind
  /** npm package name. */
  pkg: string
  /** Exact version, on an install. */
  version: string
  /** The name shown on the card, so the page can say something readable. */
  label: string
  status: JobStatus
  startedAt: number
  endedAt?: number
  /** Combined stdout and stderr, oldest trimmed when it grows past the ceiling. */
  log: string
  /** One sentence, present only when the job failed. */
  error?: string
}

let current: Job | undefined

/**
 * Packages this profile installed on purpose.
 *
 * The profile is a small npm project: `dependencies` in its manifest is exactly
 * the set someone chose to add, which is what distinguishes "installed from the
 * market" from the hundreds of packages the engine ships. Read fresh on every
 * call — a job that just finished changed this file.
 * @returns the package names, empty when the profile has none or cannot be read.
 */
export function installedPackages(): ReadonlySet<string> {
  try {
    const manifest = JSON.parse(
      readFileSync(join(dshHome(), 'profiles', PROFILE, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, unknown> }
    return new Set(Object.keys(manifest.dependencies ?? {}))
  } catch {
    // No profile manifest yet: nothing has been installed, which is the answer.
    return new Set()
  }
}

/** The job in flight, or the last one to finish. */
export function currentJob(): Job | undefined {
  return current
}

/** True while a job is running, which is when a second one must be refused. */
export function busy(): boolean {
  return current?.status === 'running'
}

/**
 * The engine's own CLI entry, taken from how this very process was started.
 * @returns the absolute path, or undefined when it cannot be trusted.
 */
function dshBin(): string | undefined {
  const argv1 = process.argv[1]
  if (argv1 === undefined || !argv1.endsWith('bin.js') || !existsSync(argv1)) return undefined
  return argv1
}

/**
 * Where the private command directory would be, if the app has laid one down.
 *
 * The CLI shells out to `pnpm` from `PATH`. A packaged app cannot assume the user
 * has one, so the shell writes a wrapper into this directory and it is prepended
 * to the child's `PATH` — and only the child's. A machine that already has pnpm
 * works either way, which is why this is optional rather than required.
 * @returns the directory, or undefined when it does not exist.
 */
function toolsDir(): string | undefined {
  const dir = join(dshHome(), 'tools', 'bin')
  return existsSync(dir) ? dir : undefined
}

/**
 * The plugin ids a package declares for itself.
 *
 * Read from the package's own bundle patch — the file the engine loads it by, so
 * it is the authoritative list. Asked BEFORE the package is deleted.
 *
 * The loader would answer the same question for a package that is running, and
 * the removal route asks it too. But a package installed and not yet restarted
 * into is NOT running, and that is exactly when a user might change their mind
 * and remove it again. Measured: pruning by the loader alone left the row behind
 * on that path.
 * @param pkg - the npm package name.
 * @returns every id the package inserts, empty when it declares none.
 */
function declaredIds(pkg: string): string[] {
  try {
    const root = join(dshHome(), 'profiles', PROFILE, 'node_modules', ...pkg.split('/'))
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: unknown } }
    }
    const patch = manifest.dsh?.bundle?.patch
    if (typeof patch !== 'string') return []
    const text = readFileSync(join(root, ...patch.split('/')), 'utf8')
    // Only the ids are wanted, so a line scan beats pulling in a YAML parser —
    // the same call this plugin's own state file makes.
    return [...text.matchAll(/^\s*-?\s*id:\s*(\S+)\s*$/gm)]
      .map((match) => match[1])
      .filter((id): id is string => id !== undefined)
  } catch {
    // No manifest, no patch, or unreadable. Nothing to forget from here.
    return []
  }
}

function append(job: Job, chunk: string): void {
  job.log += chunk
  if (job.log.length > MAX_LOG) job.log = job.log.slice(job.log.length - MAX_LOG)
}

/**
 * Run the CLI and resolve when it exits.
 * @param job - the record to stream output into and settle.
 * @param args - the CLI arguments after `plugin --profile <name>`.
 * @param forget - on a successful removal, the stored on/off rows to drop.
 */
function run(job: Job, args: string[], forget: readonly string[] = []): void {
  const bin = dshBin()
  if (bin === undefined) {
    job.status = 'failed'
    job.error = 'The app could not locate the engine command it needs to install plugins.'
    job.endedAt = Date.now()
    return
  }

  const tools = toolsDir()
  const path = process.env['PATH'] ?? ''
  const child = spawn(process.execPath, [bin, 'plugin', '--profile', PROFILE, ...args], {
    cwd: dshHome(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      ...(tools === undefined ? {} : { PATH: `${tools};${path}` }),
    },
  })

  const timer = setTimeout(() => { child.kill() }, JOB_TIMEOUT_MS)

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { append(job, chunk) })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { append(job, chunk) })

  child.on('error', (error) => {
    clearTimeout(timer)
    job.status = 'failed'
    job.error = `The install command could not be started: ${error.message}`
    job.endedAt = Date.now()
  })

  child.on('close', (code) => {
    clearTimeout(timer)
    job.endedAt = Date.now()
    if (code === 0) {
      job.status = 'done'
      // Leave the shell a note while the risky window is open: the engine has to
      // restart to load this, and if it does not come back, that screen is the
      // only place left that can undo it.
      if (job.kind === 'install') {
        noteInstall(job.pkg, job.label)
      } else {
        clearInstallNote()
        // The rows this package contributed are meaningless now, and left alone
        // they would outlive it — see `forgetChoices`.
        forgetChoices(forget)
      }
      return
    }
    job.status = 'failed'
    // 127 is the one failure with a specific cause and a specific fix, and the
    // raw log for it reads "pnpm not found on PATH", which tells a user nothing.
    job.error = code === 127
      ? 'This app is missing the package manager it needs to install plugins.'
      : `The install command stopped with code ${String(code)}.`
  })
}

/** What the install route needs to know about the plugin being installed. */
export interface InstallRequest {
  pkg: string
  version: string
  label: string
  /** The repository URL shown on the card, checked against npm's own record. */
  repo: string
}

/**
 * Check a package against npm, then install it.
 * @param request - the package, version, and the repository it claims.
 * @returns the job that was started, or the reason no job was started.
 * @throws never — every failure comes back as a reason.
 */
export async function install(request: InstallRequest): Promise<{ job: Job } | { reason: string }> {
  if (busy()) return { reason: 'another plugin is being installed right now' }

  const verdict = await checkPackage(request.pkg, request.version, request.repo)
  if (!verdict.ok) return { reason: verdict.reason }

  const job: Job = {
    kind: 'install',
    pkg: request.pkg,
    version: request.version,
    label: request.label,
    status: 'running',
    startedAt: Date.now(),
    log: `Installing ${request.pkg}@${request.version}…\n`,
  }
  current = job
  run(job, ['add', `${request.pkg}@${request.version}`])
  return { job }
}

/**
 * Remove an installed plugin package.
 * @param pkg - the npm package name.
 * @param label - the name to show while it happens.
 * @returns the job that was started, or the reason no job was started.
 */
export function remove(pkg: string, label: string, bareIds: readonly string[] = []):
{ job: Job } | { reason: string } {
  if (busy()) return { reason: 'another plugin is being installed or removed right now' }

  const job: Job = {
    kind: 'remove',
    pkg,
    version: '',
    label,
    status: 'running',
    startedAt: Date.now(),
    log: `Removing ${pkg}…\n`,
  }
  current = job
  // Both sources: what the loader currently attributes to this package, and what
  // the package says about itself. Either can be empty on its own.
  run(job, ['remove', pkg], [...new Set([...bareIds, ...declaredIds(pkg)])])
  return { job }
}
