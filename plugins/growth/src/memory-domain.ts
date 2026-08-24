/**
 * The durable shape of one remembered fact, and the domain that holds them.
 *
 * Two deliberate departures from the obvious implementation, both load-bearing:
 *
 * 1. `defineDomain` is NOT imported. It is a runtime import from an engine
 *    package, and a plugin resolves modules from its own directory — the import
 *    fails with ERR_MODULE_NOT_FOUND and takes the whole engine down at startup.
 *    All `defineDomain` does is validate the name regex and the version integer,
 *    so the names below are simply written correctly and asserted once here.
 *
 * 2. The record validator is hand-written rather than zod, for the same
 *    module-resolution reason — and it NEVER THROWS. The domain layer runs
 *    `valueSchema.parse` over every stored record while opening; a throw becomes
 *    `invalid-record`, which fails the open, which fails `apply`, which kills the
 *    plugin at startup. One malformed line in a JSON file must not be able to do
 *    that, so the validator repairs instead of rejecting. Records it had to
 *    repair into an empty fact are filtered out on read and shown in Settings as
 *    deletable, so nothing vanishes silently either.
 * @module
 */

import type { ZodType } from 'zod'
import type { DomainSpec, DomainTableSpec } from '@deepseek-ai/dsh-storage-domain'

/** Which layer a fact belongs to. */
export type MemoryScope = 'global' | 'project'

/** One durable thing the assistant knows. */
export interface MemoryFact {
  /** Stable 12-character id, also the record key. Rendered to the model. */
  readonly id: string
  /** The fact itself, one self-contained sentence, already neutralized. */
  readonly text: string
  /** `global` follows the user everywhere; `project` is bound to one directory. */
  readonly scope: MemoryScope
  /** Absolute project directory; present only when `scope` is `project`. */
  readonly projectPath?: string
  /** Epoch milliseconds. Stored for ordering only — never rendered to the model. */
  readonly createdAt: number
  /** Who wrote it: `model` today, `review` once the background loop lands. */
  readonly source: string
  /** Which chat saved it. Diagnostics only; never rendered to the model. */
  readonly sessionId?: string
}

/** Ids are lowercase base36, fixed width, so the model can echo one back exactly. */
export const FACT_ID_RE = /^[a-z0-9]{12}$/

/** Skill names the engine's own discovery accepts: kebab-case, nothing else. */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** One proposed skill waiting for the user to approve or reject it. */
export interface PendingSkill {
  /** Stable 12-character id, also the record key. */
  readonly id: string
  /** Kebab-case skill name; the file on disk takes this name. */
  readonly name: string
  /** One-line routing description; the engine requires it in the frontmatter. */
  readonly description: string
  /** The instruction body, markdown, without frontmatter. */
  readonly body: string
  /** `global` writes to the user's skill directory; `project` writes into the repo. */
  readonly scope: MemoryScope
  /** Absolute project directory; present only when `scope` is `project`. */
  readonly projectPath?: string
  /** Epoch milliseconds. */
  readonly createdAt: number
  /** Who proposed it: `model` from a live conversation, `review` from the background pass. */
  readonly source: string
  /** Which chat proposed it. Diagnostics only. */
  readonly sessionId?: string
  /**
   * One plain sentence, in the user's own language, saying what this proposal
   * changes about the skill and why — shown to the user above the diff. Only for
   * a proposal that replaces an existing skill; a brand-new one has no "change".
   */
  readonly changeNote?: string
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Total, non-throwing coercion of one stored record.
 * @param raw - whatever the medium held under this key.
 * @returns a well-formed fact; fields that could not be read take safe defaults.
 */
function coerceFact(raw: unknown): MemoryFact {
  const row = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const scope: MemoryScope = row['scope'] === 'project' ? 'project' : 'global'
  const projectPath = asString(row['projectPath'])
  const sessionId = asString(row['sessionId'])
  const createdAt = typeof row['createdAt'] === 'number' && Number.isFinite(row['createdAt'])
    ? row['createdAt']
    : 0
  const source = asString(row['source'])
  return {
    id: asString(row['id']),
    text: asString(row['text']),
    scope,
    ...(scope === 'project' && projectPath.length > 0 ? { projectPath } : {}),
    createdAt,
    source: source.length > 0 ? source : 'unknown',
    ...(sessionId.length > 0 ? { sessionId } : {}),
  }
}

/**
 * Stands in for a zod schema at the one place the domain layer touches it.
 *
 * Checked against the engine: the table path calls `valueSchema.parse(raw)` and
 * nothing else. `safeParse` is reached only through `defineDomain`'s global-slot
 * check, and this domain declares no global.
 */
const factSchema = { parse: coerceFact } as unknown as ZodType<MemoryFact>

const factTable: DomainTableSpec<string, MemoryFact> = { valueSchema: factSchema }

/**
 * Same total, non-throwing contract as {@link coerceFact}. A proposal that comes
 * back unreadable is repaired into an obviously broken one the user can delete,
 * never into an exception that would fail the domain open.
 * @param raw - whatever the medium held under this key.
 * @returns a well-formed proposal.
 */
function coercePendingSkill(raw: unknown): PendingSkill {
  const row = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const scope: MemoryScope = row['scope'] === 'project' ? 'project' : 'global'
  const projectPath = asString(row['projectPath'])
  const sessionId = asString(row['sessionId'])
  const source = asString(row['source'])
  const changeNote = asString(row['changeNote'])
  const createdAt = typeof row['createdAt'] === 'number' && Number.isFinite(row['createdAt'])
    ? row['createdAt']
    : 0
  return {
    id: asString(row['id']),
    name: asString(row['name']),
    description: asString(row['description']),
    body: asString(row['body']),
    scope,
    ...(scope === 'project' && projectPath.length > 0 ? { projectPath } : {}),
    createdAt,
    source: source.length > 0 ? source : 'unknown',
    ...(sessionId.length > 0 ? { sessionId } : {}),
    ...(changeNote.length > 0 ? { changeNote } : {}),
  }
}

const pendingSkillSchema = { parse: coercePendingSkill } as unknown as ZodType<PendingSkill>

const pendingSkillTable: DomainTableSpec<string, PendingSkill> = { valueSchema: pendingSkillSchema }

/** Backend unit names accept lowercase letters, digits and underscores only. */
const UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/

/**
 * The one domain this plugin owns. Routed to whatever backend the profile made
 * default (the web profile says `json`), so no configuration change is needed.
 *
 * `pending_skills` was added after `facts` shipped, with no version bump and no
 * migration: the JSON backend reads a table missing from the file as an empty
 * map. That is why the version stays at 1 — bumping it would reject the medium
 * every existing user already has.
 */
export const growthDomainSpec = {
  name: 'harness_desktop_growth',
  version: 1,
  tables: { facts: factTable, pending_skills: pendingSkillTable },
} as const satisfies DomainSpec

// `defineDomain` normally does this at module load. Kept because a typo in a name
// would otherwise surface as an unreadable backend error much later.
for (const unit of [growthDomainSpec.name, ...Object.keys(growthDomainSpec.tables)]) {
  if (!UNIT_NAME_RE.test(unit)) {
    throw new Error(`growth: domain and table names must match ${String(UNIT_NAME_RE)}, got "${unit}"`)
  }
}
