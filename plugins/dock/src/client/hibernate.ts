/**
 * Putting idle web pages to sleep, the way Chrome's memory saver does.
 *
 * ## Why this exists at all
 *
 * Each chat keeps its own strip of panes, and every open web page is a whole Chromium
 * renderer process. Left alone, a day of work across a dozen chats ends with a dozen
 * pages nobody has looked at since the morning, all still resident. Sleeping one closes
 * its `<webview>` while the pill stays in the strip; showing the pill again builds the
 * page back from its address.
 *
 * ## What sleeping costs, and what it does not
 *
 * The pages share one on-disk partition (`persist:hdw-browser`), so a woken page is
 * **still signed in** — the expensive thing survives. What does not survive is the scroll
 * position and anything the page was holding in memory, including text typed into it and
 * never submitted.
 *
 * That last one is why the two exemptions below exist, and they are the same two Chrome
 * uses: a page **making a sound** is being used even though nobody has touched it, and a
 * page holding **typed-in text** would lose that text. Chrome exempts more than this
 * (screen shares, USB devices, downloads in flight); those cannot arise inside this panel
 * or cannot be observed from here, so claiming to check them would be a lie in a comment.
 *
 * ## Terminals are never slept
 *
 * There is no such thing as sleeping a shell. Closing a terminal's socket kills the
 * process it is running, and losing a half-finished build to save memory is a far worse
 * trade than any amount of memory. Only `kind: 'browser'` panes are considered here.
 * @module
 */

import type { Stage } from './browser-stage.ts'
import type { DockState, Pane } from './store.ts'

/** How often the sweep runs. A minute is far finer than any timer the user can choose. */
export const SWEEP_INTERVAL_MS = 60_000

/**
 * How long to wait for a page to answer the "are you holding typed-in text?" question.
 *
 * A page that cannot answer within this is wedged or busy, and it is left awake — see
 * `holdsTypedText`.
 */
const ASK_TIMEOUT_MS = 2000

/**
 * Asked inside the guest page: is there anything typed in that would be lost?
 *
 * Deliberately blunt. It compares each field against the value the document was **served**
 * with, so text the user typed counts and text the site rendered does not. A rich-text
 * region cannot be compared that way, so any non-empty one counts as occupied — the
 * mistake it can make is leaving a page awake that could have slept, which costs memory,
 * rather than closing a page over someone's half-written message, which costs their work.
 *
 * It cannot see inside a cross-origin frame. Nothing running in the host page can, and
 * pretending otherwise would be the kind of silent gap this project's rules exist to
 * catch.
 */
const TYPED_TEXT_SCRIPT = `(() => {
  for (const el of document.querySelectorAll('input, textarea')) {
    if (el.type === 'button' || el.type === 'submit' || el.type === 'reset') continue
    if (el.type === 'checkbox' || el.type === 'radio') {
      if (el.checked !== el.defaultChecked) return true
      continue
    }
    if (el.value !== el.defaultValue) return true
  }
  for (const el of document.querySelectorAll('[contenteditable=""], [contenteditable="true"]')) {
    if ((el.textContent ?? '').trim() !== '') return true
  }
  return false
})()`

/**
 * Ask a page whether it is holding text the user typed.
 *
 * Errors and timeouts both answer **true**, and that direction is chosen on purpose: an
 * unreachable page might be holding a half-written message, and the only cost of guessing
 * wrong is that one page stays awake until the next sweep tries again.
 */
async function holdsTypedText(stage: Stage, id: string): Promise<boolean> {
  const answer = stage.evaluate(id, TYPED_TEXT_SCRIPT)
  const timeout = new Promise<'timeout'>((resolve) => { setTimeout(() => { resolve('timeout') }, ASK_TIMEOUT_MS) })
  try {
    const result = await Promise.race([answer, timeout])
    return result !== false
  } catch {
    return true
  }
}

/** Every browser pane in the window, whichever chat it belongs to. */
function browserPanes(state: DockState): Pane[] {
  return Object.values(state.byChat).flatMap((chat) => chat.panes.filter((p) => p.kind === 'browser'))
}

/**
 * One pass of the sleep timer.
 *
 * @param stage - the webview stage, where a sleeping page's tag is actually closed.
 * @param state - the panel state as it stands right now.
 * @param visiblePaneId - the pane on screen this instant, which is never a candidate.
 * @param onSleep - called for each pane that should now be marked asleep.
 */
export async function sweepIdlePages(
  stage: Stage,
  state: DockState,
  visiblePaneId: string | undefined,
  onSleep: (id: string) => void,
): Promise<void> {
  const minutes = state.sleepAfterMinutes
  if (minutes <= 0) return
  const deadline = Date.now() - minutes * 60_000

  for (const pane of browserPanes(state)) {
    if (pane.id === visiblePaneId) continue
    if (pane.asleep === true) continue
    // A tab with no address has nothing to rebuild itself from, so sleeping it would not
    // free a page — it would erase one.
    if (pane.url === undefined || pane.url === '') continue
    if (!stage.has(pane.id)) continue
    if ((pane.lastSeen ?? 0) > deadline) continue
    if (stage.isAudible(pane.id)) continue
    if (await holdsTypedText(stage, pane.id)) continue

    stage.remove(pane.id)
    onSleep(pane.id)
  }
}
