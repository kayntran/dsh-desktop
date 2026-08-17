/**
 * Tab Terminal: một shell thật của Windows, hiện ngay trong panel.
 *
 * Màn hình do `@xterm/xterm` vẽ — cùng thư viện mà VS Code và hầu hết terminal
 * trong trình duyệt dùng. Nó lo phần khó: chuỗi thoát ANSI, màu, con trỏ, cuộn,
 * chọn chữ, chữ rộng hai ô của tiếng Trung/Nhật/Hàn. Tự viết lại phần đó là
 * hàng nghìn dòng và vẫn sai ở những chỗ ít ai nghĩ tới.
 *
 * **Vì sao terminal luôn nền tối, kể cả khi app đang ở chế độ sáng.** Bảng 16
 * màu ANSI (đỏ, xanh lá, vàng… mà `npm`, `git`, `dir` dùng) không có trong hệ
 * token của DeepSeek — họ chỉ có amber, blue, green, red, neutral, thiếu hẳn
 * cyan và magenta. Hai lối đi: tự bịa ra một bảng 16 màu, hoặc dùng bảng mặc
 * định của xterm. Bảng mặc định đó được thiết kế cho nền tối; đặt nó lên nền
 * trắng thì "trắng sáng" và "vàng sáng" gần như tàng hình. Nên chọn cách không
 * bịa màu nào: giữ mặt terminal tối bằng chính token `--dsw-static-*` của
 * upstream (chúng cố ý không đổi theo sáng/tối), còn khung viền quanh nó vẫn đi
 * theo chủ đề như mọi chỗ khác.
 * @module
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { Button, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

/** Số dòng giữ lại để cuộn ngược. */
const SCROLLBACK = 5000

type PtyState = 'opening' | 'live' | 'closed'

/**
 * Đọc một biến CSS đã tính toán xong. Trả về chuỗi rỗng nếu không có, để chỗ
 * gọi tự quyết định giá trị dự phòng.
 */
function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim()
}

export interface TerminalTabProps {
  /** Thư mục mở terminal — đường dẫn workspace, server sẽ xác thực lại. */
  root: string | undefined
  /** Đang bị che vì tab khác đang hiện. Không unmount, chỉ ẩn. */
  isHidden: boolean
}

/**
 * Thân tab Terminal.
 * @param props - xem {@link TerminalTabProps}.
 * @returns phần tử tab.
 */
export function TerminalTab({ root, isHidden }: TerminalTabProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | undefined>(undefined)
  const fitRef = useRef<FitAddon | undefined>(undefined)
  const wsRef = useRef<WebSocket | undefined>(undefined)
  const [state, setState] = useState<PtyState>('opening')
  const [note, setNote] = useState<string | undefined>(undefined)
  // Tăng lên để ép effect dựng lại toàn bộ phiên — đường duy nhất của nút "Mở lại".
  const [attempt, setAttempt] = useState(0)

  /** Đo lại kích thước rồi báo cho shell biết, để chữ xuống dòng đúng chỗ. */
  const refit = useCallback((): void => {
    const host = hostRef.current
    const term = termRef.current
    const fit = fitRef.current
    // Lúc đang bị ẩn thì phần tử có kích thước 0; đo lúc đó ra số vô nghĩa và
    // xterm sẽ vẽ lại cả màn hình theo số đó.
    if (host === null || term === undefined || fit === undefined) return
    if (host.clientWidth === 0 || host.clientHeight === 0) return
    fit.fit()
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }))
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (host === null || root === undefined) return undefined

    setState('opening')
    setNote(undefined)

    const term = new Terminal({
      scrollback: SCROLLBACK,
      cursorBlink: true,
      fontSize: 12,
      fontFamily: cssVar(document.documentElement, '--ds-font-family-code')
        || 'ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace',
      theme: {
        background: cssVar(host, '--hdw-term-bg'),
        foreground: cssVar(host, '--hdw-term-fg'),
        cursor: cssVar(host, '--hdw-term-fg'),
        selectionBackground: cssVar(host, '--hdw-term-sel'),
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    termRef.current = term
    fitRef.current = fit
    if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit()

    const url = new URL('/hdw/pty', location.href)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('cwd', root)
    url.searchParams.set('cols', String(term.cols))
    url.searchParams.set('rows', String(term.rows))

    const ws = new WebSocket(url)
    // Byte thô, không để trình duyệt tự giải mã: một ký tự UTF-8 có thể bị cắt
    // đôi giữa hai gói tin, và xterm mới là chỗ biết ghép lại cho đúng.
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onmessage = (event: MessageEvent<unknown>) => {
      // Khung nhị phân là màn hình; khung văn bản là lệnh điều khiển. Tách theo
      // loại khung nên không chuỗi nào của người dùng bị hiểu nhầm thành lệnh.
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data))
        return
      }
      if (typeof event.data !== 'string') return
      let msg: { t?: string, exitCode?: number, reason?: string }
      try {
        msg = JSON.parse(event.data) as typeof msg
      } catch {
        return
      }
      if (msg.t === 'ready') { setState('live'); return }
      if (msg.t === 'error') { setState('closed'); setNote(msg.reason); return }
      if (msg.t === 'exit') {
        setState('closed')
        setNote(`Shell exited (code ${String(msg.exitCode ?? 0)}).`)
      }
    }

    ws.onerror = () => {
      setState('closed')
      setNote('Lost the connection to the engine.')
    }

    ws.onclose = () => {
      // Đã có lời giải thích cụ thể từ `exit`/`error` thì giữ nguyên, đừng đè
      // lên bằng một câu chung chung hơn.
      setState('closed')
      setNote((prev) => prev ?? 'The terminal session closed.')
    }

    const onInput = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(data))
    })

    // Panel đổi bề rộng, cửa sổ đổi kích thước, tab hiện trở lại — cả ba đều
    // qua đây.
    const observer = new ResizeObserver(() => { refit() })
    observer.observe(host)

    return () => {
      observer.disconnect()
      onInput.dispose()
      // Gỡ tay nghe trước khi đóng, nếu không `onclose` sẽ setState lên một
      // component đã tháo.
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      ws.close()
      term.dispose()
      wsRef.current = undefined
      termRef.current = undefined
      fitRef.current = undefined
    }
  }, [root, attempt, refit])

  // Từ ẩn chuyển sang hiện: phần tử vừa có kích thước trở lại, phải đo lại.
  // Đợi một khung hình để trình duyệt kịp bố trí xong.
  useEffect(() => {
    if (isHidden) return undefined
    const id = requestAnimationFrame(() => { refit() })
    return () => { cancelAnimationFrame(id) }
  }, [isHidden, refit])

  // `hidden` ở đây không phải cẩn thận thừa: component này KHÔNG bị tháo khi
  // chuyển tab, nên thiếu nó thì dòng thông báo của Terminal sẽ nằm chình ình
  // giữa tab Files.
  if (root === undefined) {
    return <div className="hdw-empty" hidden={isHidden}>No session is open yet, so there is no folder to start a terminal in. Start a session and come back.</div>
  }

  return (
    <div className="hdw-termwrap" hidden={isHidden}>
      {state === 'closed' && (
        <div className="hdw-termbar">
          <span className="hdw-note">{note ?? 'The terminal session closed.'}</span>
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefreshOutline16 />}
            onClick={() => { setAttempt((n) => n + 1) }}
          >
            Reopen
          </Button>
        </div>
      )}
      <div className="hdw-term" ref={hostRef} />
    </div>
  )
}
