/**
 * Proposed skills: the queue, and what happens when the user approves one.
 *
 * The model never writes a skill file. It proposes, the proposal sits in a queue,
 * and only an explicit approval puts a file on disk. That asymmetry with Memory
 * is deliberate and was the project owner's decision: a wrong fact is one wrong
 * sentence, while a wrong skill is a standing instruction the assistant follows
 * on every task of that kind.
 *
 * Approval writes into the engine's OWN skill roots — `<dshHome>/skills` for a
 * global skill, `<project>/.dsh/skills` for a project one. Those roots are
 * already discovered and file-watched by the engine, so an approved skill is
 * usable in the next message with no restart and no discovery code here.
 * @module
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { MemoryScope, PendingSkill } from './memory-domain.ts'
import { projectSkillsDir, userSkillsDir } from './paths.ts'

/** Longest instruction body accepted from the model, in characters. */
export const MAX_SKILL_BODY = 12000

/** How many proposals may wait at once before the model is told to stop. */
export const MAX_PENDING_SKILLS = 30

function newId(): string {
  let out = ''
  while (out.length < 12) {
    out += [...randomBytes(9)].map((byte) => byte.toString(36)).join('')
  }
  return out.slice(0, 12)
}

/** Where an approved skill of this proposal would land. */
export function skillTarget(pending: PendingSkill): string {
  const root = pending.scope === 'project' && pending.projectPath !== undefined
    ? projectSkillsDir(pending.projectPath)
    : userSkillsDir()
  return join(root, pending.name, 'SKILL.md')
}

/**
 * The existing skill body at a proposal's target, when there is one.
 *
 * Drives the "this replaces an existing skill" warning in the UI, and it is the
 * only reason the user can tell an addition from an overwrite before approving.
 * @param pending - the proposal.
 * @returns the current file contents, or undefined when nothing is there.
 */
export function currentSkillText(pending: PendingSkill): string | undefined {
  const path = skillTarget(pending)
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined
  } catch {
    return undefined
  }
}

/**
 * Render one skill file.
 *
 * The frontmatter keys are exactly the two the engine's local provider requires;
 * a skill missing either is dropped from discovery with only a log line to say
 * so. Both are quoted because a description containing a colon would otherwise
 * break the YAML.
 * @param pending - the approved proposal.
 * @returns the complete file contents.
 */
export function renderSkillFile(pending: PendingSkill): string {
  const quote = (text: string): string => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return [
    '---',
    `name: ${quote(pending.name)}`,
    `description: ${quote(pending.description)}`,
    '---',
    '',
    pending.body.trim(),
    '',
  ].join('\n')
}

/** What a caller must supply to queue a proposal. */
export interface ProposeInput {
  readonly name: string
  readonly description: string
  readonly body: string
  readonly scope: MemoryScope
  readonly projectPath?: string | undefined
  readonly source: string
  readonly sessionId?: string | undefined
  readonly changeNote?: string | undefined
}

/** Operations over the proposal queue. */
export interface SkillStore {
  /** Every waiting proposal, as fresh copies, oldest first. */
  all(): PendingSkill[]
  /** Queue one proposal, replacing any earlier one for the same name and scope. */
  propose(input: ProposeInput): Promise<PendingSkill>
  /** Write the proposal to disk and drop it from the queue. */
  approve(id: string): Promise<{ written: string } | undefined>
  /** Drop the proposal without writing anything. */
  reject(id: string): Promise<boolean>
}

/**
 * Build the store over one open table.
 * @param table - the `pending_skills` table handle from the open domain.
 * @returns the typed operations; the table handle itself stays private.
 */
export function createSkillStore(table: KvTable<string, PendingSkill>): SkillStore {
  function all(): PendingSkill[] {
    return [...table.entries()]
      .map(([key, row]) => ({ ...row, id: key }))
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
  }

  return {
    all,

    async propose(input: ProposeInput): Promise<PendingSkill> {
      const pending: PendingSkill = {
        id: newId(),
        name: input.name,
        description: input.description.trim(),
        body: input.body.trim(),
        scope: input.scope,
        ...(input.scope === 'project' && input.projectPath !== undefined
          ? { projectPath: resolve(input.projectPath) }
          : {}),
        createdAt: Date.now(),
        source: input.source,
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        ...(input.changeNote !== undefined && input.changeNote.trim().length > 0
          ? { changeNote: input.changeNote.trim() }
          : {}),
      }

      // Twins are earlier proposals that would write the SAME file: same name,
      // same scope, same project. They are the ones this proposal replaces.
      const twins = all().filter((row) => (
        row.name === pending.name
        && row.scope === pending.scope
        && row.projectPath === pending.projectPath
      ))

      // Nothing changed since the last pass proposed this: return the existing
      // one untouched rather than churning its id and timestamp. A review that
      // re-derives the identical skill every conversation must not keep bumping
      // it to the top as if it were new work.
      const identical = twins.find((row) => (
        row.body === pending.body && row.description === pending.description
      ))
      if (identical !== undefined) return identical

      // A second, DIFFERENT proposal for the same file supersedes the first
      // rather than queueing beside it, so the user never has to work out which
      // of three drafts is newest.
      await table.put(pending.id, pending)
      for (const old of twins) await table.delete(old.id)
      return pending
    },

    async approve(id: string): Promise<{ written: string } | undefined> {
      const pending = table.get(id)
      if (pending === undefined) return undefined
      const path = skillTarget({ ...pending, id })
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, renderSkillFile({ ...pending, id }), 'utf8')
      await table.delete(id)
      return { written: path }
    },

    async reject(id: string): Promise<boolean> {
      return await table.delete(id)
    },
  }
}
