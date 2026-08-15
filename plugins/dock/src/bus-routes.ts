/**
 * Cầu nối giữa nửa Node của plugin và nửa giao diện: WebSocket `/hdw/bus`.
 *
 * Vì sao cần: tool của agent sẽ chạy ở nửa Node (trong tiến trình engine), còn
 * trang web thì sống trong nửa giao diện (trong cửa sổ app). Hai nơi đó không
 * gọi thẳng nhau được. Cầu này cho nửa Node **nhờ** nửa giao diện làm một việc
 * rồi chờ kết quả.
 *
 * Chiều gọi là **một chiều**: Node hỏi, giao diện trả lời. Giao diện không tự
 * bắt Node làm gì.
 *
 * ## Ai lái khi có nhiều cửa sổ nối vào
 *
 * **Cái nối đầu tiên, và giữ vô lăng cho tới khi socket của nó đóng.**
 *
 * Không phải "cái mới nhất lái", dù nghe tự nhiên hơn. Lý do: `isTrustedRequest`
 * là rào chống trang web lạ và tiện ích trình duyệt, **không phải xác thực** —
 * bất kỳ tab Chrome nào mở `http://127.0.0.1:<cổng>` cũng qua được nó. Với luật
 * "mới nhất lái", một tab lạc như vậy cướp vô lăng ngay khi nó nối, và từ giây
 * đó agent mở trang trong một cửa sổ Chrome mà người dùng không nhìn, còn app
 * thì im lặng. Luật "đầu tiên và dính" cũng sống sót qua một lần F5 (client mới
 * chỉ nhận vô lăng sau khi cái cũ chết) và không đánh nhau với việc tự nối lại
 * bên giao diện.
 *
 * ## Giao thức
 *
 * Chỉ JSON, không có khung nhị phân.
 *
 *   Node → giao diện:  { t: 'goi',  id, lenh, tham_so }
 *   giao diện → Node:  { t: 'xong', id, ket_qua }
 *                      { t: 'loi',  id, ly_do }
 *   giao diện → Node:  { t: 'chao', phien_ban }     (khung đầu tiên, bắt buộc)
 * @module
 */

import type { Duplex } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { WebSocketServer, type WebSocket } from 'ws'
import { batBuocUrlCongCong } from './net-policy.js'
import { isTrustedRequest } from './trust.js'

/**
 * Phiên bản giao thức. Tăng khi đổi hình dạng thông điệp.
 *
 * Cần nó vì `npm run dev` nạp lại nửa Node mà trang trong cửa sổ thì không nạp
 * lại — hai bản khác nhau nói chuyện với nhau, và triệu chứng là những lỗi vô
 * nghĩa ở tận đâu. Lệch phiên bản thì từ chối ngay, nói rõ lý do.
 */
export const PHIEN_BAN_BUS = 1

/**
 * Trần số kết nối. Lý do y như `MAX_TERMINALS` của `pty-routes.ts`: chặn một
 * giao diện rơi vào vòng lặp nối lại làm engine ngập kết nối.
 */
const MAX_CLIENT = 4

/** Trần số lệnh đang chờ trả lời, chặn bên gọi làm phình bảng chờ vô hạn. */
const MAX_DANG_CHO = 64

/** Trần số khung rác một client được phép gửi trước khi bị đóng. */
const MAX_KHUNG_RAC = 20

/** Khung tối đa. Mặc định của `ws` là 100MB — quá rộng cho một cầu chỉ chở JSON. */
const MAX_BYTE_KHUNG = 1024 * 1024

/** Nhịp tim, để phát hiện socket nửa sống (laptop ngủ dậy). */
const NHIP_TIM_MS = 15_000

/** Mã đóng riêng, báo cho giao diện biết ĐỪNG nối lại. */
const MA_DONG_HAN = 4001

/** Bề mặt mà tầng tool sẽ dùng. */
export interface Bus {
  /**
   * Nhờ nửa giao diện làm một việc rồi chờ kết quả.
   * @param lenh - tên lệnh trong bảng lệnh của giao diện.
   * @param tham_so - tham số của lệnh.
   * @param hetGio - TỔNG ngân sách, đã gồm cả thời gian chờ có cửa sổ nối vào.
   * @returns kết quả do giao diện trả về.
   */
  goi: (lenh: string, tham_so: unknown, hetGio?: number) => Promise<unknown>
  /** Có cửa sổ nào đang cầm vô lăng không. */
  coTaiXe: () => boolean
}

interface DangCho {
  xong: (ket_qua: unknown) => void
  hong: (loi: Error) => void
  dongHo: NodeJS.Timeout
}

/** Trả lời một lời nâng cấp bị từ chối rồi đóng socket. */
function tuChoi(socket: Duplex, status: number, ly_do: string): void {
  socket.write(`HTTP/1.1 ${String(status)} ${ly_do}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

/** Trả lời JSON, cùng khuôn với `fs-routes.ts`. */
function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(text)),
  })
  res.end(text)
}

/**
 * Mở cầu `/hdw/bus`.
 * @param ctx - context của plugin; cần `webServer`.
 * @returns bề mặt cho tầng tool, và hàm dọn.
 */
export function registerBusRoutes(ctx: Context): { bus: Bus, dispose: () => void } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTE_KHUNG })
  const client = new Set<WebSocket>()
  const dangCho = new Map<number, DangCho>()
  const doiTaiXe: Array<() => void> = []
  let taiXe: WebSocket | undefined
  let idKe = 0

  /** Ai lái: cái đầu tiên còn sống. Xem chú thích đầu file. */
  const chonTaiXe = (): void => {
    if (taiXe !== undefined && client.has(taiXe) && taiXe.readyState === taiXe.OPEN) return
    taiXe = [...client].find((ws) => ws.readyState === ws.OPEN)
    if (taiXe !== undefined) {
      // Đánh thức mọi lời gọi đang nằm chờ một cửa sổ.
      while (doiTaiXe.length > 0) doiTaiXe.shift()?.()
    }
  }

  /**
   * Kết thúc một lệnh đang chờ.
   *
   * XOÁ khỏi bảng và tắt đồng hồ TRƯỚC khi settle, không phải sau. Làm ngược thì
   * một câu trả lời tới muộn, hay tới hai lần cùng một `id`, vẫn settle được lần
   * thứ hai — và một Promise settle hai lần là loại lỗi không để lại dấu vết nào.
   */
  const ketThuc = (id: number, ok: boolean, gia_tri: unknown): void => {
    const cho = dangCho.get(id)
    // `id` lạ, `id` trùng, hoặc trả lời sau khi đã hết giờ: bỏ im lặng. Không
    // log ồn — một client rác sẽ biến log thành bãi rác.
    if (cho === undefined) return
    dangCho.delete(id)
    clearTimeout(cho.dongHo)
    if (ok) cho.xong(gia_tri)
    else cho.hong(gia_tri instanceof Error ? gia_tri : new Error(String(gia_tri)))
  }

  /** Huỷ mọi lệnh đang chờ, dùng khi tài xế đứt hoặc plugin bị gỡ. */
  const huyHet = (ly_do: string): void => {
    for (const id of [...dangCho.keys()]) ketThuc(id, false, new Error(ly_do))
  }

  const nhanKhung = (ws: WebSocket, data: unknown, isBinary: boolean): boolean => {
    // Cầu này không có kênh nhị phân. Khung nhị phân là rác theo định nghĩa.
    if (isBinary) return false
    let msg: unknown
    try {
      msg = JSON.parse(String(data))
    } catch {
      return false
    }
    if (typeof msg !== 'object' || msg === null) return false
    const khung = msg as { t?: unknown, id?: unknown, ket_qua?: unknown, ly_do?: unknown, phien_ban?: unknown }

    if (khung.t === 'chao') {
      if (khung.phien_ban !== PHIEN_BAN_BUS) {
        ws.close(MA_DONG_HAN, `bus phiên bản ${String(PHIEN_BAN_BUS)}, cửa sổ đang chạy bản khác — hãy tải lại trang`)
        return true
      }
      return true
    }
    if (typeof khung.id !== 'number') return false
    if (khung.t === 'xong') { ketThuc(khung.id, true, khung.ket_qua); return true }
    if (khung.t === 'loi') { ketThuc(khung.id, false, new Error(String(khung.ly_do ?? 'giao diện báo lỗi'))); return true }
    return false
  }

  const nhanClient = (ws: WebSocket): void => {
    client.add(ws)
    chonTaiXe()

    let rac = 0
    let conSong = true
    ws.on('pong', () => { conSong = true })
    // Nhịp tim: một laptop ngủ dậy để lại socket nửa sống — `readyState` vẫn
    // OPEN, gửi vào không lỗi, và mọi lệnh sẽ chết vì hết giờ thay vì hỏng ngay.
    const tim = setInterval(() => {
      if (!conSong) { ws.terminate(); return }
      conSong = false
      ws.ping()
    }, NHIP_TIM_MS)
    tim.unref()

    ws.on('message', (data, isBinary) => {
      if (nhanKhung(ws, data, isBinary)) return
      rac += 1
      if (rac >= MAX_KHUNG_RAC) ws.close(MA_DONG_HAN, 'quá nhiều khung không hợp lệ')
    })

    ws.on('close', () => {
      clearInterval(tim)
      client.delete(ws)
      if (taiXe === ws) {
        taiXe = undefined
        // Cửa sổ đứt giữa chừng (thường là người dùng tải lại trang): huỷ NGAY
        // mọi lệnh đang chờ thay vì để chúng treo tới hết giờ. Câu trả lời "cửa
        // sổ đã đóng" ngay lập tức có ích hơn một khoảng im lặng 20 giây.
        huyHet('cửa sổ app đã đóng hoặc tải lại giữa chừng')
      }
      chonTaiXe()
    })
  }

  const off = ctx.webServer.registerUpgrade({
    path: '/hdw/bus',
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!isTrustedRequest(req)) { tuChoi(socket, 403, 'Forbidden'); return }
      if (client.size >= MAX_CLIENT) { tuChoi(socket, 429, 'Too Many Bus Clients'); return }
      wss.handleUpgrade(req, socket, head, (ws) => { nhanClient(ws) })
    },
  })

  const bus: Bus = {
    coTaiXe: () => taiXe !== undefined && taiXe.readyState === taiXe.OPEN,

    goi: async (lenh, tham_so, hetGio = 20_000) => {
      if (dangCho.size >= MAX_DANG_CHO) {
        throw new Error(`quá ${String(MAX_DANG_CHO)} lệnh đang chờ giao diện trả lời`)
      }
      const han = Date.now() + hetGio

      // Chờ có cửa sổ nối vào. `hetGio` là TỔNG ngân sách người gọi thấy: chờ
      // nối và chờ trả lời dùng chung một đồng hồ, không cộng dồn hai cái.
      if (!bus.coTaiXe()) {
        await new Promise<void>((resolve) => {
          const dongHo = setTimeout(() => {
            const i = doiTaiXe.indexOf(resolve)
            if (i !== -1) doiTaiXe.splice(i, 1)
            resolve()
          }, Math.max(0, han - Date.now()))
          dongHo.unref()
          doiTaiXe.push(() => { clearTimeout(dongHo); resolve() })
        })
      }
      const lai = taiXe
      if (lai === undefined || lai.readyState !== lai.OPEN) {
        throw new Error('chưa có cửa sổ app nào mở, nên không có trình duyệt để điều khiển')
      }

      const conLai = han - Date.now()
      if (conLai <= 0) throw new Error(`hết giờ ${String(hetGio)}ms khi chờ cửa sổ app`)

      idKe += 1
      const id = idKe
      return new Promise((resolve, reject) => {
        const dongHo = setTimeout(() => {
          ketThuc(id, false, new Error(`lệnh "${lenh}" quá ${String(hetGio)}ms không có trả lời`))
        }, conLai)
        dongHo.unref()
        dangCho.set(id, { xong: resolve, hong: reject, dongHo })
        lai.send(JSON.stringify({ t: 'goi', id, lenh, tham_so }))
      })
    },
  }

  /**
   * Route chẩn đoán `/hdw/bus/thu` — cầu còn sống không.
   *
   * Cần nó vì bài kiểm chạy ở một tiến trình khác engine, không nhìn được vào
   * bộ nhớ của cầu. Không có nó thì không có cách nào biết cầu hỏng, ngoài việc
   * chờ một tool nào đó im lặng thất bại.
   *
   * Ba chốt chống biến nó thành bộ khuếch đại: gộp mọi lời hỏi đang bay thành
   * MỘT `ping` (single-flight), hết giờ ngắn riêng, và không trả gì ngoài hai
   * trường dưới đây — thêm số client hay địa chỉ vào là bắt đầu rò thông tin.
   *
   * `?mo=<url>` chạy trọn đường của lệnh `mo_trang`, gồm cả rào địa chỉ. Đây là
   * đường DUY NHẤT hiện có để kiểm rào đó từ ngoài; tầng tool sau này gọi thẳng
   * `bus.goi`, không đi qua route này.
   */
  let dangPing: Promise<number> | undefined
  const offThu = ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/bus/thu',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!isTrustedRequest(req)) { json(res, 403, { ly_do: 'request không qua được rào tin cậy' }); return }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')

      const mo = url.searchParams.get('mo')
      if (mo !== null) {
        let dich: URL
        try {
          dich = batBuocUrlCongCong(mo)
        } catch (error) {
          json(res, 400, { ly_do: error instanceof Error ? error.message : String(error) })
          return
        }
        try {
          const ket_qua = await bus.goi('mo_trang', { url: dich.toString() }, 8000)
          json(res, 200, { ok: true, ket_qua })
        } catch (error) {
          json(res, 503, { ly_do: error instanceof Error ? error.message : String(error) })
        }
        return
      }

      if (!bus.coTaiXe()) { json(res, 200, { noi_ket: false }); return }
      dangPing ??= (async () => {
        const bat_dau = Date.now()
        await bus.goi('ping', undefined, 2000)
        return Date.now() - bat_dau
      })().finally(() => { dangPing = undefined })
      try {
        json(res, 200, { noi_ket: true, tre_ms: await dangPing })
      } catch (error) {
        json(res, 200, { noi_ket: false, ly_do: error instanceof Error ? error.message : String(error) })
      }
    },
  })

  return {
    bus,
    dispose: () => {
      off()
      offThu()
      huyHet('plugin đã gỡ')
      // `wss.close()` với `noServer: true` KHÔNG đóng những client đã nhận —
      // phải tự đi đóng từng cái, nếu không engine giữ socket sống mãi.
      for (const ws of client) ws.close(MA_DONG_HAN, 'plugin đã gỡ')
      client.clear()
      taiXe = undefined
      wss.close()
    },
  }
}
