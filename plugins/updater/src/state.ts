/**
 * The one shape the shell and this plugin agree on, and the memory that holds it.
 *
 * ## Why the plugin holds it rather than the shell
 *
 * The shell knows everything about an update and the page knows nothing, so the
 * facts have to cross. They cross in the direction the shell already travels:
 * OUT. `src/main/updater.ts` posts each change here and holds a request open on
 * `/hdw/update/wait` for anything the page wants back. Nothing new listens on the
 * user's machine — the same reasoning `plugins/plugin-manager/src/lifecycle.ts`
 * records for the restart handshake, and `src/main/shot-link.ts` for screenshots.
 *
 * ## Why it is only in memory
 *
 * Every fact here is about THIS run: which version is running, whether a download
 * finished. On the next launch the shell asks again and posts again, so a copy on
 * disk could only ever be a stale answer to a question already being re-asked.
 * @module
 */

/** Where an update stands, from the user's point of view. */
export type UpdatePhase =
  /** Nothing has been asked yet — the shell has not reported in. */
  | 'unknown'
  /** Asking GitHub whether there is a newer version. */
  | 'checking'
  /** Asked, and this is the newest version there is. */
  | 'current'
  /** A newer version exists and is being fetched. */
  | 'downloading'
  /** Fetched and staged. Restarting is all that is left. */
  | 'ready'
  /** The check or the download failed. */
  | 'error'
  /**
   * This build cannot update itself, and saying so is the whole point.
   *
   * A portable build has no installer to replace, so the mechanism has nothing to
   * work with. Left silent, it would look exactly like "you are up to date" —
   * forever, through every release. Named, it can send the user to the download
   * page instead.
   */
  | 'unsupported'

/** What the page is told about the app it is running inside. */
export interface UpdateState {
  /** Where the update stands. */
  phase: UpdatePhase
  /** The running app's version, as the shell reports it. */
  current: string
  /** The version waiting to be installed, when there is one. */
  next?: string
  /** How much of the download has arrived, 0-100, while `phase` is `downloading`. */
  percent?: number
  /** Why it failed, in the words the user should see. */
  reason?: string
  /** Where to download by hand, for a build that cannot update itself. */
  downloadPage?: string
}

/** The starting point: the shell has not reported in yet. */
const UNKNOWN: UpdateState = { phase: 'unknown', current: '' }

let state: UpdateState = UNKNOWN

/**
 * The latest thing the shell said.
 * @returns the current state.
 */
export function readState(): UpdateState {
  return state
}

/**
 * Record what the shell just reported.
 * @param next - the new state.
 */
export function writeState(next: UpdateState): void {
  state = next
}

/** What the page can ask the shell to do. */
export type UpdateCommand = 'check' | 'install'

/** Waiters currently held open. Usually exactly one: the shell. */
const waiting = new Set<(command: UpdateCommand | undefined) => void>()

/** How long one wait is held before answering "nothing yet". */
const WAIT_MS = 25_000

/**
 * Hold a request until the page asks for something, or until the wait runs out.
 * @returns the command to carry out, or undefined when nothing was asked.
 */
export function waitForCommand(): Promise<UpdateCommand | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const answer = (command: UpdateCommand | undefined): void => {
      if (settled) return
      settled = true
      waiting.delete(answer)
      clearTimeout(timer)
      resolve(command)
    }
    const timer = setTimeout(() => { answer(undefined) }, WAIT_MS)
    waiting.add(answer)
  })
}

/**
 * Release every held request with a command.
 * @param command - what the shell should do.
 */
export function requestCommand(command: UpdateCommand): void {
  for (const answer of [...waiting]) answer(command)
}
