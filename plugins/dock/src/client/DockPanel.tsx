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
 *
 * ## The same rule, one level up: every CHAT's panes stay mounted
 *
 * The strip on screen belongs to the chat on screen, but the panel renders the panes of
 * **every** chat and hides the rest. That is the same lesson as the paragraph above: drop
 * a chat's panes from the tree while the user is reading another chat and its terminals
 * die on the spot, which is exactly the bug this file used to have — switching to a chat
 * in another workspace killed whatever the shell was running, with nothing reported.
 *
 * It also fixes what the folder was measured from. Each pane's root directory now comes
 * from **its own chat**, not from whichever chat happens to be on screen.
 * @module
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { SessionId, SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { BrowserPane } from './BrowserPane.tsx'
import { createStage, type Stage } from './browser-stage.ts'
import { FilesTab } from './FilesTab.tsx'
import { Resizer } from './Resizer.tsx'
import { sweepIdlePages, SWEEP_INTERVAL_MS } from './hibernate.ts'
import { TabBar } from './TabBar.tsx'
import { TerminalTab } from './TerminalTab.tsx'
import type { StageHolder } from './stage-holder.ts'
import type { ChatDock, DockActions, DockState } from './store.ts'

/** A chat with no strip of its own yet — read-only, so nothing is written until the user acts. */
const EMPTY_CHAT: ChatDock = { open: false, panes: [], activeId: undefined }

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
  // The whole state, not a slice of it: the panel reads most of it anyway, and the sleep
  // timer needs to see the panes of every chat rather than only the one on screen.
  const dock = useDock((s) => s)
  const { width, byChat } = dock

  const currentChat = useSessions((s) => s.current)
  const sessionsById = useSessions((s) => s.byId)
  const sessionIds = useSessions((s) => s.ids)
  const sessionsReady = useSessions((s) => s.phase === 'ready')
  // With no session at all, fall back to the first workspace in the list — the registry
  // puts the newest first — so a brand-new install shows something rather than an empty
  // panel.
  const firstWorkspace = useWorkspaces((s) => s.items[0]?.path)

  const chat = (currentChat === undefined ? undefined : byChat[currentChat]) ?? EMPTY_CHAT
  const open = chat.open
  const panes = chat.panes
  const activeId = chat.activeId
  const active = useMemo(() => panes.find((p) => p.id === activeId), [panes, activeId])
  // The pane the user is genuinely looking at. A closed panel shows nothing, however
  // active its pane is on paper — and that difference is what starts the sleep clock.
  const visiblePaneId = open ? activeId : undefined

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

  // Tell the Node half which chat is on screen. A bridge command that arrives without a
  // session of its own — the diagnostic HTTP routes — has to act somewhere, and this is
  // the only defensible answer.
  useEffect(() => { actions.setVisibleChat(currentChat) }, [currentChat, actions])

  // A deleted chat takes its panes with it: its pages close and its shells are killed.
  //
  // Waits for `ready`, because a `pending` list is "nothing has arrived yet", not
  // "nothing exists" — pruning against it would wipe every chat's panes at startup. The
  // live set is `ids` plus the keys of `byId`: a subagent route the user has navigated
  // into appears in the second and not the first.
  useEffect(() => {
    if (!sessionsReady) return
    const live = new Set<string>([...sessionIds, ...Object.keys(sessionsById)])
    const stale = Object.keys(byChat).filter((id) => !live.has(id))
    if (stale.length === 0) return
    for (const id of stale) {
      for (const pane of byChat[id]?.panes ?? []) stage.remove(pane.id)
    }
    actions.forgetChatsExcept([...live])
  }, [sessionsReady, sessionIds, sessionsById, byChat, stage, actions])

  // Did the user just pick a tab themselves, or is the panel rebuilding itself?
  //
  // That difference decides whether the keyboard is handed to the web page, and it
  // CANNOT be derived from state: the same new `activeId` means a click in one case and
  // the app having just opened and read back the previous session in the other. So the
  // intent is recorded right where it originates and consumed on use.
  const userPicked = useRef(false)
  const selectTab = useCallback((id: string) => {
    if (currentChat === undefined) return
    userPicked.current = true
    actions.setActive(currentChat, id)
  }, [actions, currentChat])

  // The stage only shows while the panel is open AND the pane being viewed is a web
  // page. At every other moment it is fully hidden — otherwise the web page would float
  // over the Files tab, or over another chat's conversation.
  useEffect(() => {
    stage.setActive(visiblePaneId, userPicked.current)
    userPicked.current = false
    if (!open || active?.kind !== 'browser') stage.setRect(undefined)
  }, [stage, open, visiblePaneId, active?.kind])

  // Start the idle clock the moment a page leaves the screen.
  //
  // Written as a cleanup rather than a repeating tick: the sweep skips whatever is on
  // screen, so the only instant that has to be recorded is the one it stops being on
  // screen. A tick would write to the store every minute for nothing.
  useEffect(() => {
    if (visiblePaneId === undefined) return undefined
    return () => { actions.touchPane(visiblePaneId) }
  }, [visiblePaneId, actions])

  // Wake whatever comes into view.
  //
  // Keyed off "what is visible" rather than off the tab click, because a page can also
  // come back into view without any click: the panel was closed over it, the page fell
  // asleep while hidden, and reopening the panel puts it straight back on screen.
  // Clearing the flag is enough — `BrowserPane` rebuilds the page from its address.
  useEffect(() => {
    if (visiblePaneId === undefined) return
    if (panes.find((p) => p.id === visiblePaneId)?.asleep === true) {
      actions.setPaneAsleep(visiblePaneId, false)
    }
  }, [visiblePaneId, panes, actions])

  // The sleep timer. It reads the state through a ref so the interval does not have to be
  // torn down and rebuilt every time anything in the panel changes.
  const latest = useRef(dock)
  latest.current = dock
  const visibleRef = useRef(visiblePaneId)
  visibleRef.current = visiblePaneId
  useEffect(() => {
    const timer = setInterval(() => {
      void sweepIdlePages(stage, latest.current, visibleRef.current, (id) => { actions.setPaneAsleep(id, true) })
    }, SWEEP_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [stage, actions])

  // Write the width onto `<html>` so the panel's CSS and `#root`'s padding read one
  // number. Cleaned up when the panel unmounts — the app has to look exactly as it did
  // with no plugin at all.
  useLayoutEffect(() => {
    const el = document.documentElement
    el.style.setProperty('--hdw-dock-w', open ? `${String(width)}px` : '0px')
    return () => { el.style.removeProperty('--hdw-dock-w') }
  }, [open, width])

  const closeTab = useCallback((id: string) => {
    if (currentChat === undefined) return
    stage.remove(id)
    actions.closePane(currentChat, id)
  }, [stage, actions, currentChat])

  return (
    <aside className="hdw-dock" aria-label="Tools panel" hidden={!open}>
      <TabBar
        panes={panes}
        activeId={activeId}
        onSelect={selectTab}
        onClosePane={closeTab}
        onOpen={(kind) => { if (currentChat !== undefined) actions.openPane(currentChat, kind) }}
        onClose={() => { if (currentChat !== undefined) actions.close(currentChat) }}
      />
      <div className="hdw-body">
        {Object.entries(byChat).flatMap(([chatId, entry]) => entry.panes.map((pane) => {
          // Shown only when it is the viewed pane OF the viewed chat. Every other pane in
          // the window stays mounted and hidden — that is what keeps another chat's shell
          // running while the user works here.
          const isHidden = !(chatId === currentChat && pane.id === activeId)
          // Each pane's folder comes from ITS OWN chat. Reading it from the chat on screen
          // is what used to tear down a terminal on every switch between workspaces.
          // The cast is the store's key type meeting the framework's: `byChat` is keyed by
          // plain strings that only ever came from session ids in the first place.
          const root = sessionsById[chatId as SessionId]?.cwd ?? (chatId === currentChat ? firstWorkspace : undefined)
          if (pane.kind === 'files') return <FilesTab key={pane.id} root={root} isHidden={isHidden} />
          if (pane.kind === 'terminal') return <TerminalTab key={pane.id} root={root} isHidden={isHidden} />
          return (
            <BrowserPane
              key={pane.id}
              paneId={pane.id}
              stage={stage}
              isHidden={isHidden}
              startUrl={pane.url}
              asleep={pane.asleep ?? false}
              openedBy={pane.openedBy ?? 'user'}
            />
          )
        }))}
        {panes.length === 0 && <div className="hdw-empty">Nothing open. Use the + button to add a view.</div>}
      </div>
      <Resizer width={width} onResize={actions.setWidth} />
    </aside>
  )
}
