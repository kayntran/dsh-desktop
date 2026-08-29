/**
 * The update row in Settings › General.
 *
 * **Level 1 — additive only.** `settings.general.item` is a `list` slot, and upstream
 * describes it as "the additive seat for a single setting that needs no page of its
 * own". Upstream's own rows (Language, Appearance, composer Enter) stay exactly where
 * they were; this one joins them.
 *
 * The row draws its own internals including its label — upstream says so plainly in
 * the slot declaration, and passes no props at all.
 * @module
 */

import { useCallback, useState } from 'react'
import { Button, IconLoadingOutline16, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ask } from './api.ts'
import { useUpdateState } from './useUpdateState.ts'
import type { UpdateState } from '../state.ts'

/** The row's props: the slot supplies none, so this is the framework kit alone. */
export type UpdateRowProps = PropsRuntime<'settings.general.item'>

/**
 * The sentence under the title.
 *
 * One line, like every other row on this page. It states where things stand in the
 * words the user would use, never a phase name.
 * @param state - what the shell last reported.
 * @returns the sentence to show.
 */
function describe(state: UpdateState): string {
  switch (state.phase) {
    case 'checking':
      return 'Looking for a newer version…'
    case 'current':
      return 'This is the newest version.'
    case 'downloading':
      return state.percent === undefined
        ? `Downloading version ${state.next ?? ''}…`
        : `Downloading version ${state.next ?? ''} — ${String(state.percent)}%`
    case 'ready':
      return `Version ${state.next ?? ''} is ready. Restart to finish.`
    case 'error':
      return state.reason ?? 'The last check did not go through.'
    case 'unsupported':
      // Saying this out loud is the entire reason the phase exists: a build that
      // cannot replace itself would otherwise read as "you are up to date"
      // through every release. The shell names WHICH case it is — a portable
      // build, or a run from source — because the two want different answers.
      return state.reason ?? 'This build cannot update itself.'
    default:
      return 'Updates are downloaded automatically; you choose when to restart.'
  }
}

/**
 * The row.
 * @param props - see {@link UpdateRowProps}.
 * @returns the settings row.
 */
export function UpdateRow(_props: UpdateRowProps): React.JSX.Element {
  const state = useUpdateState()
  // Local, because the answer the poll brings back can lag a second behind the
  // click and the button would otherwise look dead in the meantime.
  const [asked, setAsked] = useState(false)

  const onCheck = useCallback(() => {
    setAsked(true)
    void ask('check').finally(() => {
      // Long enough that the spinner is seen, short enough that a failed ask does
      // not leave the button stuck.
      setTimeout(() => { setAsked(false) }, 1500)
    })
  }, [])

  const onInstall = useCallback(() => {
    void ask('install')
  }, [])

  const busy = asked || state.phase === 'checking' || state.phase === 'downloading'

  return (
    <div className="hdw-upd-row">
      <div className="hdw-upd-text">
        <div className="hdw-upd-title">
          Harness Desktop{state.current === '' ? '' : ` ${state.current}`}
        </div>
        <div className="hdw-upd-desc">{describe(state)}</div>
      </div>
      {state.phase === 'ready'
        ? <Button variant="primary" onClick={onInstall}>Restart and update</Button>
        : state.phase === 'unsupported' && state.downloadPage !== undefined
          ? <Button variant="outline" onClick={() => { window.open(state.downloadPage, '_blank', 'noopener') }}>Open downloads</Button>
          : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={onCheck}
                // `icon` rather than a child: the component reserves a 16px leading
                // seat for exactly this, with the spacing already right.
                icon={busy ? <IconLoadingOutline16 /> : <IconRefreshOutline16 />}
              >
                Check for updates
              </Button>
            )}
    </div>
  )
}
