/**
 * The background review pass: after a heavy conversation, the assistant looks
 * back at what just happened and decides whether anything is worth keeping.
 *
 * Shape borrowed from Hermes Agent's `background_review`, adapted to the seams
 * this engine already has:
 *
 * - **When.** At `turn/end`, and only once a conversation has spent enough tool
 *   calls to have produced something. A review costs a model call of its own, so
 *   running one after every "what time is it" would be pure waste.
 * - **How.** `ctx.subagents.start('fork', …)` — the fork provider seeds the child
 *   with the parent's completed turns, so the review reads the real conversation
 *   rather than a summary of it, on the same model, against a warm prompt cache.
 * - **What it may touch.** `toolFilter` leaves exactly two tools alive. Every
 *   other tool vanishes from the child's prompt AND refuses to execute, so the
 *   pass cannot edit a file, run a command, or reach the network.
 *
 * The pass never blocks the user: it starts after the turn is already committed,
 * and a failure is swallowed. Silence is the correct outcome of a bad review.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'

/** Tool calls a conversation must spend before a review becomes worth its cost. */
export const REVIEW_TOOL_CALL_THRESHOLD = 10

/** How long one review may run before it is cancelled. */
const REVIEW_TIMEOUT_MS = 120_000

/** The only two tools the review pass can reach. */
const REVIEW_TOOLS = ['remember', 'propose_skill']

/**
 * The instruction the forked child receives.
 *
 * Deliberately pushy about skills, following Hermes' finding that a review which
 * is merely invited to act almost never does. It is NOT pushy about memory: a
 * fact saved for the sake of saving something is exactly the noise that makes a
 * memory list worthless.
 */
const REVIEW_PROMPT = [
  'You are reviewing the conversation above, after the fact. The user is not waiting',
  'on you and will not see this turn. You can only call `remember` and `propose_skill`;',
  'every other tool is unavailable.',
  '',
  'Two questions, in order.',
  '',
  '1. MEMORY. Did the user reveal something durable about themselves — how they want to',
  'be worked with, a standing instruction, a role, a tool they use, a convention this',
  'project follows? Save it with `remember`. Only save what would still be true and',
  'useful months from now. If nothing qualifies, save nothing: an empty pass is the',
  'right outcome here more often than not.',
  '',
  '2. SKILLS. Be ACTIVE here. A conversation that spent this many tool calls usually',
  'produced something a future conversation should not have to rediscover. Look for:',
  '  - the user correcting your approach, your sequence of steps, your tone or format',
  '  - a non-obvious technique, fix, or workaround that worked',
  '  - a skill that was already loaded turning out to be wrong, outdated, or missing a step',
  '',
  'Prefer the earliest option that fits:',
  '  1. PATCH an existing skill. If one already covers this territory, pass its exact',
  '     name to `propose_skill` with the improved body. Extending the skill that was',
  '     actually in play beats adding a near-duplicate beside it.',
  '  2. ADD a new skill, but only for a class of task rather than this one session.',
  '     Name it for the recurring situation, not for today.',
  '',
  'Aim for few, dense skills. A long flat list of one-session entries is worse than',
  'nothing, because the next conversation has to read all of them.',
  '',
  'Say nothing else. When there is genuinely nothing to keep, reply "Nothing to keep."',
].join('\n')

/** What the review pass needs from the rest of the plugin. */
export interface ReviewDeps {
  /**
   * Review-pass sessions, mapped to the conversation each one is reviewing.
   *
   * A Map rather than a Set because both facts are needed. The tools read it to
   * stamp `source: 'review'` AND to record the ORIGINAL chat as the record's
   * session: the fork is an implementation detail nobody asked to see, while
   * "which conversation did this come from" is exactly what the user wants to
   * know. This module reads it so a review can never review itself.
   */
  readonly reviewSessions: Map<string, string>
  /** How many facts are stored right now; the difference across a pass is what it saved. */
  readonly factCount: () => number
  /** How many proposals are waiting right now. */
  readonly pendingCount: () => number
}

/** What one finished pass did, for the readout under the composer. */
export interface ReviewRecord {
  /** Epoch milliseconds the pass finished. */
  readonly finishedAt: number
  /** Facts saved by this pass. */
  readonly saved: number
  /** Skills proposed by this pass. */
  readonly proposed: number
  /** Set when the pass could not run to completion. */
  readonly failure?: string
}

/** The watcher's handle: a disposer plus what the routes read. */
export interface ReviewWatcher {
  /** The most recent finished pass for one session, when there is one. */
  latestFor: (sessionId: string) => ReviewRecord | undefined
  /** Whether a pass is running for that session right now. */
  isRunning: (sessionId: string) => boolean
  /** Stop watching. */
  dispose: () => void
}

function isCompletedTurn(event: SessionEvent): boolean {
  if (event.type !== 'turn/end') return false
  const reason = (event.data as { reason?: { kind?: unknown } }).reason
  return reason?.kind === 'completed'
}

/**
 * Watch every session and run the review pass when one earns it.
 * @param ctx - the plugin's context.
 * @param deps - shared state with the tools.
 * @returns the disposer that stops watching.
 */
export function registerBackgroundReview(ctx: Context, deps: ReviewDeps): ReviewWatcher {
  /** Tool calls seen per session since its last review. */
  const spent = new Map<string, number>()
  /** Sessions with a review in flight, so a second turn cannot start another. */
  const running = new Set<string>()
  /** What the last finished pass did, per session. Read by the composer readout. */
  const latest = new Map<string, ReviewRecord>()

  async function review(agent: Agent): Promise<void> {
    // Counted before and after rather than reported by the child: the child has
    // no channel back, and the difference is the honest number either way.
    const factsBefore = deps.factCount()
    const pendingBefore = deps.pendingCount()
    const control = new AbortController()
    const deadline = setTimeout(() => { control.abort() }, REVIEW_TIMEOUT_MS)
    let run
    try {
      run = await ctx.subagents.start('fork', {
        label: 'Growth review',
        prompt: [{ type: 'text', text: REVIEW_PROMPT }],
        parent: agent,
        signal: control.signal,
        // One visibility: the named tools disappear from the child's prompt and
        // refuse to execute. Everything else the parent can do stays out of reach.
        toolFilter: { allow: REVIEW_TOOLS },
      })
      // Registered before the child's first turn can call a tool, which is what
      // lets `remember` and `propose_skill` stamp these writes as `review`.
      const childId = run.localAgent?.session.id
      if (childId !== undefined) deps.reviewSessions.set(childId, agent.session.id)
      await run.result
      if (childId !== undefined) deps.reviewSessions.delete(childId)
      latest.set(agent.session.id, {
        finishedAt: Date.now(),
        saved: Math.max(0, deps.factCount() - factsBefore),
        proposed: Math.max(0, deps.pendingCount() - pendingBefore),
      })
    } finally {
      clearTimeout(deadline)
      // Always dispose: a run left undisposed keeps its child alive and its work
      // scheduled long after anyone is reading the outcome.
      await run?.dispose()
    }
  }

  const off = ctx.on('session/event', (session: Session, event: SessionEvent) => {
    const id = session.id
    // A review must never review itself, and a delegated child's turn belongs to
    // whoever delegated it.
    if (deps.reviewSessions.has(id) || session.header.parentSession !== undefined) return

    if (event.type === 'tool/call') {
      spent.set(id, (spent.get(id) ?? 0) + 1)
      return
    }
    if (!isCompletedTurn(event)) return
    if ((spent.get(id) ?? 0) < REVIEW_TOOL_CALL_THRESHOLD) return
    if (running.has(id)) return

    const agent = ctx.agents.get(id)
    if (agent === undefined) return

    // Reset before the pass rather than after: a review that fails should not
    // re-fire on the very next turn.
    spent.set(id, 0)
    running.add(id)
    void review(agent)
      .catch((error: unknown) => {
        ctx.logger?.warn?.('growth: background review failed — %s', error)
        latest.set(id, {
          finishedAt: Date.now(),
          saved: 0,
          proposed: 0,
          failure: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => { running.delete(id) })
  })

  return {
    latestFor: (sessionId: string) => latest.get(sessionId),
    isRunning: (sessionId: string) => running.has(sessionId),
    dispose: () => {
      off()
      spent.clear()
      running.clear()
      latest.clear()
    },
  }
}
