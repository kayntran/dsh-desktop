/**
 * Node half of the app-update surface: four routes, no logic of its own.
 *
 * ## What this plugin is, and is not
 *
 * It is the PLACE the update shows up, not the thing that updates. Replacing the
 * app's own files and restarting into them can only be done by the process that
 * owns those files, and that is the Electron shell — the engine runs in a
 * separate `node.exe` it did not start and cannot replace. So the mechanism lives
 * in `src/main/updater.ts` and everything the user sees lives here.
 *
 * ## The handshake, and why it runs this way round
 *
 * The shell POSTs each change to `/hdw/update/state` and holds a request open on
 * `/hdw/update/wait` for anything the page wants back. The shell reaches out; it
 * never listens. That is the same shape as the restart handshake in
 * `plugins/plugin-manager/src/lifecycle.ts` and the screenshot link in
 * `src/main/shot-link.ts`, and the reason is recorded there: a listening port in
 * the shell is a new door on the user's machine that every other process can
 * knock on, while an outgoing request is work the shell already does.
 *
 * No runtime dependencies, deliberately — like the plugin switch, this ships as a
 * handful of files and adds nothing to the installer.
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  readState,
  requestCommand,
  waitForCommand,
  writeState,
  type UpdateCommand,
  type UpdateState,
} from './state.ts'
import { isTrustedRequest } from './trust.ts'

// Pull in the webserver package's declaration merging: it attaches `webServer` to
// `Context`, and the merge only applies when the module is part of the program.
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'harness-desktop-updater'

export const inject = ['webServer']

/** Ceiling on a posted state. It is a handful of short strings; this is generous. */
const MAX_BODY_BYTES = 8 * 1024

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(text)),
  })
  res.end(text)
}

/**
 * Read a JSON body with a size ceiling.
 * @param req - the incoming request.
 * @returns the parsed value, or undefined when the body is too large or not JSON.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/** The phases the shell is allowed to report. Anything else is a bad body. */
const PHASES = new Set(['unknown', 'checking', 'current', 'downloading', 'ready', 'error', 'unsupported'])

/**
 * Rebuild a state from a posted body, keeping only fields of the right shape.
 *
 * Written out rather than trusting the body wholesale because this value is
 * rendered: a number where a string belongs would reach React as a child it
 * cannot draw, and the settings page would go blank rather than show a wrong word.
 * @param body - the parsed request body.
 * @returns the state to store, or undefined when the body is not one.
 */
function toState(body: unknown): UpdateState | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const raw = body as Record<string, unknown>
  if (typeof raw['phase'] !== 'string' || !PHASES.has(raw['phase'])) return undefined
  if (typeof raw['current'] !== 'string') return undefined

  const state: UpdateState = { phase: raw['phase'] as UpdateState['phase'], current: raw['current'] }
  if (typeof raw['next'] === 'string') state.next = raw['next']
  if (typeof raw['percent'] === 'number' && Number.isFinite(raw['percent'])) {
    state.percent = Math.max(0, Math.min(100, Math.round(raw['percent'])))
  }
  if (typeof raw['reason'] === 'string') state.reason = raw['reason']
  if (typeof raw['downloadPage'] === 'string') state.downloadPage = raw['downloadPage']
  return state
}

/**
 * Register the four routes.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
      if (isTrustedRequest(req)) return true
      json(res, 403, { reason: 'request did not pass the trust gate' })
      return false
    }

    // The page reads where things stand.
    const offStatus = ctx.webServer.register({
      kind: 'exact',
      path: '/hdw/update/status',
      handler: (req, res) => {
        if (!guard(req, res)) return
        json(res, 200, readState())
      },
    })

    // The shell reports a change.
    const offState = ctx.webServer.register({
      kind: 'exact',
      path: '/hdw/update/state',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') {
          json(res, 405, { reason: 'this route only accepts POST' })
          return
        }
        const state = toState(await readJsonBody(req))
        if (state === undefined) {
          json(res, 400, { reason: 'body is not an update state' })
          return
        }
        writeState(state)
        json(res, 200, { stored: true })
      },
    })

    // The shell waits for something to do.
    const offWait = ctx.webServer.register({
      kind: 'exact',
      path: '/hdw/update/wait',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const command = await waitForCommand()
        json(res, 200, { command: command ?? null })
      },
    })

    // The page asks for something.
    const offAsk = ctx.webServer.register({
      kind: 'exact',
      path: '/hdw/update/ask',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') {
          json(res, 405, { reason: 'this route only accepts POST' })
          return
        }
        const body = await readJsonBody(req)
        const command = (body as { command?: unknown } | null)?.command
        if (command !== 'check' && command !== 'install') {
          json(res, 400, { reason: 'command must be "check" or "install"' })
          return
        }
        requestCommand(command as UpdateCommand)
        json(res, 200, { asked: true })
      },
    })

    return () => {
      offStatus(); offState(); offWait(); offAsk()
    }
  }, 'hdw-updater: app update status and command routes')
}
