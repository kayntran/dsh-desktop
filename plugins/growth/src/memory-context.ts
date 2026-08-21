/**
 * Renders remembered facts into the model's runtime context.
 *
 * Contributed through `systemPrompt.context()` rather than `.section()`, and that
 * is the whole design. A section lives in the cached request header, so a list
 * that changes mid-session would invalidate the prompt cache from the first
 * changed token on every write. A context is logged after retained history, and —
 * critically — emits NOTHING while its text is unchanged.
 *
 * That last property is a hard constraint on what may be rendered here: the text
 * must be a pure function of the stored facts. No dates, no counts derived from a
 * clock, no iteration order that depends on a hash. Break that and every model
 * step appends another near-identical snapshot to the transcript.
 * @module
 */

import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
// Pulls in the declaration merge that puts `agent` on AssembleContext. Without
// this line the field does not exist as far as the type system is concerned.
import type {} from '@deepseek-ai/dsh-agent'
import type { MemoryFact } from './memory-domain.ts'
import type { MemoryStore } from './memory-store.ts'
import { neutralize } from './interpolation.ts'

const HEADER = '## Remembered facts'

/**
 * Why the block renders even with zero facts: this paragraph is how the model
 * learns the `remember` tool is worth reaching for. Putting it here instead of in
 * its own prompt section keeps it out of the cached header, where it would cost
 * tokens on every request forever, and it costs exactly one emission while the
 * list stays empty.
 */
const GUIDANCE = [
  'Things saved in earlier conversations with this user. Treat them as true unless',
  'the user says otherwise. When one turns out to be wrong or out of date, call the',
  '`remember` tool again with `replaces` set to that fact\'s bracketed id rather than',
  'leaving a stale fact standing. When the user states a lasting preference, a',
  'standing instruction, or a project convention, save it the same way.',
].join('\n')

/**
 * The project directory of the session this assembly belongs to.
 *
 * Every field on the path is optional: a bare `assemble()` carries no agent at
 * all, and a session header may carry no cwd. Both cases mean "global layer
 * only" — never a guess at some other directory.
 * @param context - the assembly context.
 * @returns the session's working directory, or undefined.
 */
export function sessionCwd(context: AssembleContext): string | undefined {
  const cwd = context.agent?.session.header.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

function line(fact: MemoryFact): string {
  return `- [${fact.id}] ${fact.text}`
}

/**
 * Render one block of facts, grouped by layer.
 * @param facts - the facts visible to this session, already ordered.
 * @returns the model-facing text, always non-empty.
 */
export function renderFacts(facts: readonly MemoryFact[]): string {
  const usable = facts.filter((fact) => fact.text.trim().length > 0)
  const parts = [HEADER, '', GUIDANCE]

  const global = usable.filter((fact) => fact.scope === 'global')
  if (global.length > 0) {
    parts.push('', 'About the user, everywhere:', ...global.map(line))
  }

  // One heading per project path. Grouping keys come from the facts themselves in
  // their existing order, so the output stays a pure function of stored state.
  const seen = new Set<string>()
  for (const fact of usable) {
    if (fact.scope !== 'project') continue
    const path = fact.projectPath
    if (path === undefined || seen.has(path)) continue
    seen.add(path)
    const here = usable.filter((row) => row.projectPath === path)
    parts.push('', `About ${path}:`, ...here.map(line))
  }

  return parts.join('\n')
}

/**
 * Build the provider handed to `systemPrompt.context()`.
 * @param store - the memory store.
 * @returns a function evaluated at every assembly.
 */
export function memoryContextProvider(store: MemoryStore): (context: AssembleContext) => string {
  return (context: AssembleContext): string => {
    const facts = store.visible(sessionCwd(context))
    // Neutralized again on the way out, not only on the way in: a record written
    // before this guard existed, or hand-edited into the JSON file, would
    // otherwise throw at render and fail the turn.
    return neutralize(renderFacts(facts))
  }
}
