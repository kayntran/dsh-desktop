/**
 * Đường chụp ảnh trang web cho agent: lớp vỏ **tự gọi vào** engine.
 *
 * ## Vì sao phải là lớp vỏ, không phải plugin
 *
 * Đo được (mục kiểm 15b): gọi `capturePage()` từ trong trang chủ làm **treo cứng
 * vòng lặp sự kiện của cả cửa sổ** trên trang https thật — `setTimeout` bọc
 * ngoài cũng không nổ, nên không có cách nào tự cứu. Đường tiến trình chính thì
 * chạy 23KB trong 5ms. Cùng một tên hàm, hai vị trí gọi, hai kết quả.
 *
 * Nên lệnh chụp ảnh không đi được đường của plugin. Nó phải chạy ở đây.
 *
 * ## Vì sao lớp vỏ GỌI ĐI chứ không ĐỨNG CHỜ
 *
 * Cách dễ hơn là mở một cổng nghe trong lớp vỏ cho plugin gọi vào. Không làm
 * thế: một cổng nghe là một cánh cửa mới trên máy người dùng, và mọi tiến trình
 * khác trên máy đó cũng gõ được cửa ấy.
 *
 * Lớp vỏ vốn đã nối tới engine để hiện thông báo Windows (`notifier.ts`), nên
 * nối thêm một đường nữa là việc nó vẫn làm. Lớp vỏ là bên gọi đi; không có cửa
 * nào mới mở ra.
 *
 * ## Chỉ chụp được đúng những trang web trong panel
 *
 * Lớp vỏ giữ danh sách `webContents` của các thẻ `<webview>` mà nó tự tay gắn
 * vào (`did-attach-webview`). Yêu cầu chụp mang theo một id, và id không nằm
 * trong danh sách đó thì bị từ chối — không ai chụp được giao diện engine, cửa
 * sổ Giới thiệu, hay bất cứ thứ gì khác.
 * @module
 */

import { type WebContents } from 'electron'
import { logShell } from './log.js'

/** Đường dẫn WebSocket mà plugin mở sẵn cho lớp vỏ. */
const SHOT_PATH = '/hdw/shell'

/** Các mốc chờ khi kết nối rớt, tính bằng mili giây. Cùng khuôn với `notifier.ts`. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000]

/** Trần thời gian cho một lần chụp. Quá đây thì trả lời "không chụp được". */
const CAPTURE_TIMEOUT_MS = 8_000

let socket: WebSocket | undefined
let timer: NodeJS.Timeout | undefined
let attempt = 0
let running = false

/**
 * Những trang khách mà lớp vỏ tự tay gắn vào cửa sổ chính.
 *
 * Đây là danh sách cho phép, không phải bộ nhớ đệm: chỉ id trong đây mới chụp
 * được. Dùng `Map` theo id để tra nhanh và để dọn khi trang chết.
 */
const guests = new Map<number, WebContents>()

/**
 * Ghi nhận một trang khách vừa được gắn vào cửa sổ.
 *
 * Gọi từ `did-attach-webview` của lớp vỏ. Tự dọn khi trang bị huỷ, nên danh
 * sách không phình theo số tab người dùng đã mở rồi đóng.
 * @param guest - `webContents` của thẻ `<webview>`.
 */
export function trackGuest(guest: WebContents): void {
  const id = guest.id
  guests.set(id, guest)
  guest.once('destroyed', () => { guests.delete(id) })
}

/** Ảnh đã chụp, dạng base64 PNG, cộng kích thước thật. */
interface Shot {
  data: string
  width: number
  height: number
}

/**
 * Chụp một trang khách theo id.
 * @param id - id `webContents` của trang khách.
 * @returns ảnh PNG dạng base64.
 * @throws khi id không thuộc danh sách cho phép, hoặc chụp quá lâu.
 */
async function capture(id: number): Promise<Shot> {
  const guest = guests.get(id)
  if (guest === undefined || guest.isDestroyed()) {
    throw new Error('no web page in the panel carries that id')
  }
  // Hết giờ là bắt buộc, không phải cẩn thận thừa: `capturePage` đã từng treo
  // vĩnh viễn ở đường khác, và một Promise không bao giờ giải quyết sẽ giữ chỗ
  // trong bảng chờ của cầu cho tới khi hết trần.
  const image = await Promise.race([
    guest.capturePage(),
    new Promise<undefined>((resolve) => {
      const t = setTimeout(() => { resolve(undefined) }, CAPTURE_TIMEOUT_MS)
      t.unref()
    }),
  ])
  if (image === undefined) throw new Error('the screenshot took too long and was abandoned')
  const size = image.getSize()
  return { data: image.toPNG().toString('base64'), width: size.width, height: size.height }
}

/** Nối tới engine và phục vụ các yêu cầu chụp ảnh. */
function connect(baseUrl: string): void {
  if (!running) return
  const url = new URL(SHOT_PATH, baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

  const ws = new WebSocket(url.toString())
  socket = ws

  ws.addEventListener('open', () => {
    attempt = 0
    logShell('shot-link: connected to the engine')
  })

  ws.addEventListener('message', (event) => {
    let frame: { id?: unknown, wc_id?: unknown }
    try {
      frame = JSON.parse(String(event.data)) as typeof frame
    } catch {
      return
    }
    if (typeof frame.id !== 'number' || typeof frame.wc_id !== 'number') return
    const callId = frame.id

    capture(frame.wc_id).then(
      (shot) => { ws.send(JSON.stringify({ id: callId, ok: true, ...shot })) },
      (error: unknown) => {
        ws.send(JSON.stringify({
          id: callId,
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        }))
      },
    )
  })

  ws.addEventListener('close', () => {
    socket = undefined
    if (!running) return
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 15_000
    attempt += 1
    timer = setTimeout(() => { connect(baseUrl) }, wait)
    timer.unref()
  })

  // Mọi đường hỏng đều kết thúc bằng `close`, nên nối lại ở đây nữa là nối lại
  // hai lần.
  ws.addEventListener('error', () => {})
}

/**
 * Bật đường chụp ảnh. Gọi sau khi engine đã lên.
 * @param baseUrl - địa chỉ engine.
 */
export function startShotLink(baseUrl: string): void {
  if (running) return
  running = true
  attempt = 0
  connect(baseUrl)
}

/**
 * Chụp một trang khách, dùng cho bài kiểm.
 *
 * Lộ ra để `scripts/spike-dock-ui.cjs` đo được CHÍNH hàm này, thay vì chép lại
 * một bản gần giống. Bài học của mục 17a: một chốt được kiểm bằng bản sao của
 * chính nó thì không kiểm được gì.
 *
 * Không dùng trong app: ở đó lời gọi luôn tới từ engine qua WebSocket.
 * @param webContentsId - id trang khách.
 * @returns ảnh PNG base64.
 */
export async function captureForSpike(webContentsId: number): Promise<Shot> {
  return capture(webContentsId)
}

/** Tắt đường chụp ảnh và dọn sạch. */
export function stopShotLink(): void {
  running = false
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  socket?.close()
  socket = undefined
  guests.clear()
}
