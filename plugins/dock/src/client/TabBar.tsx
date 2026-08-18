/**
 * The panel's pill strip: Files, each terminal and each web page are all peer pills,
 * plus a `+` button to open more and a button that closes the whole panel.
 *
 * `Pill` is an existing upstream component, and the comment in their source names
 * exactly this use — *"view switcher tabs, filters, badges"*. An earlier version bent
 * `Button` into a tablist and hand-drew the underline; this version drops both.
 *
 * Each pill's close button sits **outside** the `Pill` rather than nested inside it: a
 * `<button>` inside a `<button>` is invalid HTML, and browsers handle it differently
 * from one another. It is overlaid on the right edge in CSS, so it still reads as one
 * pill while the keyboard can still reach both.
 * @module
 */

import { useEffect, useState } from 'react'
import {
  Button,
  IconApiOutline14,
  IconCloseFill14,
  IconCloseOutline16,
  IconFolderOpen16,
  IconGlobeOutline14,
  IconPlusOutline16,
  Menu,
  Pill,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Pane, PaneKind } from './store.ts'

/** The icon at the start of each pill, by pane kind. */
function KindIcon({ kind }: { kind: PaneKind }): React.JSX.Element {
  if (kind === 'files') return <IconFolderOpen16 size={14} />
  if (kind === 'browser') return <IconGlobeOutline14 />
  return <IconApiOutline14 />
}

export interface TabBarProps {
  panes: readonly Pane[]
  activeId: string | undefined
  onSelect: (id: string) => void
  onClosePane: (id: string) => void
  onOpen: (kind: PaneKind) => void
  onClose: () => void
}

/**
 * The pill strip at the top of the panel.
 * @param props - see {@link TabBarProps}.
 * @returns the pill strip element.
 */
export function TabBar({ panes, activeId, onSelect, onClosePane, onOpen, onClose }: TabBarProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)

  // Close the menu when a web page takes the keyboard.
  //
  // Upstream's `Menu` closes itself by listening for clicks on `document`. But since the
  // panel stopped capturing the mouse over the web area (see `styles.css`), a click on
  // the page no longer reaches the app's `document` — it goes straight into the page's
  // own process. So opening the menu and clicking out into the middle of a web page to
  // dismiss it left the menu standing there.
  //
  // What does still arrive: the `<webview>` tag takes DOM focus, and that event bubbles
  // up to `document` as `focusin`.
  useEffect(() => {
    if (!menuOpen) return undefined
    const onPageTakesFocus = (event: FocusEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && target.tagName.toLowerCase() === 'webview') setMenuOpen(false)
    }
    document.addEventListener('focusin', onPageTakesFocus)
    return () => { document.removeEventListener('focusin', onPageTakesFocus) }
  }, [menuOpen])

  const items: MenuEntry[] = [
    { id: 'browser', label: 'New web page', icon: <IconGlobeOutline14 /> },
    { id: 'terminal', label: 'New terminal', icon: <IconApiOutline14 /> },
    { id: 'files', label: 'Files', icon: <IconFolderOpen16 size={14} /> },
  ]

  return (
    <div className="hdw-tabbar" role="tablist" aria-label="Panel views">
      <div className="hdw-pills">
        {panes.map((pane) => (
          <div className="hdw-pillwrap" key={pane.id}>
            <Pill
              // A sleeping page keeps its pill and its name; only the ink fades. That is
              // the whole point of sleeping — the tab is still there, and selecting it
              // brings the page back — so anything stronger would read as "gone".
              className={pane.asleep === true ? 'hdw-pill hdw-pill-asleep' : 'hdw-pill'}
              active={pane.id === activeId}
              onClick={() => { onSelect(pane.id) }}
              role="tab"
              aria-selected={pane.id === activeId}
              title={pane.asleep === true ? `${pane.title} (asleep — select to reopen)` : pane.title}
            >
              <span className="hdw-pill-icon"><KindIcon kind={pane.kind} /></span>
              <span className="hdw-pill-name">{pane.title}</span>
            </Pill>
            {/* Files cannot be closed: it is the one pane that always makes sense, and
                closing it only to reopen it is not a real choice. */}
            {pane.kind !== 'files' && (
              <button
                type="button"
                className="hdw-pill-x"
                aria-label={`Close ${pane.title}`}
                onClick={(event) => { event.stopPropagation(); onClosePane(pane.id) }}
              >
                <IconCloseFill14 />
              </button>
            )}
          </div>
        ))}

        <Menu
          open={menuOpen}
          items={items}
          // `portal` is NOT optional here. The pill strip carries `overflow-x: auto` so it
          // can scroll sideways once many tabs are open, and per the CSS spec, setting
          // overflow on one axis turns the other from `visible` into `auto` — so the menu
          // box gets clipped vertically too. The symptom was exactly what the project owner
          // hit: press `+` and see nothing. The menu was still in the DOM, at full size, in
          // the right place — just invisible and unclickable.
          //
          // `portal` moves the menu box straight onto `document.body` and positions it
          // against the anchor. This is the route upstream left open for exactly this
          // situation; their comment reads: *"for anchors inside overflow-clipping
          // containers"*.
          portal
          onSelect={(id) => { setMenuOpen(false); onOpen(id as PaneKind) }}
          onClose={() => { setMenuOpen(false) }}
          anchor={(
            <Button
              variant="ghost"
              size="sm"
              icon={<IconPlusOutline16 />}
              aria-label="Open more"
              onClick={() => { setMenuOpen((prev) => !prev) }}
            />
          )}
        />
      </div>

      <Tooltip label="Close panel" side="bottom">
        <Button
          variant="ghost"
          size="sm"
          icon={<IconCloseOutline16 />}
          aria-label="Close panel"
          onClick={onClose}
        />
      </Tooltip>
    </div>
  )
}
