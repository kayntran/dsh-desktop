/**
 * One row in Settings > General: how long a background web page may sit idle before the
 * panel puts it to sleep.
 *
 * **Level 1 — additive only.** `settings.general.item` is a `list` slot, and upstream
 * plugs several rows into it (language, appearance, Enter-key behaviour). One more row
 * takes nobody's place.
 *
 * Built to the same shape as `AgentControlRow` next to it, which in turn follows
 * upstream's own settings row: text on the left, a `Menu` on the right. No hand-drawn
 * control anywhere.
 *
 * ## Why a fixed number and not Chrome's own rule
 *
 * Chrome decides when to sleep a tab by watching how much memory the machine has left, so
 * the same tab sleeps today and stays awake tomorrow. Copying that here would produce a
 * panel whose behaviour nobody could predict or check. A plain number the user can see
 * and change is duller and far easier to live with.
 * @module
 */

import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { SLEEP_CHOICES, type DockState } from './store.ts'

/** The data the plugin passes into this row. */
export interface SleepTimerRowInjected {
  hooks: { dock: SnapshotStore<DockState> }
  actions: { setSleepAfterMinutes: (minutes: number) => void }
}

/** The settings row's full props. */
export type SleepTimerRowProps =
  PropsRuntime<'settings.general.item'>
  & InjectFace<SleepTimerRowInjected>

/**
 * The label for one choice. `0` is the opt-out.
 *
 * Kept as short as upstream's own choosers — "English", "Queue", "On". An earlier
 * version read "After 30 minutes", and measured in the real Settings page that ran the
 * chooser 45px past the right edge of the row: every other row on the page ends flush,
 * and this one did not. Short labels are what the layout was built for.
 */
function labelFor(minutes: number): string {
  if (minutes === 0) return 'Never'
  if (minutes < 60) return `${String(minutes)} min`
  const hours = minutes / 60
  return hours === 1 ? '1 hour' : `${String(hours)} hours`
}

/**
 * The "put idle pages to sleep" row.
 * @param props - see {@link SleepTimerRowProps}.
 * @returns the settings row.
 */
export function SleepTimerRow({ useDock, actions }: SleepTimerRowProps): React.JSX.Element {
  const minutes = useDock((s) => s.sleepAfterMinutes)
  const [open, setOpen] = useState(false)

  return (
    <div className="hdw-setting">
      <div className="hdw-setting-text">
        <div className="hdw-setting-title">Put idle web pages to sleep</div>
        {/* One line, matching every other row on this page. The exemptions and what a
            woken page keeps are explained in `hibernate.ts`. */}
        <div className="hdw-setting-desc">
          An off-screen page closes to free memory and reopens, still signed in, when you select its tab.
        </div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={SLEEP_CHOICES.map((choice) => ({ id: String(choice), label: labelFor(choice) }))}
        selectedId={String(minutes)}
        onSelect={(id) => {
          setOpen(false)
          actions.setSleepAfterMinutes(Number(id))
        }}
        align="end"
        // `portal` for the same reason as the row above: the Settings page has a scrolling
        // region, and a menu anchored inside one gets clipped away.
        portal
        anchor={(
          <button
            type="button"
            className="hdw-setting-pick"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen((v) => !v) }}
          >
            {labelFor(minutes)}
            <IconChevronDownOutline14 />
          </button>
        )}
      />
    </div>
  )
}
