/**
 * The Plugins page: a button at the foot of the sidebar, and the full-window
 * surface it opens.
 *
 * **Level 1 — additive only.** One registration into `sidebar.footer.action`, a
 * `list` slot upstream leaves open. It renders ABOVE the Settings row, which is
 * where `SidebarRoot` puts that slot.
 *
 * ## Why the surface is drawn here rather than mounted as a page
 *
 * Upstream has no router and no page slot. The three layout regions — sidebar,
 * conversation, details — are `single` slots that already have owners, so taking
 * one is a Level 3 replacement and forbidden. What upstream does INSTEAD, for its
 * own Settings, is render a `position: fixed; inset: 0` layer as a sibling of the
 * trigger button (`SettingsRoot.tsx`), and its own Cordis panel does the same.
 * That is the shipped pattern for a full-window surface, so it is the one used
 * here: same overlay/mask/panel shape, same close paths (header button, mask
 * click, document-level Escape), same baseline focus move onto the close button.
 *
 * `Modal` was the other candidate and is the wrong shape: it is a centered dialog
 * card meant for a question, not a surface you browse.
 * @module
 */

import { useEffect, useId, useRef, useState } from 'react'
import {
  IconCloseOutline16,
  IconPersonalizationOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { InstalledTab } from './InstalledTab.tsx'
import { MarketTab } from './MarketTab.tsx'

/** Full props of the footer entry. The slot's own share is a single flag: `wide`. */
export type PluginsPageProps = PropsRuntime<'sidebar.footer.action'>

/** The two halves of the page, in the order they are shown. */
const TABS = [
  { id: 'installed', label: 'Installed' },
  { id: 'market', label: 'Market' },
] as const

type TabId = (typeof TABS)[number]['id']

/** The layer itself. Mounted only while open, so its listeners live exactly as long. */
function PluginsPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const titleId = useId()
  const tabsId = useId()
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [active, setActive] = useState<TabId>('installed')
  // A tab keeps its state once opened: switching back to a market search that
  // reset itself would be a page that forgets what the user was doing.
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(new Set(['installed']))

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  // Baseline focus management: entering the dialog lands on the close button.
  useEffect(() => { closeButton.current?.focus() }, [])

  const select = (id: TabId): void => {
    setActive(id)
    setVisited((seen) => (seen.has(id) ? seen : new Set([...seen, id])))
  }

  return (
    <div className="hdw-pm-overlay" role="presentation">
      <div className="hdw-pm-mask" aria-hidden="true" onClick={onClose} />
      <div className="hdw-pm-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="hdw-pm-head">
          <h2 className="hdw-pm-heading" id={titleId}>Plugins</h2>
          <button ref={closeButton} type="button" className="hdw-pm-close" onClick={onClose}>
            <IconCloseOutline16 size={14} />
            <span className="hdw-pm-hidden-label">Close</span>
          </button>
        </div>
        {/* Tab strip copied from upstream's own (`PluginsSettingsSection`): a bare
            `<button>` row with an underline on the active one, arrow keys, Home and
            End, and only the active tab inside the tab order. The primitive set has
            no `Tabs` component, and a `Pill` row would read as filters, not tabs. */}
        <div className="hdw-pm-tabs" role="tablist" aria-label="Plugins">
          {TABS.map((tab, index) => {
            const selected = tab.id === active
            return (
              <button
                key={tab.id}
                ref={(element) => { tabRefs.current[index] = element }}
                id={`${tabsId}-tab-${tab.id}`}
                type="button"
                role="tab"
                className="hdw-pm-tab"
                aria-selected={selected}
                aria-controls={`${tabsId}-panel-${tab.id}`}
                data-active={selected ? 'true' : undefined}
                tabIndex={selected ? 0 : -1}
                onClick={() => { select(tab.id) }}
                onKeyDown={(event) => {
                  let next: number
                  switch (event.key) {
                    case 'ArrowRight': next = (index + 1) % TABS.length; break
                    case 'ArrowLeft': next = (index - 1 + TABS.length) % TABS.length; break
                    case 'Home': next = 0; break
                    case 'End': next = TABS.length - 1; break
                    default: return
                  }
                  event.preventDefault()
                  const target = TABS[next]
                  if (target === undefined) return
                  select(target.id)
                  tabRefs.current[next]?.focus()
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        {TABS.filter((tab) => visited.has(tab.id)).map((tab) => (
          <div
            key={tab.id}
            id={`${tabsId}-panel-${tab.id}`}
            className="hdw-pm-body"
            role="tabpanel"
            aria-labelledby={`${tabsId}-tab-${tab.id}`}
            hidden={tab.id !== active}
          >
            {/* A hidden tab stays mounted so it keeps its state, which means it
                also keeps stale data — so it is told when it is the one on
                screen and re-reads then. */}
            {tab.id === 'installed' ? <InstalledTab active={active === 'installed'} /> : <MarketTab />}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The sidebar footer entry: trigger plus surface.
 * @param props - slot props; only `wide` is read.
 * @returns the button, and the panel while it is open.
 */
export function PluginsPage({ wide }: PluginsPageProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  // Geometry copied from upstream's Settings trigger so the two rows sit on one
  // rhythm: 34px tall and 12px-rounded when the sidebar is wide, a 36px circle
  // when it is collapsed to the rail.
  const trigger = (
    <button
      type="button"
      className={`hdw-pm-trigger${wide ? '' : ' hdw-pm-trigger-rail'}`}
      // A stable handle for `npm run spike:switch`: upstream's own entry sits in
      // this same slot, and the class name alone is not a promise to a probe.
      data-hdw="plugins-trigger"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => { setOpen(true) }}
    >
      <IconPersonalizationOutline16 />
      {wide ? <span className="hdw-pm-trigger-label">Plugins</span> : null}
    </button>
  )

  return (
    <>
      {/* In the rail there is no label, so the name has to come from somewhere. */}
      {wide ? trigger : <Tooltip label="Plugins" side="right">{trigger}</Tooltip>}
      {open && <PluginsPanel onClose={() => { setOpen(false) }} />}
    </>
  )
}
