/**
 * The only module allowed to touch the facts table.
 *
 * Records handed back by the domain layer ARE the stored objects — no defensive
 * copies — so mutating one in place corrupts memory without ever reaching the
 * medium. Rather than relying on everyone downstream remembering that, the table
 * handle never leaves this file: every read copies at the boundary, and every
 * write builds a fresh literal and calls `put`. No `update`, no field assignment.
 * @module
 */

import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { MemoryFact, MemoryScope } from './memory-domain.ts'
import { neutralize } from './interpolation.ts'

/** Longest fact accepted from the model, in characters. */
export const MAX_FACT_LENGTH = 500

/** Refusal threshold per visible layer. The model is told to supersede instead. */
export const MAX_FACTS_PER_LAYER = 200

/** What one save attempt did. */
export interface SaveOutcome {
  readonly fact: MemoryFact
  /** True when an identical fact already existed and nothing was written. */
  readonly alreadyKnown: boolean
}

/**
 * Canonical form of a project directory for comparison.
 *
 * Windows makes this load-bearing rather than tidy: `D:\proj`, `d:\proj\` and
 * `D:/proj` are one directory, and treating them as three makes a project's facts
 * appear to vanish with nothing reporting an error.
 * @param path - any absolute directory path.
 * @returns a comparable key, or undefined when there is no usable path.
 */
export function projectKey(path: string | undefined): string | undefined {
  if (path === undefined || path.trim().length === 0) return undefined
  const full = resolve(path).replace(/[\\/]+$/, '')
  return full.length === 0 ? undefined : full.toLowerCase()
}

/** Comparison form of a fact's text, so near-identical saves collapse. */
function textKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?;,]+$/, '')
}

function newId(): string {
  // 12 lowercase base36 characters. Short on purpose: the id is rendered into the
  // model's context on every fact line, and a uuid would cost 3x for nothing.
  let out = ''
  while (out.length < 12) {
    out += [...randomBytes(9)].map((byte) => byte.toString(36)).join('')
  }
  return out.slice(0, 12)
}

/** Typed operations over the facts table. */
export interface MemoryStore {
  /** Every stored fact, as fresh copies, ordered stably. */
  all(): MemoryFact[]
  /** Facts a session in `cwd` may see: the global layer plus that project's. */
  visible(cwd: string | undefined): MemoryFact[]
  /** Store one new fact, superseding another when asked. */
  save(input: SaveInput): Promise<SaveOutcome>
  /** Remove one fact. Resolves false when it was already gone. */
  remove(id: string): Promise<boolean>
  /** Remove every fact. Returns how many went. */
  clear(): Promise<number>
}

/** What a caller must supply to store a fact. */
export interface SaveInput {
  readonly text: string
  readonly scope: MemoryScope
  /** Required when scope is `project`; already canonical is not assumed. */
  readonly projectPath?: string | undefined
  readonly source: string
  readonly sessionId?: string | undefined
  /** Id of a fact this one replaces; removed after the new one is durable. */
  readonly replaces?: string | undefined
}

/**
 * Build the store over one open table.
 * @param table - the `facts` table handle from the open domain.
 * @returns the typed operations; the table handle itself stays private.
 */
export function createMemoryStore(table: KvTable<string, MemoryFact>): MemoryStore {
  /** A stable, time-independent order. Rendered text must never depend on a clock. */
  function ordered(facts: MemoryFact[]): MemoryFact[] {
    return facts.sort((left, right) => (
      left.createdAt - right.createdAt || left.id.localeCompare(right.id)
    ))
  }

  function all(): MemoryFact[] {
    // The spread is the copy that keeps stored objects unreachable from outside.
    return ordered([...table.entries()].map(([key, row]) => ({ ...row, id: key })))
  }

  function visible(cwd: string | undefined): MemoryFact[] {
    const here = projectKey(cwd)
    return all().filter((fact) => (
      fact.scope === 'global'
      || (here !== undefined && projectKey(fact.projectPath) === here)
    ))
  }

  return {
    all,
    visible,

    async save(input: SaveInput): Promise<SaveOutcome> {
      const text = neutralize(input.text.trim())
      const layerPath = input.scope === 'project' ? projectKey(input.projectPath) : undefined
      const layer = all().filter((fact) => (
        fact.scope === input.scope
        && (input.scope === 'global' || projectKey(fact.projectPath) === layerPath)
      ))

      const twin = layer.find((fact) => textKey(fact.text) === textKey(text))
      if (twin !== undefined) return { fact: twin, alreadyKnown: true }

      const fact: MemoryFact = {
        id: newId(),
        text,
        scope: input.scope,
        ...(input.scope === 'project' && input.projectPath !== undefined
          ? { projectPath: resolve(input.projectPath) }
          : {}),
        createdAt: Date.now(),
        source: input.source,
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      }

      // Write first, delete second. A crash between the two leaves a harmless
      // duplicate rather than a hole where the old fact used to be.
      await table.put(fact.id, fact)
      if (input.replaces !== undefined) await table.delete(input.replaces)
      return { fact, alreadyKnown: false }
    },

    async remove(id: string): Promise<boolean> {
      return await table.delete(id)
    },

    async clear(): Promise<number> {
      const keys = [...table.keys()]
      for (const key of keys) await table.delete(key)
      return keys.length
    },
  }
}
