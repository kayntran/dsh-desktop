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
 *   Node → giao diện:  { t: 'call',  id, cmd, params }
 *   giao diện → Node:  { t: 'done',  id, result }
 *                      { t: 'error', id, reason }
 *   giao diện → Node:  { t: 'hello', version }      (khung đầu tiên, bắt buộc)
 * @module
 */

import type { Duplex } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { WebSocketServer, type WebSocket } from 'ws'
import { assertPublicUrl } from './net-policy.js'
import { isTrustedRequest } from './trust.js'

/**
 * Phiên bản giao thức. Tăng khi đổi hình dạng thông điệp.
 *
 * Cần nó vì `npm run dev` nạp lại nửa Node mà trang trong cửa sổ thì không nạp
 * lại — hai bản khác nhau nói chuyện với nhau, và triệu chứng là những lỗi vô
 * nghĩa ở tận đâu. Lệch phiên bản thì từ chối ngay, nói rõ lý do.
 */
export const BUS_VERSION = 2

/**
 * Trần số kết nối. Lý do y như `MAX_TERMINALS` của `pty-routes.ts`: chặn một
 * giao diện rơi vào vòng lặp nối lại làm engine ngập kết nối.
 */
const MAX_CLIENTS = 4

/** Trần số lệnh đang chờ trả lời, chặn bên gọi làm phình bảng chờ vô hạn. */
const MAX_PENDING = 64

/** Trần số khung rác một client được phép gửi trước khi bị đóng. */
const MAX_JUNK_FRAMES = 20

/** Khung tối đa. Mặc định của `ws` là 100MB — quá rộng cho một cầu chỉ chở JSON. */
const MAX_FRAME_BYTES = 1024 * 1024

/** Nhịp tim, để phát hiện socket nửa sống (laptop ngủ dậy). */
const HEARTBEAT_MS = 15_000

/** Mã đóng riêng, báo cho giao diện biết ĐỪNG nối lại. */
const CLOSE_FINAL = 4001

/**
 * Những lệnh chỉ ĐỌC — luôn chạy được, kể cả khi công tắc quyền đang tắt.
 *
 * Bịt mắt agent không ngăn được nó hành động, chỉ làm nó hành động mù.
 *
 * Danh sách nằm ở đây, ngay trong `call`, chứ không ở tầng tool. Lý do: tầng
 * tool không phải đường duy nhất tới cầu — route chẩn đoán cũng gọi thẳng vào.
 * Hai đường mà hai luật thì sớm muộn một đường bị quên, và cái bị quên luôn là
 * đường ít ai nhìn. Một chốt duy nhất thì không quên được.
 */
const READ_COMMANDS = new Set([
  'ping', 'tabs_list', 'read_page', 'find', 'get_page_text', 'console_log', 'network_log',
  // Chụp ảnh là ĐỌC: nó không đổi gì trên trang. Hai lệnh này chỉ dựng điều
  // kiện để chụp rồi trả màn hình về chỗ cũ. Thiếu chúng ở đây thì tắt công tắc
  // là mất luôn ảnh chụp — trong khi mô tả tool nói ảnh luôn chụp được, và cái
  // sai lệch đó chỉ lộ ra khi có người thật đi tắt công tắc.
  'shot_prepare', 'shot_done',
])

/** Câu từ chối khi công tắc tắt — nói rõ bật lại ở đâu. */
const DENIED
  = 'Công tắc "Cho agent điều khiển trình duyệt" đang TẮT, nên thao tác bị từ chối. '
  + 'Người dùng bật lại ở Cài đặt → General. Các lệnh ĐỌC trang vẫn chạy bình thường.'

/** Bề mặt mà tầng tool sẽ dùng. */
export interface Bus {
  /**
   * Nhờ nửa giao diện làm một việc rồi chờ kết quả.
   * @param cmd - tên lệnh trong bảng lệnh của giao diện.
   * @param params - tham số của lệnh.
   * @param timeoutMs - TỔNG ngân sách, đã gồm cả thời gian chờ có cửa sổ nối vào.
   * @returns kết quả do giao diện trả về.
   */
  call: (cmd: string, params: unknown, timeoutMs?: number) => Promise<unknown>
  /** Có cửa sổ nào đang cầm vô lăng không. */
  hasDriver: () => boolean
  /**
   * Người dùng có cho agent THAO TÁC trên trang không (bấm, gõ, cuộn, điền form).
   *
   * Đọc là luôn được, kể cả khi tắt: bịt mắt agent không ngăn được nó hành
   * động, chỉ làm nó hành động mù.
   *
   * Giá trị sống ở ĐÂY, nửa Node — nơi tool thật sự chạy. Giao diện chỉ là chỗ
   * người dùng bấm và chỗ lưu giữa các lần mở app; nó đẩy giá trị sang mỗi lần
   * nối cầu và mỗi lần người dùng đổi. Một rào mà bên bị chặn tự gỡ được thì
   * không phải rào.
   *
   * Mặc định `true`, theo lựa chọn của chủ dự án.
   */
  agentControl: () => boolean
}

interface Pending {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/** Trả lời một lời nâng cấp bị từ chối rồi đóng socket. */
function refuse(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\n\r\n`)
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
export function registerBusRoutes(
  ctx: Context,
  captureShot?: (webContentsId: number) => Promise<{ width: number, height: number, data: string }>,
): { bus: Bus, dispose: () => void } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })
  const clients = new Set<WebSocket>()
  const pending = new Map<number, Pending>()
  const driverWaiters: Array<() => void> = []
  let driver: WebSocket | undefined
  let nextId = 0
  let agentControl = true

  /** Ai lái: cái đầu tiên còn sống. Xem chú thích đầu file. */
  const pickDriver = (): void => {
    if (driver !== undefined && clients.has(driver) && driver.readyState === driver.OPEN) return
    driver = [...clients].find((ws) => ws.readyState === ws.OPEN)
    if (driver !== undefined) {
      // Đánh thức mọi lời gọi đang nằm chờ một cửa sổ.
      while (driverWaiters.length > 0) driverWaiters.shift()?.()
    }
  }

  /**
   * Kết thúc một lệnh đang chờ.
   *
   * XOÁ khỏi bảng và tắt đồng hồ TRƯỚC khi settle, không phải sau. Làm ngược thì
   * một câu trả lời tới muộn, hay tới hai lần cùng một `id`, vẫn settle được lần
   * thứ hai — và một Promise settle hai lần là loại lỗi không để lại dấu vết nào.
   */
  const settle = (id: number, ok: boolean, value: unknown): void => {
    const entry = pending.get(id)
    // `id` lạ, `id` trùng, hoặc trả lời sau khi đã hết giờ: bỏ im lặng. Không
    // log ồn — một client rác sẽ biến log thành bãi rác.
    if (entry === undefined) return
    pending.delete(id)
    clearTimeout(entry.timer)
    if (ok) entry.resolve(value)
    else entry.reject(value instanceof Error ? value : new Error(String(value)))
  }

  /** Huỷ mọi lệnh đang chờ, dùng khi tài xế đứt hoặc plugin bị gỡ. */
  const failAll = (reason: string): void => {
    for (const id of [...pending.keys()]) settle(id, false, new Error(reason))
  }

  const handleFrame = (ws: WebSocket, data: unknown, isBinary: boolean): boolean => {
    // Cầu này không có kênh nhị phân. Khung nhị phân là rác theo định nghĩa.
    if (isBinary) return false
    let msg: unknown
    try {
      msg = JSON.parse(String(data))
    } catch {
      return false
    }
    if (typeof msg !== 'object' || msg === null) return false
    const frame = msg as {
      t?: unknown, id?: unknown, result?: unknown, reason?: unknown
      version?: unknown, agentControl?: unknown
    }

    if (frame.t === 'hello') {
      if (frame.version !== BUS_VERSION) {
        ws.close(CLOSE_FINAL, `bus phiên bản ${String(BUS_VERSION)}, cửa sổ đang chạy bản khác — hãy tải lại trang`)
        return true
      }
      // Cửa sổ mang theo trạng thái công tắc mà người dùng đã lưu.
      if (typeof frame.agentControl === 'boolean') agentControl = frame.agentControl
      return true
    }

    // Người dùng vừa gạt công tắc trong Cài đặt. Khung này đi ngược chiều thông
    // thường của cầu (giao diện → Node, không phải trả lời một lời gọi), nên nó
    // không có `id`.
    if (frame.t === 'agent-control') {
      if (typeof frame.agentControl === 'boolean') agentControl = frame.agentControl
      return true
    }
    if (typeof frame.id !== 'number') return false
    if (frame.t === 'done') { settle(frame.id, true, frame.result); return true }
    if (frame.t === 'error') { settle(frame.id, false, new Error(String(frame.reason ?? 'giao diện báo lỗi'))); return true }
    return false
  }

  const acceptClient = (ws: WebSocket): void => {
    clients.add(ws)
    pickDriver()

    let junk = 0
    let alive = true
    ws.on('pong', () => { alive = true })
    // Nhịp tim: một laptop ngủ dậy để lại socket nửa sống — `readyState` vẫn
    // OPEN, gửi vào không lỗi, và mọi lệnh sẽ chết vì hết giờ thay vì hỏng ngay.
    const heart = setInterval(() => {
      if (!alive) { ws.terminate(); return }
      alive = false
      ws.ping()
    }, HEARTBEAT_MS)
    heart.unref()

    ws.on('message', (data, isBinary) => {
      if (handleFrame(ws, data, isBinary)) return
      junk += 1
      if (junk >= MAX_JUNK_FRAMES) ws.close(CLOSE_FINAL, 'quá nhiều khung không hợp lệ')
    })

    ws.on('close', () => {
      clearInterval(heart)
      clients.delete(ws)
      if (driver === ws) {
        driver = undefined
        // Cửa sổ đứt giữa chừng (thường là người dùng tải lại trang): huỷ NGAY
        // mọi lệnh đang chờ thay vì để chúng treo tới hết giờ. Câu trả lời "cửa
        // sổ đã đóng" ngay lập tức có ích hơn một khoảng im lặng 20 giây.
        failAll('cửa sổ app đã đóng hoặc tải lại giữa chừng')
      }
      pickDriver()
    })
  }

  const off = ctx.webServer.registerUpgrade({
    path: '/hdw/bus',
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!isTrustedRequest(req)) { refuse(socket, 403, 'Forbidden'); return }
      if (clients.size >= MAX_CLIENTS) { refuse(socket, 429, 'Too Many Bus Clients'); return }
      wss.handleUpgrade(req, socket, head, (ws) => { acceptClient(ws) })
    },
  })

  const bus: Bus = {
    hasDriver: () => driver !== undefined && driver.readyState === driver.OPEN,
    agentControl: () => agentControl,

    call: async (cmd, params, timeoutMs = 20_000) => {
      if (!READ_COMMANDS.has(cmd) && !agentControl) throw new Error(DENIED)
      if (pending.size >= MAX_PENDING) {
        throw new Error(`quá ${String(MAX_PENDING)} lệnh đang chờ giao diện trả lời`)
      }
      const deadline = Date.now() + timeoutMs

      // Chờ có cửa sổ nối vào. `timeoutMs` là TỔNG ngân sách người gọi thấy: chờ
      // nối và chờ trả lời dùng chung một đồng hồ, không cộng dồn hai cái.
      if (!bus.hasDriver()) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            const i = driverWaiters.indexOf(resolve)
            if (i !== -1) driverWaiters.splice(i, 1)
            resolve()
          }, Math.max(0, deadline - Date.now()))
          timer.unref()
          driverWaiters.push(() => { clearTimeout(timer); resolve() })
        })
      }
      const target = driver
      if (target === undefined || target.readyState !== target.OPEN) {
        throw new Error('chưa có cửa sổ app nào mở, nên không có trình duyệt để điều khiển')
      }

      const left = deadline - Date.now()
      if (left <= 0) throw new Error(`hết giờ ${String(timeoutMs)}ms khi chờ cửa sổ app`)

      nextId += 1
      const id = nextId
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          settle(id, false, new Error(`lệnh "${cmd}" quá ${String(timeoutMs)}ms không có trả lời`))
        }, left)
        timer.unref()
        pending.set(id, { resolve, reject, timer })
        target.send(JSON.stringify({ t: 'call', id, cmd, params }))
      })
    },
  }

  /**
   * Route chẩn đoán `/hdw/bus/probe` — cầu còn sống không.
   *
   * Cần nó vì bài kiểm chạy ở một tiến trình khác engine, không nhìn được vào
   * bộ nhớ của cầu. Không có nó thì không có cách nào biết cầu hỏng, ngoài việc
   * chờ một tool nào đó im lặng thất bại.
   *
   * Ba chốt chống biến nó thành bộ khuếch đại: gộp mọi lời hỏi đang bay thành
   * MỘT `ping` (single-flight), hết giờ ngắn riêng, và không trả gì ngoài hai
   * trường dưới đây — thêm số client hay địa chỉ vào là bắt đầu rò thông tin.
   *
   * `?open=<url>` chạy trọn đường của lệnh `open_tab`, gồm cả rào địa chỉ. Đây
   * là đường DUY NHẤT hiện có để kiểm rào đó từ ngoài; tầng tool sau này gọi
   * thẳng `bus.call`, không đi qua route này.
   */
  let pingInFlight: Promise<number> | undefined
  const offProbe = ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/bus/probe',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!isTrustedRequest(req)) { json(res, 403, { reason: 'request không qua được rào tin cậy' }); return }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')

      const open = url.searchParams.get('open')
      if (open !== null) {
        let target: URL
        try {
          target = assertPublicUrl(open)
        } catch (error) {
          json(res, 400, { reason: error instanceof Error ? error.message : String(error) })
          return
        }
        try {
          const result = await bus.call('open_tab', { url: target.toString() }, 8000)
          json(res, 200, { ok: true, result })
        } catch (error) {
          json(res, 503, { reason: error instanceof Error ? error.message : String(error) })
        }
        return
      }

      // `?eval=<biểu thức>` chạy trọn vòng Node → cầu → sân khấu → trang khách.
      // Đây là đường duy nhất để bài kiểm — chạy ở tiến trình khác engine — xác
      // nhận cả chuỗi đó còn thông, thay vì chỉ biết cầu còn sống.
      const code = url.searchParams.get('eval')
      if (code !== null) {
        const tabId = url.searchParams.get('tab_id') ?? undefined
        try {
          const result = await bus.call('page_eval', { code, tab_id: tabId }, 10_000)
          json(res, 200, { ok: true, result })
        } catch (error) {
          json(res, 503, { reason: error instanceof Error ? error.message : String(error) })
        }
        return
      }

      // `?cmd=<tên>&params=<json>` gọi thẳng một lệnh của cầu.
      //
      // Đây là đường DUY NHẤT để bài kiểm chạm tới bộ lệnh: tool thật do model
      // gọi, mà bài kiểm thì không có model. Nó đi qua đúng `bus.call` mà tool
      // đi qua, nên nó cũng chịu đúng chốt công tắc quyền — không có đường tắt
      // nào ở đây.
      const cmd = url.searchParams.get('cmd')
      if (cmd !== null) {
        let params: unknown
        try {
          params = JSON.parse(url.searchParams.get('params') ?? '{}')
        } catch {
          json(res, 400, { reason: 'params không phải JSON hợp lệ' })
          return
        }
        try {
          json(res, 200, { ok: true, result: await bus.call(cmd, params, 40_000) })
        } catch (error) {
          json(res, 503, { reason: error instanceof Error ? error.message : String(error) })
        }
        return
      }

      // `?shot=1` chạy TRỌN đường chụp ảnh: cầu → giao diện → nửa Node → route
      // `/hdw/shell` → lớp vỏ → ngược về. Ba tiến trình, hai đường WebSocket
      // ngược chiều nhau, và không có cách nào khác để bài kiểm đo cả chuỗi đó.
      if (url.searchParams.get('shot') !== null) {
        if (captureShot === undefined) { json(res, 503, { reason: 'chưa có đường chụp ảnh' }); return }
        try {
          const prepared = await bus.call('shot_prepare', {}, 15_000) as { wc_id: number }
          try {
            const shot = await captureShot(prepared.wc_id)
            json(res, 200, {
              ok: true,
              width: shot.width,
              height: shot.height,
              bytes: Buffer.from(shot.data, 'base64').length,
            })
          } finally {
            await bus.call('shot_done', {}, 5000).catch(() => undefined)
          }
        } catch (error) {
          json(res, 503, { reason: error instanceof Error ? error.message : String(error) })
        }
        return
      }

      if (!bus.hasDriver()) { json(res, 200, { connected: false }); return }
      pingInFlight ??= (async () => {
        const started = Date.now()
        await bus.call('ping', undefined, 2000)
        return Date.now() - started
      })().finally(() => { pingInFlight = undefined })
      try {
        json(res, 200, { connected: true, latency_ms: await pingInFlight })
      } catch (error) {
        json(res, 200, { connected: false, reason: error instanceof Error ? error.message : String(error) })
      }
    },
  })

  return {
    bus,
    dispose: () => {
      off()
      offProbe()
      failAll('plugin đã gỡ')
      // `wss.close()` với `noServer: true` KHÔNG đóng những client đã nhận —
      // phải tự đi đóng từng cái, nếu không engine giữ socket sống mãi.
      for (const ws of clients) ws.close(CLOSE_FINAL, 'plugin đã gỡ')
      clients.clear()
      driver = undefined
      wss.close()
    },
  }
}
