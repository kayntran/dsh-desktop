/**
 * The handle that resizes the panel.
 *
 * Upstream has a `DragHandle` for its own two columns but does not export it, so this
 * is a rebuild following exactly how theirs works
 * (`_upstream_dsh/packages/client/ui-layout/src/client/AppFrame.tsx:40-84`): capture
 * the pointer with `setPointerCapture` so the gesture does not drop when the mouse
 * leaves the element, and coalesce moves into one frame with
 * `requestAnimationFrame` so state is not written at the mouse hardware's rate.
 * @module
 */

import { useCallback, useRef } from 'react'

export interface ResizerProps {
  /** The current width, the baseline the drag delta is added to. */
  width: number
  /** Receives the new width on every frame. */
  onResize: (px: number) => void
}

/**
 * The drag strip on the panel's inner edge (the panel hugs the window's right edge).
 * @param props - see {@link ResizerProps}.
 * @returns the handle element.
 */
export function Resizer({ width, onResize }: ResizerProps): React.JSX.Element {
  const start = useRef(0)
  const base = useRef(0)
  const frame = useRef(0)

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    start.current = event.clientX
    base.current = width
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.dataset['dragging'] = 'true'
    // Turn off `#root`'s transition for the whole gesture: with easing the app frame
    // crawls along behind the pointer instead of tracking it.
    document.getElementById('root')?.setAttribute('data-hdw-dragging', 'true')
  }, [width])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.dataset['dragging'] !== 'true') return
    // The panel hugs the right edge, so the handle sits on its left: dragging LEFT
    // widens it, which is the opposite sign from the coordinate delta.
    const dx = start.current - event.clientX
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => { onResize(base.current + dx) })
  }, [onResize])

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    cancelAnimationFrame(frame.current)
    delete event.currentTarget.dataset['dragging']
    event.currentTarget.releasePointerCapture(event.pointerId)
    document.getElementById('root')?.removeAttribute('data-hdw-dragging')
  }, [])

  return (
    <div
      className="hdw-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the panel"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}
