/**
 * The two tools the model gets: `remember` and `propose_skill`.
 *
 * They are deliberately asymmetric. `remember` writes straight through — a fact
 * is one sentence, and a wrong one costs a click to delete. `propose_skill` only
 * queues: a skill is a standing instruction the assistant follows on every task
 * of that kind, so a human approves it before it reaches disk.
 *
 * ## Why upstream's `defineTool` is NOT used
 *
 * Same reason as `plugins/dock/src/tools.ts`: `defineTool` is a runtime import
 * from `@deepseek-ai/dsh-tools`, this plugin sits outside the engine's module
 * tree, and the import kills the engine at startup with ERR_MODULE_NOT_FOUND. A
 * tool is a plain object, so it is built by hand here. The documented price is
 * that a raw-JSON-Schema tool validates its own arguments — every check below is
 * therefore mandatory, not defensive.
 *
 * ## Why one tool and no `forget`
 *
 * The model writes directly, by decision; writing is not deleting. Correcting a
 * fact is a write with `replaces`, which supersedes in one operation, so the
 * model can move memory sideways but never drive it toward empty. Deleting is a
 * human act and lives in Settings, where the user can see what goes.
 * @module
 */

import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { MemoryScope } from './memory-domain.ts'
import { FACT_ID_RE, SKILL_NAME_RE } from './memory-domain.ts'
import type { MemoryStore } from './memory-store.ts'
import { MAX_FACT_LENGTH, MAX_FACTS_PER_LAYER, projectKey } from './memory-store.ts'
import type { SkillStore } from './skill-store.ts'
import { MAX_PENDING_SKILLS, MAX_SKILL_BODY } from './skill-store.ts'
import type { ProfileKind } from './profile.ts'
import { appendDirectives, profileLimit } from './profile.ts'
import { completeOnboarding, setupPending } from './onboarding.ts'

const DESCRIPTION = [
  'Save a durable fact about how this user works or about the project in front of',
  'you, so that future conversations start already knowing it: a convention a',
  'repository follows, a command that is the right one here, a tool in play, a',
  'decision already made. NOT for who the user is as a person and NOT for a',
  'standing rule about how you must behave — both of those belong in',
  '`update_profile`, and a fact filed in the wrong place is a fact the user cannot',
  'find. Do not use it for one-off task details, for passwords or keys, or for',
  'anything the user asked you to forget. Saved facts are shown to the user under',
  'Settings > Growth, and they can delete any of them.',
].join(' ')

const TEXT_HINT = [
  'The fact as one self-contained sentence, in the third person. It has to still',
  'make sense months from now with no other context. Good: "Prefers TypeScript',
  'over JavaScript for new scripts." Bad: "prefers the second option".',
].join(' ')

const SCOPE_HINT = [
  'Use "global" for facts about the user that hold everywhere. Use "project" for',
  'facts that are only true inside the directory this conversation is working in.',
].join(' ')

const REPLACES_HINT = [
  'Id of an existing fact this one supersedes, copied from the bracketed id in the',
  'remembered-facts list. That fact is removed. Omit it when saving something new.',
].join(' ')

function field(args: unknown, key: string): unknown {
  return typeof args === 'object' && args !== null ? (args as Record<string, unknown>)[key] : undefined
}

/**
 * Who is writing, and which conversation it belongs to.
 *
 * Both are stored on every record and shown in Settings, so the user can tell
 * what the assistant decided on its own after the fact from what it saved while
 * they were watching — and can trace either back to the chat it came from.
 * @param sessionId - the calling agent's session id, when it has one.
 * @param reviewSessions - review forks mapped to the conversation they review.
 * @returns the `source` and the session id to store.
 */
function writerOf(
  sessionId: string | undefined,
  reviewSessions: ReadonlyMap<string, string>,
): { source: string, sessionId: string | undefined } {
  const reviewed = sessionId === undefined ? undefined : reviewSessions.get(sessionId)
  // A review's own fork id is useless to the user — they never saw that session.
  // Record the conversation it was reviewing instead.
  if (reviewed !== undefined) return { source: 'review', sessionId: reviewed }
  return { source: 'model', sessionId }
}

/**
 * Build the `remember` tool over a store.
 * @param store - the memory store.
 * @param reviewSessions - sessions owned by the background review pass.
 * @returns the tool definition, ready for `ctx.tools.register`.
 */
export function rememberTool(store: MemoryStore, reviewSessions: ReadonlyMap<string, string>): ToolDefinition {
  return {
    name: 'remember',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: TEXT_HINT },
        scope: { type: 'string', enum: ['global', 'project'], description: SCOPE_HINT },
        replaces: { type: 'string', description: REPLACES_HINT },
      },
      required: ['text', 'scope'],
      additionalProperties: false,
    },
    output: {
      schema: { description: 'Outcome of one memory write.' },
      render: (_args: unknown, value: unknown) => [
        { type: 'text', text: typeof value === 'string' ? value : 'Saved.' },
      ],
    },
    execute: async (args: unknown, exec: ToolRunContext): Promise<string> => {
      const rawText = field(args, 'text')
      if (typeof rawText !== 'string' || rawText.trim().length === 0) {
        throw new Error('The fact is empty. Pass the thing to remember as one sentence.')
      }
      const text = rawText.trim()
      if (text.length > MAX_FACT_LENGTH) {
        throw new Error(
          `That fact is ${String(text.length)} characters; keep it under ${String(MAX_FACT_LENGTH)}. `
          + 'Save the essential sentence, not the whole explanation.',
        )
      }

      const rawScope = field(args, 'scope')
      if (rawScope !== 'global' && rawScope !== 'project') {
        throw new Error('scope must be exactly "global" or "project".')
      }
      const scope: MemoryScope = rawScope

      // No silent fallback to the global layer: a project fact stored without a
      // path would match every session that has no working directory, which is
      // the quiet kind of wrong that surfaces weeks later.
      const cwd = exec.agent?.session.header.cwd
      if (scope === 'project' && projectKey(cwd) === undefined) {
        throw new Error(
          'This conversation has no project directory, so a project-scoped fact cannot be '
          + 'stored. Use scope "global" if the fact is true everywhere.',
        )
      }

      const visible = store.visible(cwd)
      const layer = visible.filter((fact) => fact.scope === scope)

      const rawReplaces = field(args, 'replaces')
      let replaces: string | undefined
      if (rawReplaces !== undefined && rawReplaces !== null && rawReplaces !== '') {
        if (typeof rawReplaces !== 'string' || !FACT_ID_RE.test(rawReplaces)) {
          throw new Error('replaces must be a 12-character fact id copied from the list.')
        }
        // Visibility, not mere existence: without this check one project's
        // conversation could reach into another project's facts.
        if (!visible.some((fact) => fact.id === rawReplaces)) {
          throw new Error(`No remembered fact carries the id "${rawReplaces}".`)
        }
        replaces = rawReplaces
      }

      if (replaces === undefined && layer.length >= MAX_FACTS_PER_LAYER) {
        throw new Error(
          `There are already ${String(MAX_FACTS_PER_LAYER)} remembered facts here. Supersede an `
          + 'outdated one with `replaces` instead of adding another.',
        )
      }

      const writer = writerOf(exec.agent?.session.id, reviewSessions)
      const outcome = await store.save({
        text,
        scope,
        projectPath: scope === 'project' ? cwd : undefined,
        source: writer.source,
        sessionId: writer.sessionId,
        replaces,
      })

      if (outcome.alreadyKnown) {
        return `Already remembered as [${outcome.fact.id}] — nothing saved.`
      }
      const where = scope === 'project' && cwd !== undefined
        ? ` for ${cwd}`
        : ' for this user'
      const superseded = replaces === undefined ? '' : `, replacing [${replaces}]`
      return `Saved as [${outcome.fact.id}]${where}${superseded}.`
    },
    // The web UI does not render the `generic` card kind specially, so this only
    // supplies the call's readable name. Kept for the same reason dock keeps it:
    // it matches upstream's contract and costs nothing.
    presentCall: () => ({ card: 'generic', title: 'Remember', kind: 'edit' }),
  } as ToolDefinition
}

const SKILL_DESCRIPTION = [
  'Propose a skill: a short written procedure for one class of task, so a future',
  'conversation starts already knowing how to do it. Reach for it after finishing',
  'something non-trivial that will recur, or when the user corrects how you went',
  'about a task. If a skill already covers that territory, pass its exact name to',
  'patch it rather than adding a near-duplicate. Proposals are NOT applied when',
  'you call this: they wait under Settings > Growth until the user approves them.',
].join(' ')

const SKILL_NAME_HINT = [
  'Kebab-case name, e.g. "release-checklist". Pass the name of an existing skill',
  'to replace it with your improved version; pass a new name to add one.',
].join(' ')

const SKILL_BODY_HINT = [
  'The procedure in markdown: when it applies, the steps in order, and the',
  'pitfalls worth naming. Write it for a future assistant with no memory of this',
  'conversation. Do not include frontmatter — it is added for you.',
].join(' ')

const SKILL_SCOPE_HINT = [
  'Use "global" for a procedure that holds anywhere. Use "project" when it only',
  'makes sense inside the directory this conversation is working in.',
].join(' ')

/**
 * Build the `propose_skill` tool over a store.
 * @param store - the proposal queue.
 * @param reviewSessions - sessions owned by the background review pass.
 * @returns the tool definition, ready for `ctx.tools.register`.
 */
export function proposeSkillTool(store: SkillStore, reviewSessions: ReadonlyMap<string, string>): ToolDefinition {
  return {
    name: 'propose_skill',
    description: SKILL_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: SKILL_NAME_HINT },
        description: {
          type: 'string',
          description: 'One line saying when this skill applies. It is how a future you decides to open it.',
        },
        body: { type: 'string', description: SKILL_BODY_HINT },
        scope: { type: 'string', enum: ['global', 'project'], description: SKILL_SCOPE_HINT },
      },
      required: ['name', 'description', 'body', 'scope'],
      additionalProperties: false,
    },
    output: {
      schema: { description: 'Outcome of one skill proposal.' },
      render: (_args: unknown, value: unknown) => [
        { type: 'text', text: typeof value === 'string' ? value : 'Proposed.' },
      ],
    },
    execute: async (args: unknown, exec: ToolRunContext): Promise<string> => {
      const name = field(args, 'name')
      if (typeof name !== 'string' || !SKILL_NAME_RE.test(name)) {
        throw new Error('name must be kebab-case: lowercase letters and digits, single hyphens between words.')
      }

      const description = field(args, 'description')
      if (typeof description !== 'string' || description.trim().length === 0) {
        throw new Error('description is required — one line saying when the skill applies.')
      }
      if (description.trim().length > 200) {
        throw new Error('description must stay under 200 characters; the detail belongs in the body.')
      }

      const body = field(args, 'body')
      if (typeof body !== 'string' || body.trim().length === 0) {
        throw new Error('body is required — the procedure itself.')
      }
      if (body.length > MAX_SKILL_BODY) {
        throw new Error(
          `That body is ${String(body.length)} characters; keep it under ${String(MAX_SKILL_BODY)}. `
          + 'Split a very large procedure into two skills.',
        )
      }

      const rawScope = field(args, 'scope')
      if (rawScope !== 'global' && rawScope !== 'project') {
        throw new Error('scope must be exactly "global" or "project".')
      }
      const scope: MemoryScope = rawScope

      const cwd = exec.agent?.session.header.cwd
      if (scope === 'project' && projectKey(cwd) === undefined) {
        throw new Error(
          'This conversation has no project directory, so a project-scoped skill cannot be '
          + 'stored. Use scope "global" if the procedure holds anywhere.',
        )
      }

      if (store.all().length >= MAX_PENDING_SKILLS) {
        throw new Error(
          `${String(MAX_PENDING_SKILLS)} proposals are already waiting for the user to review. `
          + 'Stop proposing until some are cleared.',
        )
      }

      const writer = writerOf(exec.agent?.session.id, reviewSessions)
      const pending = await store.propose({
        name,
        description,
        body,
        scope,
        projectPath: scope === 'project' ? cwd : undefined,
        source: writer.source,
        sessionId: writer.sessionId,
      })

      return (
        `Proposed "${pending.name}" as [${pending.id}]. It is NOT active yet — it waits under `
        + 'Settings > Growth until the user approves it.'
      )
    },
    presentCall: () => ({ card: 'generic', title: 'Propose skill', kind: 'edit' }),
  } as ToolDefinition
}

const PROFILE_DESCRIPTION = [
  'Record who this user is, or a standing rule about how you must behave with',
  'them, on the two pages read at the start of every conversation. This is the',
  'right tool whenever the user tells you something about THEMSELVES — their name,',
  'role, language, location, the platform they are on, how they want answers',
  'shaped — or hands you a rule to follow from now on. It is also the right tool',
  'when they say "remember this about me" or "add this to my profile". Lines are',
  'APPENDED under a heading of your own and dated; you can never rewrite what the',
  'user wrote themselves. Use `remember` instead for a fact about a project or a',
  'codebase rather than about the person.',
].join(' ')

const PROFILE_TARGET_HINT = [
  'Use "about_you" for the person — name, role, language, working habits. Use',
  '"assistant" for how you must behave — tone, shape of answers, hard limits.',
].join(' ')

const PROFILE_LINES_HINT = [
  'One to eight lines. Each is a single self-contained sentence in the third',
  'person that still makes sense months from now. Good: "Prefers short answers in',
  'Vietnamese." Bad: "said yes to the second one".',
].join(' ')

/** Longest single directive. Past this it stops being a line and becomes prose. */
const MAX_DIRECTIVE_LENGTH = 200

/** Most lines one call may add. */
const MAX_DIRECTIVES = 8

/**
 * Build the `update_profile` tool.
 *
 * The first successful call also ends first-run setup, whichever page it wrote:
 * the questions exist to fill these two files, so filling either one answers
 * them. A user who declines is recorded as having declined, which is itself a
 * durable fact and stops the asking just the same.
 * @returns the tool definition, ready for `ctx.tools.register`.
 */
export function updateProfileTool(): ToolDefinition {
  return {
    name: 'update_profile',
    description: PROFILE_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['about_you', 'assistant'], description: PROFILE_TARGET_HINT },
        lines: {
          type: 'array',
          items: { type: 'string' },
          description: PROFILE_LINES_HINT,
        },
      },
      required: ['target', 'lines'],
      additionalProperties: false,
    },
    output: {
      schema: { description: 'Outcome of one profile write.' },
      render: (_args: unknown, value: unknown) => [
        { type: 'text', text: typeof value === 'string' ? value : 'Saved.' },
      ],
    },
    execute: async (args: unknown): Promise<string> => {
      const rawTarget = field(args, 'target')
      if (rawTarget !== 'about_you' && rawTarget !== 'assistant') {
        throw new Error('target must be exactly "about_you" or "assistant".')
      }
      const kind: ProfileKind = rawTarget === 'about_you' ? 'user' : 'soul'

      const rawLines = field(args, 'lines')
      if (!Array.isArray(rawLines) || rawLines.length === 0) {
        throw new Error('lines must be a non-empty array of sentences.')
      }
      if (rawLines.length > MAX_DIRECTIVES) {
        throw new Error(`Pass at most ${String(MAX_DIRECTIVES)} lines in one call.`)
      }
      const lines: string[] = []
      for (const entry of rawLines as unknown[]) {
        if (typeof entry !== 'string' || entry.trim().length === 0) {
          throw new Error('Every line must be a non-empty string.')
        }
        const line = entry.trim()
        if (line.length > MAX_DIRECTIVE_LENGTH) {
          throw new Error(
            `One line is ${String(line.length)} characters; keep each under `
            + `${String(MAX_DIRECTIVE_LENGTH)}. Split it, or save the essential sentence only.`,
          )
        }
        lines.push(line)
      }

      // Throws when the page is full; the message tells the model to ask the user
      // to trim rather than silently dropping what it wanted to keep.
      const chars = appendDirectives(kind, lines)

      const closed = setupPending()
      completeOnboarding()

      const where = kind === 'user' ? 'About you' : 'Soul'
      const budget = `${String(chars)}/${String(profileLimit(kind))} characters used`
      const setup = closed ? ' First-run setup is complete.' : ''
      return `Added ${String(lines.length)} line(s) to ${where} (${budget}).${setup}`
    },
    presentCall: () => ({ card: 'generic', title: 'Update profile', kind: 'edit' }),
  } as ToolDefinition
}
