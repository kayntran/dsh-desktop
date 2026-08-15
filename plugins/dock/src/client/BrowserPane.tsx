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
import { chuanHoaUrl, type Stage, type TabStatus } from './browser-stage.ts'

const TRANG_THAI_RONG: TabStatus = {
  url: '', title: '', loading: false, canBack: false, canForward: false,
}

export interface BrowserPaneProps {
  paneId: string
  stage: Stage
  /** Đang bị che vì pane khác đang hiện. Không tháo, chỉ ẩn. */
  an: boolean
  /** Địa chỉ mở sẵn, khi tab được tạo kèm URL (agent mở, hoặc đọc lại từ lần trước). */
  batDau: string | undefined
}

/**
 * Thân một tab trình duyệt.
 * @param props - xem {@link BrowserPaneProps}.
 * @returns phần tử tab.
 */
export function BrowserPane({ paneId, stage, an, batDau }: BrowserPaneProps): React.JSX.Element {
  const oRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<TabStatus>(() => stage.status(paneId) ?? TRANG_TRONG_HOAC(batDau))
  const [nhap, setNhap] = useState(batDau ?? '')
  const [dangGo, setDangGo] = useState(false)

  // Tạo webview một lần. Không phụ thuộc `batDau` để lần đổi địa chỉ sau đó
  // không dựng lại thẻ — dựng lại là mất sạch trạng thái trang.
  useEffect(() => {
    stage.ensure(paneId, batDau)
    // Cố ý bỏ `batDau` khỏi danh sách phụ thuộc: nó chỉ là địa chỉ khởi đầu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, paneId])

  // Nghe trạng thái tab. Sân khấu báo cho cả panel, nên lọc lấy đúng tab mình.
  useEffect(() => {
    const doc = (): void => {
      const s = stage.status(paneId)
      if (s === undefined) return
      // So từng trường rồi mới ghi. `stage.status()` trả về một object MỚI mỗi
      // lần gọi, nên ghi thẳng là bắt cả pane vẽ lại 4 lần mỗi giây cho tới khi
      // đóng tab — kể cả khi không có gì đổi.
      setStatus((cu) => (
        cu.url === s.url && cu.title === s.title && cu.loading === s.loading
        && cu.canBack === s.canBack && cu.canForward === s.canForward
      ) ? cu : s)
    }
    doc()
    // Sân khấu không có bộ phát sự kiện riêng; nó gọi `onChange` của panel, mà
    // panel dùng để cập nhật kho. Kho đổi thì component này vẽ lại và đọc lại
    // trạng thái ở đây. Một nhịp hỏi lại theo khung hình lo nốt những thay đổi
    // không đi qua kho (nút back/forward sáng hay mờ).
    const id = setInterval(doc, 250)
    return () => { clearInterval(id) }
  }, [stage, paneId])

  // Theo địa chỉ thật, TRỪ lúc người dùng đang gõ — nếu không, một lần trang tự
  // chuyển hướng giữa chừng sẽ xoá mất thứ họ đang nhập dở.
  useEffect(() => {
    if (!dangGo && status.url !== '') setNhap(status.url)
  }, [status.url, dangGo])

  /**
   * Đo ô trống rồi báo toạ độ sang sân khấu.
   *
   * Gộp vào một khung hình và bỏ qua khi hình chữ nhật không đổi — hai điều
   * này là bài học chép từ app tham chiếu, không phải tối ưu sớm.
   */
  const doVaBao = useCallback((): void => {
    const el = oRef.current
    if (el === null || an) return
    const r = el.getBoundingClientRect()
    stage.setRect({
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    })
  }, [stage, an])

  useEffect(() => {
    const el = oRef.current
    if (el === null || an) return undefined

    let cuoi = ''
    const hen = (): void => {
      const r = el.getBoundingClientRect()
      const khoa = `${String(Math.round(r.left))},${String(Math.round(r.top))},${String(Math.round(r.width))},${String(Math.round(r.height))}`
      // Bỏ qua khi hình chữ nhật không đổi: việc phía bên kia là bố trí lại một
      // trang web sống, không hề rẻ.
      if (khoa === cuoi) return
      cuoi = khoa
      doVaBao()
    }

    // KHÔNG bọc trong `requestAnimationFrame`. Bản trước bọc, và cái giá là
    // trang nạp xong nhưng không vẽ ra: sân khấu nằm im ở `display: none` vì
    // lệnh hiện nó chờ một khung hình không bao giờ tới. Chromium ngừng cấp
    // khung hình cho cửa sổ nó cho là không ai nhìn, nên gửi một lệnh KHỞI TẠO
    // qua `requestAnimationFrame` là gửi một lệnh có thể không bao giờ chạy.
    //
    // Và không cần nó: `ResizeObserver` vốn đã phát tối đa một lần mỗi khung
    // hình, còn phép so hình chữ nhật ở trên đã chặn mọi lần gửi thừa.
    hen()
    const quanSat = new ResizeObserver(hen)
    quanSat.observe(el)
    window.addEventListener('resize', hen)
    // Cửa sổ app cuộn thì toạ độ khung nhìn đổi theo.
    window.addEventListener('scroll', hen, true)
    return () => {
      quanSat.disconnect()
      window.removeEventListener('resize', hen)
      window.removeEventListener('scroll', hen, true)
    }
  }, [an, doVaBao])

  const di = (event: React.FormEvent): void => {
    event.preventDefault()
    const url = chuanHoaUrl(nhap)
    if (url === undefined) return
    stage.navigate(paneId, url)
    setDangGo(false)
    // Trả bàn phím cho trang. Không có dòng này thì trang mới nạp xong nhưng
    // tiêu điểm vẫn nằm ở ô địa chỉ, và phím đầu tiên người dùng gõ — thường là
    // để cuộn hoặc để tìm trong trang — lại chui vào ô nhập.
    stage.focus(paneId)
  }

  return (
    <div className="hdw-browser" hidden={an}>
      <form className="hdw-navbar" onSubmit={di}>
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
          value={nhap}
          spellCheck={false}
          placeholder="Nhập địa chỉ trang web"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => { setNhap(event.target.value) }}
          onFocus={() => { setDangGo(true) }}
          onBlur={() => { setDangGo(false) }}
        />
      </form>
      {/* Trang web được vẽ đè lên ô này. Nó rỗng, và phải rỗng. */}
      <div className="hdw-slot" ref={oRef} aria-hidden />
    </div>
  )
}

/** Trạng thái ban đầu, có kể tới địa chỉ mở sẵn. */
function TRANG_TRONG_HOAC(url: string | undefined): TabStatus {
  return url === undefined ? TRANG_THAI_RONG : { ...TRANG_THAI_RONG, url, loading: true }
}
