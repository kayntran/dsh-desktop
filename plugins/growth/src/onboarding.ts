/**
 * The first-run conversation.
 *
 * On the very first launch a `START.md` is written next to the two profile pages.
 * While it exists, its text rides in the system prompt and the assistant opens
 * the first conversation by asking who it is working with. The moment a profile
 * is saved, the file is deleted and the questions never come back.
 *
 * The file's existence IS the "not set up yet" flag. No counter, no stored
 * boolean, nothing that can disagree with what is on disk — and a user who wants
 * the questions again only has to put the file back.
 * @module
 */

import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { growthDir, startPath } from './paths.ts'

/**
 * Written once, on first launch. Readable on its own — someone who opens it
 * should understand what it is and be able to delete it themselves.
 */
const TEMPLATE = `# First-run setup

This file exists because the assistant has not met you yet. It disappears by
itself once your profile is saved.

## What to do, on the first message of the first conversation

Before anything else, greet the user once and ask these four questions together,
in a single short message. Do not ask them one at a time — they may have opened
the app to get work done.

1. What should I call you?
2. What kind of work do you do?
3. How do you like answers — short and direct, or long with examples? Which
   language?
4. Anything I should never do?

Say plainly that the answers are saved to two files they can read and edit under
Settings > Growth, and that they can skip.

## What to do with the answers

Call \`update_profile\` once for each page that has anything to record:

- Answers 1 to 3 describe the person: \`target: "about_you"\`.
- Answer 4 describes how you must behave: \`target: "assistant"\`.

Write each answer as one durable sentence in the third person, the way it should
read months from now. If the user skips, record a single line saying they
declined, so this never gets asked again.

Then carry on with whatever they actually wanted. Do not mention this file again.
`

/**
 * Write the first-run script.
 *
 * Called only when the growth directory did not exist before this launch, so it
 * cannot resurrect itself after a completed setup.
 */
export function writeStartFile(): void {
  mkdirSync(growthDir(), { recursive: true })
  writeFileSync(startPath(), TEMPLATE, 'utf8')
}

/** Whether the first-run script is still waiting. */
export function setupPending(): boolean {
  try {
    statSync(startPath())
    return true
  } catch {
    return false
  }
}

/**
 * The text contributed to the system prompt while setup is pending.
 *
 * Read from the constant rather than from disk: this runs at every model step,
 * and the file is ours, never edited between launches by anything that matters.
 * @returns the framed section, or an empty string once setup is done.
 */
export function renderOnboarding(): string {
  if (!setupPending()) return ''
  return TEMPLATE
}

/**
 * End setup by removing the script.
 *
 * Idempotent: called from a tool the model may invoke more than once, and a
 * second call must not be an error.
 */
export function completeOnboarding(): void {
  rmSync(startPath(), { force: true })
}
