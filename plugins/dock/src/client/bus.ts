/**
 * Đầu giao diện của cầu `/hdw/bus`: nhận lệnh từ nửa Node, làm, rồi trả lời.
 *
 * Sống ở tầng plugin (`apply()` của `client/index.tsx`), **không** ở trong
 * `DockPanel`. Lý do giống hệt lý do kho panel phải dựng ở tầng plugin: slot của
 * upstream có thể remount component bất cứ lúc nào, mà cầu remount là cầu chết —
 * và cái chết đó không báo gì, chỉ là từ lúc ấy agent nhờ gì cũng hết giờ.
 *
 * Bảng lệnh hiện chỉ có hai mục, đủ để chứng minh đường đi thông. Bộ lệnh thật
 * cho agent (bấm, gõ, đọc trang, chụp ảnh) là giai đoạn sau, và nó sẽ cần một
 * đường tới sân khấu webview — thứ mà tầng này chưa có.
 * @module
 */

import type { DockActions } from './store.ts'

/** Phải khớp `BUS_VERSION` ở `bus-routes.ts`. */
const BUS_VERSION = 2

/** Mã đóng nghĩa là "đừng nối lại". */
const CLOSE_FINAL = 4001

/** Chỉ reset bậc lùi sau khi kết nối đã sống đủ lâu để coi là lành. */
const HEALTHY_AFTER_MS = 10_000

/** Trần thời gian chờ giữa hai lần nối lại. */
const MAX_BACKOFF_MS = 30_000

/** Bảng lệnh: tên lệnh → việc phải làm. */
type CommandTable = Record<string, (params: unknown) => unknown>

/**
 * Dựng bảng lệnh.
 * @param actions - bộ hành động của kho panel.
 * @returns bảng lệnh cho cầu.
 */
function buildCommands(actions: DockActions): CommandTable {
  return {
    ping: () => ({ at: Date.now() }),

    /**
     * Mở một tab trình duyệt vào địa chỉ cho trước.
     *
     * Trả về `tab_id` và KHÔNG hứa "trang đã tải xong". `openPane` chỉ đẩy một
     * pane vào kho; thẻ webview do `BrowserPane` tạo ở lượt render sau, và trang
     * nạp sau nữa. Hứa quá tay ở đây là tool đầu tiên xây trên cầu này sẽ báo
     * thành công cho một địa chỉ trả về 404. Lệnh "chờ tải xong" thuộc giai đoạn
     * sau, cùng lúc với đường nối tới sân khấu webview.
     *
     * Rào địa chỉ KHÔNG nằm ở đây mà ở nửa Node: một rào mà bên bị chặn tự đặt
     * được thì không phải rào.
     */
    open_tab: (params) => {
      const url = (params as { url?: unknown } | null)?.url
      if (typeof url !== 'string' || url === '') throw new Error('thiếu tham số url')
      return { tab_id: actions.openPane('browser', url) }
    },
  }
}

/**
 * Nối vào cầu và giữ kết nối đó sống.
 * @param actions - bộ hành động của kho panel, để lệnh tác động lên các tab.
 * @returns hàm đóng cầu, gọi khi plugin gỡ.
 */
export function openBridge(actions: DockActions): () => void {
  const commands = buildCommands(actions)
  let socket: WebSocket | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let step = 0
  let stopped = false

  const connect = (): void => {
    if (stopped) return
    const url = new URL('/hdw/bus', location.href)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const openedAt = Date.now()
    const ws = new WebSocket(url)
    socket = ws

    ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', version: BUS_VERSION })) }

    ws.onmessage = (event: MessageEvent<unknown>) => {
      let frame: { t?: unknown, id?: unknown, cmd?: unknown, params?: unknown }
      try {
        frame = JSON.parse(String(event.data)) as typeof frame
      } catch {
        return
      }
      if (frame.t !== 'call' || typeof frame.id !== 'number') return
      const id = frame.id
      const command = commands[String(frame.cmd)]
      if (command === undefined) {
        ws.send(JSON.stringify({ t: 'error', id, reason: `không có lệnh "${String(frame.cmd)}"` }))
        return
      }
      // `Promise.resolve` bọc ngoài để lệnh đồng bộ và lệnh bất đồng bộ đi chung
      // một đường — và để một lệnh ném đồng bộ cũng thành `error` chứ không làm
      // đứt cả cầu.
      void Promise.resolve()
        .then(() => command(frame.params))
        .then(
          (result) => { ws.send(JSON.stringify({ t: 'done', id, result })) },
          (error: unknown) => {
            ws.send(JSON.stringify({ t: 'error', id, reason: error instanceof Error ? error.message : String(error) }))
          },
        )
    }

    ws.onclose = (event: CloseEvent) => {
      socket = undefined
      // Server đóng bằng mã riêng nghĩa là "đừng nối lại" (plugin đã gỡ, hoặc
      // lệch phiên bản giao thức). Nối lại vào một cầu đã tháo chính là thứ đẻ
      // ra bão kết nối.
      if (event.code === CLOSE_FINAL) { stopped = true; return }
      // Chỉ coi là lành khi kết nối đã sống đủ lâu. Reset bậc ngay lúc mở thì
      // trường hợp "server nhận rồi đóng ngay vì quá trần" thành vòng lặp chặt.
      if (Date.now() - openedAt > HEALTHY_AFTER_MS) step = 0
      scheduleReconnect()
    }

    // Không làm gì ở `onerror`: mọi đường hỏng đều kết thúc bằng `onclose`, và
    // nối lại ở cả hai chỗ là nối lại hai lần.
    ws.onerror = () => {}
  }

  /** Lùi theo cấp số nhân, có jitter đầy đủ. */
  const scheduleReconnect = (): void => {
    if (stopped || retryTimer !== undefined) return
    step += 1
    // Jitter không phải trang trí: thiếu nó thì hai cửa sổ app cùng mất mạng sẽ
    // nối lại đồng pha mãi mãi.
    const wait = Math.random() * Math.min(MAX_BACKOFF_MS, 500 * 2 ** step)
    retryTimer = setTimeout(() => { retryTimer = undefined; connect() }, wait)
  }

  connect()

  return () => {
    stopped = true
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    socket?.close()
    socket = undefined
  }
}
