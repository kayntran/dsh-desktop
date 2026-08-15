/**
 * Tay kéo đổi bề rộng panel.
 *
 * Upstream có `DragHandle` cho hai cột của họ nhưng không xuất ra ngoài, nên
 * đây là bản dựng lại theo đúng cách làm của nó
 * (`_upstream_dsh/packages/client/ui-layout/src/client/AppFrame.tsx:40-84`):
 * bắt con trỏ bằng `setPointerCapture` để cử chỉ không rơi khi chuột đi ra
 * ngoài phần tử, và gộp các lần di chuyển vào một khung hình bằng
 * `requestAnimationFrame` để không ghi trạng thái ở nhịp của phần cứng chuột.
 * @module
 */

import { useCallback, useRef } from 'react'

export interface ResizerProps {
  /** Bề rộng hiện tại, làm mốc cho phép cộng dồn khi kéo. */
  width: number
  /** Nhận bề rộng mới ở mỗi khung hình. */
  onResize: (px: number) => void
}

/**
 * Dải kéo đặt ở cạnh trong của panel (panel bám mép phải cửa sổ).
 * @param props - xem {@link ResizerProps}.
 * @returns phần tử tay kéo.
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
    // Tắt chuyển động của `#root` suốt cử chỉ: có easing thì khung app sẽ bò
    // theo sau con trỏ thay vì bám sát.
    document.getElementById('root')?.setAttribute('data-hdw-dragging', 'true')
  }, [width])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.dataset['dragging'] !== 'true') return
    // Panel bám mép phải nên tay kéo ở cạnh trái: kéo sang TRÁI là rộng ra,
    // tức là chiều ngược với hiệu số toạ độ.
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
      aria-label="Đổi bề rộng panel"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}
