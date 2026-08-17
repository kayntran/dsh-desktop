/**
 * The right-hand panel. Registered into `shell.overlay` — an empty `list` slot upstream
 * leaves open for the layer floating above every column.
 *
 * It floats with `position: fixed` hugging the right edge, while the app frame shrinks
 * to make room through the `--hdw-dock-w` variable written on `<html>` (see
 * `styles.css`). What it reads as is four columns side by side, none covering another.
 *
 * ## A closed panel must NOT unmount its content
 *
 * An earlier version returned `null` when closed. The consequence was not immediately
 * visible but severe: unmounting the component closes the WebSocket, and closing the
 * WebSocket kills the shell — one click to close the panel lost a running `npm run dev`,
 * and reopening showed a blank terminal as if nothing had ever happened. The panel now
 * only **hides**; every pane stays alive.
 * @module
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { BrowserPane } from './BrowserPane.tsx'
import { createStage, type Stage } from './browser-stage.ts'
import { FilesTab } from './FilesTab.tsx'
import { Resizer } from './Resizer.tsx'
import { TabBar } from './TabBar.tsx'
import { TerminalTab } from './TerminalTab.tsx'
import type { StageHolder } from './stage-holder.ts'
import type { DockActions, DockState } from './store.ts'

export interface DockPanelProps {
  /** The panel store, passed in by the plugin — the same store the session-header button uses. */
  useDock: SnapshotSelectorHook<DockState>
  actions: DockActions
  /** The stage holder, so the plugin-level bridge can reach a web page. */
  stageHolder: StageHolder
  useSessions: SnapshotSelectorHook<SessionListState>
  useWorkspaces: SnapshotSelectorHook<WorkspaceListState>
}

/**
 * The panel's body.
 * @param props - the panel state plus the framework's global data selectors.
 * @returns the panel element.
 */
export function DockPanel({ useDock, actions, stageHolder, useSessions, useWorkspaces }: DockPanelProps): React.JSX.Element {
  const open = useDock((s) => s.open)
  const width = useDock((s) => s.width)
  const panes = useDock((s) => s.panes)
  const activeId = useDock((s) => s.activeId)

  // The root directory: the open session's cwd. With no session, take the first
  // workspace in the list — the registry puts the newest workspace first, so that is the
  // most recently used one — so opening the app already shows something rather than an
  // empty panel.
  const cwd = useSessions((s) => s.current === undefined ? undefined : s.byId[s.current]?.cwd)
  const firstWorkspace = useWorkspaces((s) => s.items[0]?.path)
  const root = cwd ?? firstWorkspace

  // The webview stage: built once for the whole panel, living outside React. See
  // `browser-stage.ts` for why it cannot be a component.
  const stageRef = useRef<Stage | undefined>(undefined)
  if (stageRef.current === undefined) {
    stageRef.current = createStage((id, status) => {
      actions.describePane(id, {
        title: status.title === '' ? undefined : status.title,
        url: status.url,
      })
    })
  }
  const stage = stageRef.current

  // Hand the stage to the plugin level, and TAKE IT BACK when the component unmounts.
  //
  // Taking it back matters as much as handing it over: a slot may rebuild the component
  // at any time, and the old stage is `destroy()`ed. Without clearing the holder, from
  // that second on the bridge holds a dead stage — no error reported, just every agent
  // command starting to fail silently.
  useEffect(() => {
    stageHolder.current = stage
    return () => {
      if (stageHolder.current === stage) stageHolder.current = undefined
      stage.destroy()
    }
  }, [stage, stageHolder])

  const active = useMemo(() => panes.find((p) => p.id === activeId), [panes, activeId])

  // Did the user just pick a tab themselves, or is the panel rebuilding itself?
  //
  // That difference decides whether the keyboard is handed to the web page, and it
  // CANNOT be derived from state: the same new `activeId` means a click in one case and
  // the app having just opened and read back the previous session in the other. So the
  // intent is recorded right where it originates and consumed on use.
  const userPicked = useRef(false)
  const selectTab = useCallback((id: string) => {
    userPicked.current = true
    actions.setActive(id)
  }, [actions])

  // The stage only shows while the panel is open AND the pane being viewed is a web
  // page. At every other moment it is fully hidden — otherwise the web page would float
  // over the Files tab.
  useEffect(() => {
    stage.setActive(activeId, userPicked.current)
    userPicked.current = false
    if (!open || active?.kind !== 'browser') stage.setRect(undefined)
  }, [stage, open, activeId, active?.kind])

  // Write the width onto `<html>` so the panel's CSS and `#root`'s padding read one
  // number. Cleaned up when the panel unmounts — the app has to look exactly as it did
  // with no plugin at all.
  useLayoutEffect(() => {
    const el = document.documentElement
    el.style.setProperty('--hdw-dock-w', open ? `${String(width)}px` : '0px')
    return () => { el.style.removeProperty('--hdw-dock-w') }
  }, [open, width])

  const closeTab = useCallback((id: string) => {
    stage.remove(id)
    actions.closePane(id)
  }, [stage, actions])

  return (
    <aside className="hdw-dock" aria-label="Tools panel" hidden={!open}>
      <TabBar
        panes={panes}
        activeId={activeId}
        onSelect={selectTab}
        onClosePane={closeTab}
        onOpen={(kind) => { actions.openPane(kind) }}
        onClose={actions.close}
      />
      <div className="hdw-body">
        {panes.map((pane) => {
          const isHidden = pane.id !== activeId
          if (pane.kind === 'files') return <FilesTab key={pane.id} root={root} isHidden={isHidden} />
          if (pane.kind === 'terminal') return <TerminalTab key={pane.id} root={root} isHidden={isHidden} />
          return (
            <BrowserPane
              key={pane.id}
              paneId={pane.id}
              stage={stage}
              isHidden={isHidden}
              startUrl={pane.url}
              openedBy={pane.openedBy ?? 'user'}
            />
          )
        })}
        {panes.length === 0 && <div className="hdw-empty">Nothing open. Use the + button to add a view.</div>}
      </div>
      <Resizer width={width} onResize={actions.setWidth} />
    </aside>
  )
}
