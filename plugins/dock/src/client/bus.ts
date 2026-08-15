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

/** Phải khớp `PHIEN_BAN_BUS` ở `bus-routes.ts`. */
const PHIEN_BAN_BUS = 1

/** Mã đóng nghĩa là "đừng nối lại". */
const MA_DONG_HAN = 4001

/** Chỉ reset bậc lùi sau khi kết nối đã sống đủ lâu để coi là lành. */
const SONG_LA_LANH_MS = 10_000

/** Trần thời gian chờ giữa hai lần nối lại. */
const LUI_TOI_DA_MS = 30_000

/** Bảng lệnh: tên lệnh → việc phải làm. */
type BangLenh = Record<string, (tham_so: unknown) => unknown>

/**
 * Dựng bảng lệnh.
 * @param actions - bộ hành động của kho panel.
 * @returns bảng lệnh cho cầu.
 */
function dungBangLenh(actions: DockActions): BangLenh {
  return {
    ping: () => ({ luc: Date.now() }),

    /**
     * Mở một tab trình duyệt vào địa chỉ cho trước.
     *
     * Trả về `pane_id` và KHÔNG hứa "trang đã tải xong". `openPane` chỉ đẩy một
     * pane vào kho; thẻ webview do `BrowserPane` tạo ở lượt render sau, và trang
     * nạp sau nữa. Hứa quá tay ở đây là tool đầu tiên xây trên cầu này sẽ báo
     * thành công cho một địa chỉ trả về 404. Lệnh "chờ tải xong" thuộc giai đoạn
     * sau, cùng lúc với đường nối tới sân khấu webview.
     *
     * Rào địa chỉ KHÔNG nằm ở đây mà ở nửa Node: một rào mà bên bị chặn tự đặt
     * được thì không phải rào.
     */
    mo_trang: (tham_so) => {
      const url = (tham_so as { url?: unknown } | null)?.url
      if (typeof url !== 'string' || url === '') throw new Error('thiếu tham số url')
      return { pane_id: actions.openPane('browser', url) }
    },
  }
}

/**
 * Nối vào cầu và giữ kết nối đó sống.
 * @param actions - bộ hành động của kho panel, để lệnh tác động lên các tab.
 * @returns hàm đóng cầu, gọi khi plugin gỡ.
 */
export function moCau(actions: DockActions): () => void {
  const bang = dungBangLenh(actions)
  let ws: WebSocket | undefined
  let hen: ReturnType<typeof setTimeout> | undefined
  let bac = 0
  let dungHan = false

  const noi = (): void => {
    if (dungHan) return
    const url = new URL('/hdw/bus', location.href)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const luc_mo = Date.now()
    const s = new WebSocket(url)
    ws = s

    s.onopen = () => { s.send(JSON.stringify({ t: 'chao', phien_ban: PHIEN_BAN_BUS })) }

    s.onmessage = (event: MessageEvent<unknown>) => {
      let khung: { t?: unknown, id?: unknown, lenh?: unknown, tham_so?: unknown }
      try {
        khung = JSON.parse(String(event.data)) as typeof khung
      } catch {
        return
      }
      if (khung.t !== 'goi' || typeof khung.id !== 'number') return
      const id = khung.id
      const viec = bang[String(khung.lenh)]
      if (viec === undefined) {
        s.send(JSON.stringify({ t: 'loi', id, ly_do: `không có lệnh "${String(khung.lenh)}"` }))
        return
      }
      // `Promise.resolve` bọc ngoài để lệnh đồng bộ và lệnh bất đồng bộ đi chung
      // một đường — và để một lệnh ném đồng bộ cũng thành `loi` chứ không làm
      // đứt cả cầu.
      void Promise.resolve()
        .then(() => viec(khung.tham_so))
        .then(
          (ket_qua) => { s.send(JSON.stringify({ t: 'xong', id, ket_qua })) },
          (loi: unknown) => {
            s.send(JSON.stringify({ t: 'loi', id, ly_do: loi instanceof Error ? loi.message : String(loi) }))
          },
        )
    }

    s.onclose = (event: CloseEvent) => {
      ws = undefined
      // Server đóng bằng mã riêng nghĩa là "đừng nối lại" (plugin đã gỡ, hoặc
      // lệch phiên bản giao thức). Nối lại vào một cầu đã tháo chính là thứ đẻ
      // ra bão kết nối.
      if (event.code === MA_DONG_HAN) { dungHan = true; return }
      // Chỉ coi là lành khi kết nối đã sống đủ lâu. Reset bậc ngay lúc mở thì
      // trường hợp "server nhận rồi đóng ngay vì quá trần" thành vòng lặp chặt.
      if (Date.now() - luc_mo > SONG_LA_LANH_MS) bac = 0
      henNoiLai()
    }

    // Không làm gì ở `onerror`: mọi đường hỏng đều kết thúc bằng `onclose`, và
    // nối lại ở cả hai chỗ là nối lại hai lần.
    s.onerror = () => {}
  }

  /** Lùi theo cấp số nhân, có jitter đầy đủ. */
  const henNoiLai = (): void => {
    if (dungHan || hen !== undefined) return
    bac += 1
    // Jitter không phải trang trí: thiếu nó thì hai cửa sổ app cùng mất mạng sẽ
    // nối lại đồng pha mãi mãi.
    const cho = Math.random() * Math.min(LUI_TOI_DA_MS, 500 * 2 ** bac)
    hen = setTimeout(() => { hen = undefined; noi() }, cho)
  }

  noi()

  return () => {
    dungHan = true
    if (hen !== undefined) clearTimeout(hen)
    ws?.close()
    ws = undefined
  }
}
