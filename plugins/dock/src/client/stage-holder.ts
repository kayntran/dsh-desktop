/**
 * The holder for the webview stage — the one place the bridge and the panel meet.
 *
 * ## Why it has to be a holder rather than a reference
 *
 * The bridge opens inside `apply()`, which is **before** the panel is built:
 * upstream's slots only mount a component once the UI gets around to rendering it. So
 * at the moment `openBridge()` is called, no stage exists to pass in.
 *
 * Worse: a slot may **rebuild** a component at any time. Every rebuild is a new stage,
 * and the old one is `destroy()`ed. If the bridge held a hard reference, from that
 * second on it would be holding a dead stage — no error reported, just every agent
 * command starting to fail silently.
 *
 * One mutable holder solves both: the bridge holds the holder, the panel writes into it
 * on mount and clears it on unmount, and the bridge always reads out whatever is
 * genuinely alive.
 *
 * ## Why an empty holder gets its own error message
 *
 * An empty holder is a **normal** state, not a failure: the user has not opened the
 * Browser panel yet. The agent needs to tell it apart from "the stage is broken",
 * because the responses differ completely — the first just needs a tab opened, the
 * second is a bug.
 * @module
 */

import type { Stage } from './browser-stage.ts'

/** The holder for the live stage, if there is one. */
export interface StageHolder {
  /** The live stage, or `undefined` while the panel has not mounted. */
  current: Stage | undefined
  /**
   * Get the stage, or throw a sentence a reader can act on.
   * @returns the live stage.
   * @throws when the panel has never been built.
   */
  require: () => Stage
}

/**
 * Create an empty holder.
 *
 * Called inside `apply()` rather than at module level: a module-level holder is a
 * singleton in disguise, and it would carry the previous plugin load's stage into the
 * new one.
 * @returns the holder.
 */
export function createStageHolder(): StageHolder {
  const holder: StageHolder = {
    current: undefined,
    require: () => {
      if (holder.current === undefined) {
        throw new Error(
          'No browser panel has been built in the app window yet. '
          + 'Open the right-hand panel (the button at the top of the session) and try again.',
        )
      }
      return holder.current
    },
  }
  return holder
}
