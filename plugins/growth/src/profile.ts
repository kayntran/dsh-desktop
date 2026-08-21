/**
 * The two hand-written pages: SOUL.md (how the assistant should behave) and
 * USER.md (who the user is). One module because they are the same machine with
 * different budgets — splitting them would duplicate the comment stripping, the
 * mtime cache and the cap logic, and the duplicates would drift.
 *
 * Both are contributed through `systemPrompt.section()` — the cached request
 * header — because they are stable across a session. That is the opposite choice
 * from memory-context.ts, and for the opposite reason: a section stays inside the
 * cached prefix precisely while it does not change.
 *
 * Global only, by decision. Tone and identity do not vary per directory; the
 * thing that does is facts, and Memory already carries a project layer for those.
 * @module
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { growthDir, soulPath, userPath } from './paths.ts'
import { neutralize } from './interpolation.ts'

/** Which of the two pages. */
export type ProfileKind = 'soul' | 'user'

/**
 * Heading the assistant appends under. Everything above it is the user's own
 * writing and is never rewritten — the assistant may only add below this line.
 */
export const ASSISTANT_HEADING = '## Notes from the assistant'

/**
 * Templates are written once, on first launch, so both files exist and can be
 * opened from Settings straight away. Everything in them is an HTML comment, and
 * comments are stripped before the model sees anything — so the prompt stays
 * untouched until the user actually writes a line of their own.
 *
 * Nothing inside a comment block may contain the closing marker. HTML comments do
 * not nest: the first closing marker ends the block, and everything after it
 * leaks into the prompt as text. An earlier version of the soul template
 * explained the comment syntax by quoting it, and that one sentence put a line of
 * stray text in front of the model on every conversation.
 */
const SOUL_TEMPLATE = `<!-- How you want the assistant to behave.

Read at the start of every conversation, in every project. Plain sentences, as if
briefing a new colleague. Notes like this one are invisible to the assistant. -->

## Tone

<!-- e.g. Be blunt. No preamble, no "Great question!". -->

## How to answer

<!-- e.g. Code first, explanation after. Keep it under five sentences unless I ask for more. -->

## Hard limits

<!-- e.g. Never touch anything under engine/. Ask before doing something I cannot undo. -->
`

const USER_TEMPLATE = `<!-- Who you are.

Read at the start of every conversation, in every project. Keep it to durable
facts — a name, a role, tools you live in, how you like to be talked to. Notes
like this one are invisible to the assistant. -->

## About me

<!-- e.g. Kayn. I do SEO. Vietnamese is my first language. -->

## How I work

<!-- e.g. I do not read code. Explain in terms of what I would see on screen. -->
`

/** Everything one kind needs, in one place. */
interface Spec {
  readonly path: () => string
  readonly template: string
  /** Largest effective text handed to the model, in characters. */
  readonly limit: number
  /** File name, for the UI and for prompt framing. */
  readonly file: string
  /** Heading the section is framed with. */
  readonly heading: string
}

const SPECS: Record<ProfileKind, Spec> = {
  soul: {
    path: soulPath,
    template: SOUL_TEMPLATE,
    limit: 8000,
    file: 'SOUL.md',
    heading: '# How this user wants you to work',
  },
  user: {
    path: userPath,
    template: USER_TEMPLATE,
    // Lower than the soul budget on purpose. A profile that needs more than this
    // has stopped being a profile and started being a diary, and every character
    // is paid for on every request of every conversation.
    limit: 3000,
    file: 'USER.md',
    heading: '# Who you are working with',
  },
}

/** The budget for one kind, in characters. */
export function profileLimit(kind: ProfileKind): number {
  return SPECS[kind].limit
}

/** The file name for one kind. */
export function profileFile(kind: ProfileKind): string {
  return SPECS[kind].file
}

/** What the plugin currently knows about one file on disk. */
export interface ProfileState {
  readonly kind: ProfileKind
  readonly path: string
  readonly exists: boolean
  /** Characters on disk, the number the editor's counter shows. */
  readonly chars: number
  /** The budget, so the page never has to hard-code it. */
  readonly limit: number
  /** Epoch milliseconds of the last write, or 0 when the file is absent. */
  readonly modifiedAt: number
  /** Raw file contents, for the in-page editor. */
  readonly rawText: string
  /** Exactly what the model gets — comments stripped, neutralized, capped. */
  readonly effectiveText: string
  /** True when the file was longer than the cap and had to be cut. */
  readonly truncated: boolean
}

function empty(kind: ProfileKind, path: string): ProfileState {
  return {
    kind,
    path,
    exists: false,
    chars: 0,
    limit: SPECS[kind].limit,
    modifiedAt: 0,
    rawText: '',
    effectiveText: '',
    truncated: false,
  }
}

/**
 * Create a file with its template when it is not there yet.
 * @param kind - which page.
 * @returns true when a file was written by this call.
 */
export function ensureProfileFile(kind: ProfileKind): boolean {
  const path = SPECS[kind].path()
  try {
    statSync(path)
    return false
  } catch {
    mkdirSync(growthDir(), { recursive: true })
    writeFileSync(path, normalizeEndings(SPECS[kind].template), 'utf8')
    return true
  }
}

/**
 * Strip the dates off the assistant's own lines before the model sees them.
 *
 * The date is for the USER: it is how someone scanning this page spots a line
 * that has gone stale. The model gains nothing from it — it has no way to act on
 * "this was written in August" — so shipping it on every request of every
 * conversation is paying for a column nobody reads. Upstream of us, OpenClaw dates
 * its daily log FILES and leaves profile lines undated, which is the same call.
 *
 * The date stays on disk. Only the prompt copy loses it.
 */
function stripDates(text: string): string {
  return text.replace(/^(\s*[-*+]\s*)\d{4}-\d{2}-\d{2}\s*[—–-]\s*/gm, '$1')
}

/**
 * One line ending, everywhere: LF.
 *
 * The templates are written from source files that Windows checks out with CRLF,
 * so the files started life with a carriage return on every line. Each one is an
 * invisible character that counts against the budget and rides into the prompt —
 * and the browser's text box strips them silently, so the counter on screen
 * disagreed with the counter on disk by exactly the number of lines.
 */
function normalizeEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** Drop HTML comments, collapse the blank lines they leave behind. */
function stripComments(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Whether what is left is only headings and whitespace — the untouched template.
 * A file in that state must contribute nothing rather than a skeleton of empty
 * sections the model would try to honour.
 */
/**
 * Drop headings with nothing under them.
 *
 * Once the assistant appends its first line the file is no longer "only
 * headings", so the untouched template headings above would ride along in every
 * request — six lines of pure noise the model has to read past, paid for on every
 * message forever.
 */
function dropEmptySections(text: string): string {
  const rows = text.split('\n')
  const kept: string[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? ''
    if (!row.trimStart().startsWith('#')) {
      kept.push(row)
      continue
    }
    // Look ahead for content before the next heading; a heading followed only by
    // blank lines and another heading is empty.
    let hasBody = false
    for (let ahead = index + 1; ahead < rows.length; ahead += 1) {
      const next = rows[ahead] ?? ''
      if (next.trim().length === 0) continue
      hasBody = !next.trimStart().startsWith('#')
      break
    }
    if (hasBody) kept.push(row)
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function isOnlyHeadings(text: string): boolean {
  return text
    .split('\n')
    .every((row) => row.trim().length === 0 || row.trimStart().startsWith('#'))
}

function cap(text: string, limit: number): { text: string, truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false }
  const rows = text.split('\n')
  const kept: string[] = []
  let used = 0
  for (const row of rows) {
    if (used + row.length + 1 > limit) break
    kept.push(row)
    used += row.length + 1
  }
  return { text: `${kept.join('\n')}\n…(truncated)`, truncated: true }
}

/**
 * Reads one file, caching by modification time.
 *
 * The prompt provider is synchronous and runs at every model step, so reading the
 * file each time would put a blocking read on the hot path. A `stat` is cheap
 * enough to do per step, and comparing mtime plus size means an edit takes effect
 * on the very next turn with no restart — while comment-stripping and capping
 * happen once per edit rather than once per step.
 * @param kind - which page.
 * @returns a reader with a single `read` verb.
 */
export function createProfileReader(kind: ProfileKind): { read: () => ProfileState } {
  const spec = SPECS[kind]
  let cached: ProfileState = empty(kind, '')
  let stamp = ''

  return {
    read(): ProfileState {
      const path = spec.path()
      try {
        const info = statSync(path)
        const next = `${info.mtimeMs}:${info.size}`
        if (next === stamp && cached.path === path) return cached

        const raw = normalizeEndings(readFileSync(path, 'utf8'))
        const stripped = stripComments(raw)
        const body = isOnlyHeadings(stripped) ? '' : dropEmptySections(stripped)
        const { text, truncated } = cap(neutralize(stripDates(body)), spec.limit)

        cached = {
          kind,
          path,
          exists: true,
          chars: raw.length,
          limit: spec.limit,
          modifiedAt: info.mtimeMs,
          rawText: raw,
          effectiveText: text,
          truncated,
        }
        stamp = next
        return cached
      } catch {
        // A read failure — file removed mid-edit, a lock, a permission change —
        // returns the last good value. Throwing from a prompt provider fails the
        // whole turn, which is a far worse outcome than a slightly stale page.
        if (cached.path.length > 0) return cached
        return empty(kind, path)
      }
    },
  }
}

/**
 * The text contributed to the system prompt.
 * @param state - the current file state.
 * @returns the framed section, or an empty string when there is nothing to say.
 */
export function renderProfile(state: ProfileState): string {
  if (state.effectiveText.length === 0) return ''
  return `${SPECS[state.kind].heading}\n\n${state.effectiveText}`
}

/**
 * Replace a file wholesale — the in-page editor's write.
 *
 * Only the user reaches this. What they typed is what lands on disk, including
 * their invisible notes, because the editor shows them the raw file.
 * @param kind - which page.
 * @param text - the complete new contents.
 * @throws when the text is over budget.
 */
export function saveProfile(kind: ProfileKind, text: string): void {
  const spec = SPECS[kind]
  if (text.length > spec.limit) {
    throw new Error(`${spec.file} is limited to ${String(spec.limit)} characters.`)
  }
  mkdirSync(growthDir(), { recursive: true })
  writeFileSync(spec.path(), normalizeEndings(text), 'utf8')
}

/**
 * Strip the decoration a model copies from the lines already in the file.
 *
 * It reads the page before writing to it, sees `- 2026-08-18 — …`, and helpfully
 * writes that shape back. The bullet and the date are added here, so without this
 * the file fills with `- 2026-08-18 — 2026-08-18 — …`. Observed on the first live
 * run, not hypothetical.
 */
function undecorate(line: string): string {
  return line
    .replace(/^\s*[-*+]\s*/, '')
    .replace(/^\s*\d{4}-\d{2}-\d{2}\s*[—–-]\s*/, '')
    .trim()
}

/**
 * Put new lines at the END of the assistant's own section, not at the end of the
 * file.
 *
 * The two are only the same until the user writes a heading of their own below
 * it — and then every later line the assistant adds lands under the user's
 * heading, which reads as though the user wrote it. Seen on the first live run,
 * where an edit made in the Settings page pushed the assistant's section up.
 * @param current - the file as it stands.
 * @param added - the already-formatted lines.
 * @returns the new file contents.
 */
function insertUnderHeading(current: string, added: string): string {
  const rows = current.replace(/\s+$/, '').split('\n')
  const start = rows.findIndex((row) => row.trim() === ASSISTANT_HEADING)
  if (start === -1) return `${rows.join('\n')}\n\n${ASSISTANT_HEADING}\n${added}\n`

  // The section runs until the next heading of any level, or the end of the file.
  let end = rows.length
  for (let index = start + 1; index < rows.length; index += 1) {
    if ((rows[index] ?? '').trimStart().startsWith('#')) {
      end = index
      break
    }
  }
  // Trailing blank lines inside the section belong after the insertion, not
  // before it, or each write opens a wider gap than the last.
  let tail = end
  while (tail > start + 1 && (rows[tail - 1] ?? '').trim().length === 0) tail -= 1

  const next = [...rows.slice(0, tail), ...added.split('\n'), ...rows.slice(tail)]
  return `${next.join('\n')}\n`
}

/** Local calendar date, the form the appended lines carry. */
function today(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Append dated lines under the assistant's own heading — the model's only write.
 *
 * Append, never replace: the top of the file is the user's writing, and a model
 * that can rewrite the page can quietly delete the very limits it was told to
 * obey. Dating each line is what makes a stale one visible later.
 * @param kind - which page.
 * @param lines - the directives to add, already trimmed.
 * @returns the number of characters the file now holds.
 * @throws when the additions would push the file over budget.
 */
export function appendDirectives(kind: ProfileKind, lines: readonly string[]): number {
  const spec = SPECS[kind]
  let current = ''
  try {
    current = normalizeEndings(readFileSync(spec.path(), 'utf8'))
  } catch {
    current = normalizeEndings(spec.template)
  }

  const stamp = today()
  const added = lines
    .map((line) => undecorate(line))
    .filter((line) => line.length > 0)
    .map((line) => `- ${stamp} — ${neutralize(line)}`)
    .join('\n')
  if (added.length === 0) throw new Error('Every line was empty once its bullet and date were removed.')
  const next = insertUnderHeading(current, added)

  if (next.length > spec.limit) {
    throw new Error(
      `${spec.file} is full (${String(spec.limit)} characters). Ask the user to trim it in `
      + 'Settings > Growth before saving anything else there.',
    )
  }

  mkdirSync(growthDir(), { recursive: true })
  writeFileSync(spec.path(), next, 'utf8')
  return next.length
}
