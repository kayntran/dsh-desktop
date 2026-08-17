/**
 * Thông báo Windows khi agent cần bạn hoặc đã làm xong việc.
 *
 * App mở thêm một kết nối client THỨ HAI tới engine bằng đúng giao thức công
 * khai mà UI đang dùng, thay vì can thiệp vào UI thượng nguồn. Engine phục vụ
 * nhiều client cùng lúc nên đây là cách dùng đúng thiết kế, không phải mẹo.
 *
 * ⚠️ Thượng nguồn ghi rõ giao thức KHÔNG mang số hiệu phiên bản: client và host
 * phát hành gắn liền nhau. Nên mỗi lần nâng cấp `@deepseek-ai/dsh` phải chạy
 * lại `scripts/spike-frames.mjs` để đối chiếu hình dạng gói tin. Đổi lại, mọi
 * thứ ở đây đều chịu lỗi im lặng: frame lạ thì bỏ qua, không bao giờ làm chết
 * app chỉ vì thượng nguồn đổi tên một trường.
 * @module
 */

import { Notification } from 'electron'
import { logShell } from './log.js'

/** Gói tin trên dây: `payload` chính là frame, `method` lặp lại `payload.type`. */
interface ServerRequestEnvelope {
  type: string
  method: string
  payload: { type: string } & Record<string, unknown>
}

/** Những việc notifier cần từ phần còn lại của app. */
export interface NotifierHandlers {
  /** Người dùng có đang nhìn cửa sổ không — đang nhìn thì không báo. */
  isWindowActive: () => boolean
  /** Hiện cửa sổ khi người dùng bấm vào thông báo. */
  reveal: () => void
}

/** Các mốc chờ khi kết nối rớt, tính bằng mili giây. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000]

let sockets: WebSocket[] = []
let timers: NodeJS.Timeout[] = []
let running = false
/** Phiên nào đang chạy — để nhận ra lúc chuyển từ đang chạy sang xong. */
const busySessions = new Set<string>()

/**
 * Phiên nào vừa báo lỗi. Engine phát `host/agent-error` rồi mới hạ cờ chạy, nên
 * nếu không nhớ lại thì một thất bại sẽ đẻ ra hai thông báo, cái sau còn nói
 * nhầm là đã xong.
 */
const erroredSessions = new Set<string>()

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function show(handlers: NotifierHandlers, title: string, body: string): void {
  // Đang nhìn màn hình mà toast nhảy ra là phiền; UI đã hiện việc đó rồi.
  if (handlers.isWindowActive()) {
    logShell(`notifier: bỏ qua "${title}" vì cửa sổ đang hiện`)
    return
  }
  if (!Notification.isSupported()) {
    logShell(`notifier: hệ điều hành không hỗ trợ thông báo`)
    return
  }
  const notification = new Notification({ title, body })
  notification.on('click', () => { handlers.reveal() })
  notification.on('show', () => { logShell(`notifier: đã hiện "${title}"`) })
  notification.on('failed', (_event, error) => { logShell(`notifier: hiện thất bại "${title}" — ${error}`) })
  notification.show()
  logShell(`notifier: yêu cầu hiện "${title}"`)
}

/** Frame trên luồng mux: những việc agent cần người dùng trả lời. */
function handleMuxFrame(frame: ServerRequestEnvelope['payload'], handlers: NotifierHandlers): void {
  if (frame.type === 'approval/requested') {
    const tool = readString(frame, 'toolName') ?? 'an action'
    const reason = readString(frame, 'reason')
    show(handlers, 'The agent needs your approval', reason === undefined ? tool : `${tool} — ${reason}`)
    return
  }
  if (frame.type === 'question/requested') {
    const questions = frame['questions']
    const first = Array.isArray(questions) ? questions[0] : undefined
    const text = typeof first === 'object' && first !== null
      ? readString(first as Record<string, unknown>, 'question')
      : undefined
    show(handlers, 'The agent is asking you something', text ?? 'Open the app to answer.')
  }
}

/** Frame trên luồng host: vòng đời phiên và lỗi không gắn với lượt nào. */
function handleHostFrame(frame: ServerRequestEnvelope['payload'], handlers: NotifierHandlers): void {
  if (frame.type === 'host/session-status') {
    const sessionId = readString(frame, 'sessionId')
    if (sessionId === undefined) return
    if (frame['running'] === true) {
      busySessions.add(sessionId)
      return
    }
    const wasBusy = busySessions.delete(sessionId)
    // Lỗi đã được báo ngay trước đó rồi; nói thêm "đã xong" vừa thừa vừa sai.
    if (erroredSessions.delete(sessionId)) return
    // Chỉ báo cho phiên mà app đã thấy chạy: một phiên vốn đứng yên báo "xong"
    // là thông báo rác.
    if (wasBusy) show(handlers, 'The agent is done', 'The session just finished its work.')
    return
  }
  if (frame.type === 'host/agent-error') {
    const sessionId = readString(frame, 'sessionId')
    if (sessionId !== undefined) erroredSessions.add(sessionId)
    show(handlers, 'The agent hit an error', readString(frame, 'message') ?? 'Open the app for details.')
  }
}

/** Mở một luồng và tự nối lại khi rớt, im lặng suốt quá trình. */
function connect(
  url: string,
  onFrame: (frame: ServerRequestEnvelope['payload']) => void,
  attempt = 0,
): void {
  if (!running) return

  let socket: WebSocket
  try {
    socket = new WebSocket(url)
  } catch (error) {
    logShell(`notifier: không mở được ${url} — ${String(error)}`)
    return
  }
  sockets.push(socket)

  socket.addEventListener('open', () => {
    attempt = 0
    logShell(`notifier: đã nối ${url}`)
  })

  socket.addEventListener('message', (event) => {
    try {
      const parsed: unknown = JSON.parse(String(event.data))
      const envelope = parsed as Partial<ServerRequestEnvelope>
      const frame = envelope.payload
      if (envelope.type !== 'server-request' || frame === undefined || typeof frame.type !== 'string') return
      onFrame(frame)
    } catch {
      // Gói tin không đọc được thì bỏ qua — quan sát không bao giờ được cắn
      // vào luồng chính.
    }
  })

  const retry = (): void => {
    sockets = sockets.filter((item) => item !== socket)
    if (!running) return
    logShell(`notifier: mất kết nối ${url}, nối lại (lần ${attempt + 1})`)
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 15_000
    const timer = setTimeout(() => {
      timers = timers.filter((item) => item !== timer)
      connect(url, onFrame, attempt + 1)
    }, delay)
    timers.push(timer)
  }

  socket.addEventListener('close', retry)
  socket.addEventListener('error', () => {
    // 'error' luôn kéo theo 'close', nên việc nối lại để 'close' lo — ở đây chỉ
    // nuốt sự kiện để nó không nổi lên thành lỗi không ai bắt.
  })
}

/**
 * Bắt đầu theo dõi engine.
 * @param baseUrl - URL loopback của engine, ví dụ `http://127.0.0.1:53211`.
 */
export function startNotifier(baseUrl: string, handlers: NotifierHandlers): void {
  stopNotifier()
  running = true
  busySessions.clear()
  erroredSessions.clear()
  logShell(`notifier: bắt đầu theo dõi ${baseUrl} (WebSocket khả dụng: ${typeof WebSocket})`)
  const wsBase = baseUrl.replace(/^http:/, 'ws:')
  connect(`${wsBase}/api/events.mux`, (frame) => { handleMuxFrame(frame, handlers) })
  connect(`${wsBase}/api/events.host`, (frame) => { handleHostFrame(frame, handlers) })
}

/** Dừng theo dõi và đóng mọi kết nối. */
export function stopNotifier(): void {
  running = false
  for (const timer of timers) clearTimeout(timer)
  timers = []
  for (const socket of sockets) socket.close()
  sockets = []
  busySessions.clear()
  erroredSessions.clear()
}
