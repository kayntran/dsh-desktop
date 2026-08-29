/**
 * The pill that appears once a new version has finished downloading.
 *
 * **Level 1 — additive only.** `shell.overlay` is a `list` slot upstream leaves open
 * and describes in its own words as the seat for "a badge, a toast stack or a status
 * pill". Entries there order among themselves; the panel's own entry keeps its place.
 *
 * ## Why it waits for `ready`
 *
 * It says nothing while checking and nothing while downloading. Those are the app's
 * business, not the user's — there is no decision to make until the bytes are on
 * disk. Speaking earlier would mean interrupting to say "please wait".
 *
 * ## Why it can be dismissed and does not come back
 *
 * The update is already downloaded and will be applied the next time the app closes,
 * so nothing is lost by dismissing. Coming back on every poll would turn a piece of
 * good news into nagging.
 * @module
 */

import { useCallback, useState } from 'react'
import { Button, IconCloseOutline16, IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ask } from './api.ts'
import { useUpdateState } from './useUpdateState.ts'

/** The pill's props: the overlay layer supplies none. */
export type UpdatePillProps = PropsRuntime<'shell.overlay'>

/**
 * The ready-to-restart pill.
 * @param props - see {@link UpdatePillProps}.
 * @returns the pill, or nothing at all when there is no news.
 */
export function UpdatePill(_props: UpdatePillProps): React.JSX.Element | null {
  const state = useUpdateState()
  const [hidden, setHidden] = useState(false)

  const onInstall = useCallback(() => {
    void ask('install')
  }, [])

  const onDismiss = useCallback(() => {
    setHidden(true)
  }, [])

  if (state.phase !== 'ready' || hidden) return null

  return (
    <div className="hdw-upd-pill" role="status">
      <IconDownloadOutline16 />
      <span className="hdw-upd-pill-text">
        Version {state.next ?? ''} is ready
      </span>
      <Button variant="primary" size="sm" onClick={onInstall}>Restart now</Button>
      <button
        type="button"
        className="hdw-upd-pill-x"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <IconCloseOutline16 />
      </button>
    </div>
  )
}
