/**
 * The HTTP surface the Settings page talks to.
 *
 * Plain same-origin fetch, like the plugin manager's routes: the app window points
 * at the engine's own web UI, so there is no IPC hop to build. Every route sits
 * behind the trust gate — these endpoints can read everything the assistant knows
 * about the user, and erase it.
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Pull in the webserver package's declaration merging: it attaches `webServer` to
// `Context`, and the merge only applies when the module is part of the program.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { MemoryStore } from './memory-store.ts'
import { MAX_FACTS_PER_LAYER } from './memory-store.ts'
import type { ReviewWatcher } from './review.ts'
import type { SkillStore } from './skill-store.ts'
import { currentSkillText, renderSkillFile, skillTarget } from './skill-store.ts'
import {
  renderProfile,
  saveProfile,
  type ProfileKind,
  type ProfileState,
} from './profile.ts'
import { setupPending } from './onboarding.ts'
import { renderFacts } from './memory-context.ts'
import { isTrustedRequest } from './trust.ts'

/** Body size ceiling for the mutating routes. */
const MAX_BODY_BYTES = 4096

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

/** Everything the routes need from the rest of the plugin. */
export interface RouteDeps {
  readonly store: MemoryStore
  readonly skills: SkillStore
  readonly review: ReviewWatcher
  readonly readSoul: () => ProfileState
  readonly readUser: () => ProfileState
}

/**
 * Register every `/hdw/growth/*` route.
 * @param ctx - the plugin's context.
 * @param deps - the store and the soul reader.
 * @returns the disposer that removes all of them.
 */
export function registerRoutes(ctx: Context, deps: RouteDeps): () => void {
  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (isTrustedRequest(req)) return true
    json(res, 403, { reason: 'request did not pass the trust gate' })
    return false
  }

  // Each proposal is sent with the file it would write and the file already
  // there, so the page can say "adds" or "replaces" before anything is approved.
  const pendingSkills = (): unknown[] => deps.skills.all().map((pending) => ({
    ...pending,
    target: skillTarget(pending),
    proposedText: renderSkillFile(pending),
    currentText: currentSkillText(pending) ?? null,
  }))

  const state = (): unknown => ({
    soul: deps.readSoul(),
    user: deps.readUser(),
    setupPending: setupPending(),
    facts: deps.store.all(),
    factLimit: MAX_FACTS_PER_LAYER,
    pendingSkills: pendingSkills(),
  })

  const readerFor = (kind: ProfileKind): (() => ProfileState) => (
    kind === 'soul' ? deps.readSoul : deps.readUser
  )

  const offState = ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/growth/state',
    handler: (req, res) => {
      if (!guard(req, res)) return
      json(res, 200, state())
    },
  })

  const offDelete = ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/growth/facts/delete',
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        json(res, 405, { reason: 'this route only accepts POST' })
        return
      }
      const body = await readJsonBody(req) as { id?: unknown } | undefined
      if (typeof body?.id !== 'string' || body.id.length === 0) {
        json(res, 400, { reason: 'id (string) is required' })
        return
      }
      const deleted = await deps.store.remove(body.id)
      json(res, 200, { deleted, facts: deps.store.all() })
    },
  })

  const offClear = ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/growth/facts/clear',
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        json(res, 405, { reason: 'this route only accepts POST' })
        return
      }
      const body = await readJsonBody(req) as { confirm?: unknown } | undefined
      // The confirmation flag is a second gate behind the one in the UI: a
      // hand-sent request must not be able to wipe memory by accident.
      if (body?.confirm !== true) {
        json(res, 400, { reason: 'confirm must be true to erase every remembered fact' })
        return
      }
      const removed = await deps.store.clear()
      json(res, 200, { removed, facts: deps.store.all() })
    },
  })

  // The readout under the composer. Keyed by session because that strip belongs
  // to one conversation: it must never report a review another chat triggered.
  const offSession = ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/growth/session',
    handler: (req, res) => {
      if (!guard(req, res)) return
      const id = new URL(req.url ?? '', 'http://localhost').searchParams.get('session') ?? ''
      if (id.length === 0) {
        json(res, 400, { reason: 'session (query parameter) is required' })
        return
      }
      const mine = deps.skills.all().filter((pending) => pending.sessionId === id)
      json(res, 200, {
        running: deps.review.isRunning(id),
        latest: deps.review.latestFor(id) ?? null,
        // Only this conversation's proposals: the strip offers a preview, and a
        // preview of someone else's work would be a lie about where it came from.
        pendingSkills: mine.map((pending) => ({
          ...pending,
          target: skillTarget(pending),
          proposedText: renderSkillFile(pending),
          currentText: currentSkillText(pending) ?? null,
        })),
        pendingTotal: deps.skills.all().length,
      })
    },
  })

  const offApprove = ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/growth/skills/approve',
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        json(res, 405, { reason: 'this route only accepts POST' })
        return
      }
      const body = await readJsonBody(req) as { id?: unknown } | undefined
      if (typeof body?.id !== 'string' || body.id.length === 0) {
        json(res, 400, { reason: 'id (string) is required' })
        return
      }
      try {
        const done = await deps.skills.approve(body.id)
        if (done === undefined) {
          json(res, 404, { reason: `no proposal carries the id "${body.id}"` })
          return
        }
        json(res, 200, { written: done.written, pendingSkills: pendingSkills() })
      } catch (error) {
        // A failed write leaves the proposal in the queue on purpose: dropping it
        // would lose the only copy of what the model wrote.
        json(res, 500, {
          reason: `could not write the skill file: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    },
  })

  const offReject = ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/growth/skills/reject',
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        json(res, 405, { reason: 'this route only accepts POST' })
        return
      }
      const body = await readJsonBody(req) as { id?: unknown } | undefined
      if (typeof body?.id !== 'string' || body.id.length === 0) {
        json(res, 400, { reason: 'id (string) is required' })
        return
      }
      const rejected = await deps.skills.reject(body.id)
      json(res, 200, { rejected, pendingSkills: pendingSkills() })
    },
  })

  /** Read the requested page from a body, or answer 400 and return undefined. */
  const kindOf = (body: unknown, res: ServerResponse): ProfileKind | undefined => {
    const raw = (body as { kind?: unknown } | undefined)?.kind
    if (raw !== 'soul' && raw !== 'user') {
      json(res, 400, { reason: 'kind must be "soul" or "user"' })
      return undefined
    }
    return raw
  }

  const offSave = ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/growth/profile/save',
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        json(res, 405, { reason: 'this route only accepts POST' })
        return
      }
      const body = await readJsonBody(req) as { kind?: unknown, text?: unknown } | undefined
      const kind = kindOf(body, res)
      if (kind === undefined) return
      if (typeof body?.text !== 'string') {
        json(res, 400, { reason: 'text (string) is required' })
        return
      }
      try {
        saveProfile(kind, body.text)
        // The reader is stat-cached, so the fresh state comes back in the same
        // reply: the page never has to guess what its own write produced.
        json(res, 200, { saved: true, profile: readerFor(kind)() })
      } catch (error) {
        json(res, 400, {
          saved: false,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    },
  })

  const offPreview = ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/growth/preview',
    handler: (req, res) => {
      if (!guard(req, res)) return
      // Rendered from the same functions the providers use, rather than read back
      // out of a live assembly: an assembly here would carry no agent, so its
      // memory half would show the global layer only while claiming to be what
      // the model sees. Same input, same code, no misleading gap.
      const soul = renderProfile(deps.readSoul())
      const user = renderProfile(deps.readUser())
      json(res, 200, {
        soulSection: soul.length === 0 ? null : soul,
        userSection: user.length === 0 ? null : user,
        memoryContext: renderFacts(deps.store.all()),
      })
    },
  })

  return () => {
    offState()
    offSession()
    offDelete()
    offClear()
    offApprove()
    offReject()
    offSave()
    offPreview()
  }
}
