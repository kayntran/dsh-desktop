/**
 * The panel's on/off button, placed in the right-aligned utility group on the session
 * header row — `conversation.session.header.utilities`, an empty `list` slot upstream
 * leaves open. The same place the reference app puts this button: the top-right corner
 * of the conversation frame.
 *
 * A consequence of living in the session header: with no session open there is no
 * header, so there is no button. The reference app behaves the same way.
 * @module
 */

import { Button, IconPanelLeftOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { DockActions, DockState } from './store.ts'

export interface DockToggleInjected {
  /** The panel store, passed in by the plugin — the same store the panel uses. */
  useDock: SnapshotSelectorHook<DockState>
  actions: DockActions
}

/**
 * The button's full props.
 *
 * `PropsRuntime` is what brings in `sessionId`. The slot is session-scoped, so the
 * framework hands each copy of this button the id of the chat whose header it sits in —
 * which is exactly the chat whose panel it must open. Reading "the current chat" from
 * anywhere else would be a guess that happens to be right most of the time.
 */
export type DockToggleProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & DockToggleInjected

/**
 * The open/close button.
 * @param props - see {@link DockToggleProps}.
 * @returns the button element.
 */
export function DockToggle({ useDock, actions, sessionId }: DockToggleProps): React.JSX.Element {
  const open = useDock((s) => s.byChat[sessionId]?.open ?? false)
  const label = open ? 'Close tools panel' : 'Open tools panel'

  return (
    <Tooltip label={label} side="bottom">
      <Button
        variant="ghost"
        size="sm"
        // Upstream's icon set only has a "panel on the left" version; ours sits on the
        // right, so it is mirrored in CSS. Still a system icon, with the right stroke and
        // the right size — no new icon drawn by hand.
        icon={<span className="hdw-flip"><IconPanelLeftOutline16 /></span>}
        aria-label={label}
        aria-pressed={open}
        onClick={() => { actions.toggle(sessionId) }}
      />
    </Tooltip>
  )
}
