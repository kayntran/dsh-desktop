/**
 * The row of tabs across the top of the Growth page.
 *
 * Deliberately NOT built from the `Button` primitive: upstream's own settings
 * tabs — the ones on the Plugins page — are plain buttons with an underline, and
 * a filled pill next to them reads as a different app. This mirrors their markup
 * and their CSS (`PluginsSettingsSection.module.css`), variable for variable, so
 * the two strips are indistinguishable.
 *
 * Their keyboard contract comes along with the look, because that is the part a
 * hand-rolled tab strip usually drops: arrows move and focus follows, Home and
 * End jump to the ends, and only the selected tab sits in the tab order.
 *
 * Re-check against that upstream file after an engine upgrade.
 * @module
 */

import { useId, useRef } from 'react'

/** One tab: its key, its label, and an optional count shown beside it. */
export interface TabSpec {
  id: string
  label: string
  /** Rendered beside the label when above zero — the queue that wants attention. */
  badge?: number
}

/**
 * The tab row.
 * @param props - the tabs, the selected id, and the selection callback.
 * @returns the tablist element.
 */
export function TabStrip({ tabs, active, onSelect }: {
  tabs: readonly TabSpec[]
  active: string
  onSelect: (id: string) => void
}): React.JSX.Element {
  const stripId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  return (
    <div className="hdw-gr-tabs" role="tablist" aria-label="Growth">
      {tabs.map((tab, index) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            ref={(element) => { refs.current[index] = element }}
            id={`${stripId}-tab-${tab.id}`}
            type="button"
            role="tab"
            className="hdw-gr-tab"
            aria-selected={selected}
            data-active={selected ? 'true' : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => { onSelect(tab.id) }}
            onKeyDown={(event: React.KeyboardEvent) => {
              let next: number
              switch (event.key) {
                case 'ArrowRight': next = (index + 1) % tabs.length; break
                case 'ArrowLeft': next = (index - 1 + tabs.length) % tabs.length; break
                case 'Home': next = 0; break
                case 'End': next = tabs.length - 1; break
                default: return
              }
              event.preventDefault()
              const target = tabs[next]
              if (target === undefined) return
              onSelect(target.id)
              refs.current[next]?.focus()
            }}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0
              ? <span className="hdw-gr-tab-count">{String(tab.badge)}</span>
              : null}
          </button>
        )
      })}
    </div>
  )
}
