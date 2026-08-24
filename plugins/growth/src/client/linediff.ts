/**
 * A line-level diff between the skill on disk and the one proposed, shaped for
 * upstream's `DiffBlock`.
 *
 * `DiffBlock` colours a removed block red and an added block green, but it draws
 * whatever hunks it is handed in full — it does not compute the change itself. Fed
 * one hunk of {whole old, whole new} it would paint the entire old body red and
 * the entire new body green, which is the wall-of-text the user asked to be rid
 * of. So the diff is computed here: an LCS over lines, grouped into one hunk per
 * changed region, unchanged lines dropped. What reaches `DiffBlock` is only the
 * lines that actually differ, red and green, region by region.
 * @module
 */

import type { DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Split a side into content lines under the same terminator rule `DiffBlock`
 * uses: a single trailing newline is a terminator, not an extra empty line.
 */
function splitLines(text: string): string[] {
  if (text.length === 0) return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/** One edit-script step. */
interface Op {
  kind: 'equal' | 'remove' | 'add'
  line: string
}

/**
 * The edit script turning `a` into `b`, by lines, via a longest-common-subsequence
 * table. Bodies are capped at 12000 characters upstream, so the O(n·m) table is a
 * few hundred squared at worst.
 */
function editScript(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length
  const m = b.length
  // lcs[i][j] = length of the LCS of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j]
        ? (lcs[i + 1]![j + 1]! + 1)
        : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'equal', line: a[i]! })
      i += 1
      j += 1
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ kind: 'remove', line: a[i]! })
      i += 1
    } else {
      ops.push({ kind: 'add', line: b[j]! })
      j += 1
    }
  }
  while (i < n) { ops.push({ kind: 'remove', line: a[i]! }); i += 1 }
  while (j < m) { ops.push({ kind: 'add', line: b[j]! }); j += 1 }
  return ops
}

/**
 * Hunks for one skill's change: only the regions that differ.
 * @param path - the header each hunk carries (the skill's file path).
 * @param oldText - what is on disk now.
 * @param newText - what would be written.
 * @returns one hunk per changed region, empty when the two are identical.
 */
export function skillHunks(path: string, oldText: string, newText: string): DiffHunk[] {
  const ops = editScript(splitLines(oldText), splitLines(newText))
  const hunks: DiffHunk[] = []
  let removed: string[] = []
  let added: string[] = []

  const flush = (): void => {
    if (removed.length === 0 && added.length === 0) return
    hunks.push({
      path,
      oldText: removed.length > 0 ? `${removed.join('\n')}\n` : null,
      newText: added.length > 0 ? `${added.join('\n')}\n` : '',
    })
    removed = []
    added = []
  }

  for (const op of ops) {
    if (op.kind === 'equal') flush()
    else if (op.kind === 'remove') removed.push(op.line)
    else added.push(op.line)
  }
  flush()
  return hunks
}
