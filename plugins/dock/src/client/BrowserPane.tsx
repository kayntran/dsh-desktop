/**
 * Một tab trình duyệt: thanh điều hướng, thanh địa chỉ, và **một ô trống**.
 *
 * Ô trống là chỗ trang web sẽ xuất hiện. Bản thân trang không nằm trong cây
 * React — nó sống ở sân khấu ngoài `document.body` (xem `browser-stage.ts`).
 * Component này chỉ đo ô trống rồi báo toạ độ sang đó.
 *
 * Cách này chép từ app tham chiếu, và cả một chi tiết nhỏ của họ cũng đáng chép:
 * đo xong thì **so với lần trước, giống thì thôi**. Kéo mép panel làm phép đo
 * chạy mỗi khung hình, mà việc phía bên kia là bố trí lại một trang web sống —
 * không hề rẻ.
 * @module
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconRefreshOutline16,
  IconStopFill16,
  Input,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { normalizeUrl, type Stage, type TabOwner, type TabStatus } from './browser-stage.ts'

const EMPTY_STATUS: TabStatus = {
  url: '', title: '', loading: false, canBack: false, canForward: false,
}

export interface BrowserPaneProps {
  paneId: string
  stage: Stage
  /** Đang bị che vì pane khác đang hiện. Không tháo, chỉ ẩn. */
  isHidden: boolean
  /** Địa chỉ mở sẵn, khi tab được tạo kèm URL (agent mở, hoặc đọc lại từ lần trước). */
  startUrl: string | undefined
  /** Ai mở tab này — quyết định rào chuyển hướng có áp cho nó không. */
  openedBy: TabOwner
}

/**
 * Thân một tab trình duyệt.
 * @param props - xem {@link BrowserPaneProps}.
 * @returns phần tử tab.
 */
export function BrowserPane({ paneId, stage, isHidden, startUrl, openedBy }: BrowserPaneProps): React.JSX.Element {
  const slotRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<TabStatus>(() => stage.status(paneId) ?? initialStatus(startUrl))
  const [input, setInput] = useState(startUrl ?? '')
  const [typing, setTyping] = useState(false)

  // Tạo webview một lần. Không phụ thuộc `startUrl` để lần đổi địa chỉ sau đó
  // không dựng lại thẻ — dựng lại là mất sạch trạng thái trang.
  useEffect(() => {
    stage.ensure(paneId, startUrl, openedBy)
    // Cố ý bỏ `startUrl` khỏi danh sách phụ thuộc: nó chỉ là địa chỉ khởi đầu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, paneId, openedBy])

  // Nghe trạng thái tab. Sân khấu báo cho cả panel, nên lọc lấy đúng tab mình.
  useEffect(() => {
    const readStatus = (): void => {
      const next = stage.status(paneId)
      if (next === undefined) return
      // So từng trường rồi mới ghi. `stage.status()` trả về một object MỚI mỗi
      // lần gọi, nên ghi thẳng là bắt cả pane vẽ lại 4 lần mỗi giây cho tới khi
      // đóng tab — kể cả khi không có gì đổi.
      setStatus((prev) => (
        prev.url === next.url && prev.title === next.title && prev.loading === next.loading
        && prev.canBack === next.canBack && prev.canForward === next.canForward
      ) ? prev : next)
    }
    readStatus()
    // Sân khấu không có bộ phát sự kiện riêng; nó gọi `onChange` của panel, mà
    // panel dùng để cập nhật kho. Kho đổi thì component này vẽ lại và đọc lại
    // trạng thái ở đây. Một nhịp hỏi lại theo khung hình lo nốt những thay đổi
    // không đi qua kho (nút back/forward sáng hay mờ).
    const timer = setInterval(readStatus, 250)
    return () => { clearInterval(timer) }
  }, [stage, paneId])

  // Theo địa chỉ thật, TRỪ lúc người dùng đang gõ — nếu không, một lần trang tự
  // chuyển hướng giữa chừng sẽ xoá mất thứ họ đang nhập dở.
  useEffect(() => {
    if (!typing && status.url !== '') setInput(status.url)
  }, [status.url, typing])

  /**
   * Đo ô trống rồi báo toạ độ sang sân khấu.
   *
   * Gộp vào một khung hình và bỏ qua khi hình chữ nhật không đổi — hai điều
   * này là bài học chép từ app tham chiếu, không phải tối ưu sớm.
   */
  const publishRect = useCallback((): void => {
    const el = slotRef.current
    if (el === null || isHidden) return
    const r = el.getBoundingClientRect()
    stage.setRect({
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    })
  }, [stage, isHidden])

  useEffect(() => {
    const el = slotRef.current
    if (el === null || isHidden) return undefined

    let last = ''
    const sync = (): void => {
      const r = el.getBoundingClientRect()
      const key = `${String(Math.round(r.left))},${String(Math.round(r.top))},${String(Math.round(r.width))},${String(Math.round(r.height))}`
      // Bỏ qua khi hình chữ nhật không đổi: việc phía bên kia là bố trí lại một
      // trang web sống, không hề rẻ.
      if (key === last) return
      last = key
      publishRect()
    }

    // KHÔNG bọc trong `requestAnimationFrame`. Bản trước bọc, và cái giá là
    // trang nạp xong nhưng không vẽ ra: sân khấu nằm im ở `display: none` vì
    // lệnh hiện nó chờ một khung hình không bao giờ tới. Chromium ngừng cấp
    // khung hình cho cửa sổ nó cho là không ai nhìn, nên gửi một lệnh KHỞI TẠO
    // qua `requestAnimationFrame` là gửi một lệnh có thể không bao giờ chạy.
    //
    // Và không cần nó: `ResizeObserver` vốn đã phát tối đa một lần mỗi khung
    // hình, còn phép so hình chữ nhật ở trên đã chặn mọi lần gửi thừa.
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    window.addEventListener('resize', sync)
    // Cửa sổ app cuộn thì toạ độ khung nhìn đổi theo.
    window.addEventListener('scroll', sync, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [isHidden, publishRect])

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const url = normalizeUrl(input)
    if (url === undefined) return
    stage.navigate(paneId, url)
    setTyping(false)
    // Trả bàn phím cho trang. Không có dòng này thì trang mới nạp xong nhưng
    // tiêu điểm vẫn nằm ở ô địa chỉ, và phím đầu tiên người dùng gõ — thường là
    // để cuộn hoặc để tìm trong trang — lại chui vào ô nhập.
    stage.focus(paneId)
  }

  return (
    <div className="hdw-browser" hidden={isHidden}>
      <form className="hdw-navbar" onSubmit={submit}>
        <Tooltip label="Lùi" side="bottom">
          <Button
            variant="ghost" size="sm" type="button"
            icon={<IconChevronLeftOutline14 />}
            aria-label="Lùi"
            disabled={!status.canBack}
            onClick={() => { stage.goBack(paneId) }}
          />
        </Tooltip>
        <Tooltip label="Tiến" side="bottom">
          <Button
            variant="ghost" size="sm" type="button"
            icon={<IconChevronRightOutline14 />}
            aria-label="Tiến"
            disabled={!status.canForward}
            onClick={() => { stage.goForward(paneId) }}
          />
        </Tooltip>
        <Tooltip label={status.loading ? 'Dừng' : 'Tải lại'} side="bottom">
          <Button
            variant="ghost" size="sm" type="button"
            icon={status.loading ? <IconStopFill16 /> : <IconRefreshOutline16 />}
            aria-label={status.loading ? 'Dừng' : 'Tải lại'}
            onClick={() => { status.loading ? stage.stop(paneId) : stage.reload(paneId) }}
          />
        </Tooltip>
        <Input
          className="hdw-address"
          aria-label="Địa chỉ"
          value={input}
          spellCheck={false}
          placeholder="Nhập địa chỉ trang web"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => { setInput(event.target.value) }}
          onFocus={() => { setTyping(true) }}
          onBlur={() => { setTyping(false) }}
        />
      </form>
      {/* Trang web được vẽ đè lên ô này. Nó rỗng, và phải rỗng. */}
      <div className="hdw-slot" ref={slotRef} aria-hidden />
    </div>
  )
}

/** Trạng thái ban đầu, có kể tới địa chỉ mở sẵn. */
function initialStatus(url: string | undefined): TabStatus {
  return url === undefined ? EMPTY_STATUS : { ...EMPTY_STATUS, url, loading: true }
}
