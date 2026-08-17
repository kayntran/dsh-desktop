/**
 * Windows notifications for when the agent needs you or has finished a job.
 *
 * The app opens a SECOND client connection to the engine using the same public
 * protocol the UI uses, rather than reaching into upstream's UI. The engine serves
 * many clients at once, so this is the design being used as intended, not a trick.
 *
 * ⚠️ Upstream states plainly that the protocol carries NO version number: client and
 * host ship together. So every `@deepseek-ai/dsh` upgrade has to re-run
 * `scripts/spike-frames.mjs` to re-check the frame shapes. In exchange, everything
 * here fails silently: an unrecognized frame is ignored, and the app never dies just
 * because upstream renamed a field.
 * @module
 */

import { Notification } from 'electron'
import { logShell } from './log.js'

/** The wire envelope: `payload` is the frame itself, and `method` repeats `payload.type`. */
interface ServerRequestEnvelope {
  type: string
  method: string
  payload: { type: string } & Record<string, unknown>
}

/** What the notifier needs from the rest of the app. */
export interface NotifierHandlers {
  /** Whether the user is looking at the window — if so, stay quiet. */
  isWindowActive: () => boolean
  /** Show the window when the user clicks the notification. */
  reveal: () => void
}

/** Backoff steps after a dropped connection, in milliseconds. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000]

let sockets: WebSocket[] = []
let timers: NodeJS.Timeout[] = []
let running = false
/** Which sessions are running — so the running-to-finished transition can be spotted. */
const busySessions = new Set<string>()

/**
 * Which sessions just reported an error. The engine emits `host/agent-error` and
 * only then lowers the running flag, so without remembering this, one failure would
 * produce two notifications — and the second would wrongly say the work finished.
 */
const erroredSessions = new Set<string>()

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function show(handlers: NotifierHandlers, title: string, body: string): void {
  // A toast popping up while the user is watching is a nuisance; the UI already showed it.
  if (handlers.isWindowActive()) {
    logShell(`notifier: skipped "${title}" because the window is showing`)
    return
  }
  if (!Notification.isSupported()) {
    logShell(`notifier: the operating system does not support notifications`)
    return
  }
  const notification = new Notification({ title, body })
  notification.on('click', () => { handlers.reveal() })
  notification.on('show', () => { logShell(`notifier: showed "${title}"`) })
  notification.on('failed', (_event, error) => { logShell(`notifier: failed to show "${title}" — ${error}`) })
  notification.show()
  logShell(`notifier: asked to show "${title}"`)
}

/** Frames on the mux stream: things the agent needs the user to answer. */
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

/** Frames on the host stream: session lifecycle and errors not tied to a turn. */
function handleHostFrame(frame: ServerRequestEnvelope['payload'], handlers: NotifierHandlers): void {
  if (frame.type === 'host/session-status') {
    const sessionId = readString(frame, 'sessionId')
    if (sessionId === undefined) return
    if (frame['running'] === true) {
      busySessions.add(sessionId)
      return
    }
    const wasBusy = busySessions.delete(sessionId)
    // The error was announced a moment ago; adding "done" would be both redundant and wrong.
    if (erroredSessions.delete(sessionId)) return
    // Only announce for a session the app saw running: a session that was idle all
    // along reporting "done" is junk notification.
    if (wasBusy) show(handlers, 'The agent is done', 'The session just finished its work.')
    return
  }
  if (frame.type === 'host/agent-error') {
    const sessionId = readString(frame, 'sessionId')
    if (sessionId !== undefined) erroredSessions.add(sessionId)
    show(handlers, 'The agent hit an error', readString(frame, 'message') ?? 'Open the app for details.')
  }
}

/** Open one stream and reconnect when it drops, staying silent throughout. */
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
    logShell(`notifier: could not open ${url} — ${String(error)}`)
    return
  }
  sockets.push(socket)

  socket.addEventListener('open', () => {
    attempt = 0
    logShell(`notifier: connected to ${url}`)
  })

  socket.addEventListener('message', (event) => {
    try {
      const parsed: unknown = JSON.parse(String(event.data))
      const envelope = parsed as Partial<ServerRequestEnvelope>
      const frame = envelope.payload
      if (envelope.type !== 'server-request' || frame === undefined || typeof frame.type !== 'string') return
      onFrame(frame)
    } catch {
      // An unreadable envelope is ignored — observation must never bite into the main
      // flow.
    }
  })

  const retry = (): void => {
    sockets = sockets.filter((item) => item !== socket)
    if (!running) return
    logShell(`notifier: lost the connection to ${url}, reconnecting (attempt ${attempt + 1})`)
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 15_000
    const timer = setTimeout(() => {
      timers = timers.filter((item) => item !== timer)
      connect(url, onFrame, attempt + 1)
    }, delay)
    timers.push(timer)
  }

  socket.addEventListener('close', retry)
  socket.addEventListener('error', () => {
    // 'error' always drags 'close' along, so reconnecting is 'close's job — this only
    // swallows the event so it does not surface as an unhandled error.
  })
}

/**
 * Start watching the engine.
 * @param baseUrl - the engine's loopback URL, e.g. `http://127.0.0.1:53211`.
 */
export function startNotifier(baseUrl: string, handlers: NotifierHandlers): void {
  stopNotifier()
  running = true
  busySessions.clear()
  erroredSessions.clear()
  logShell(`notifier: started watching ${baseUrl} (WebSocket available: ${typeof WebSocket})`)
  const wsBase = baseUrl.replace(/^http:/, 'ws:')
  connect(`${wsBase}/api/events.mux`, (frame) => { handleMuxFrame(frame, handlers) })
  connect(`${wsBase}/api/events.host`, (frame) => { handleHostFrame(frame, handlers) })
}

/** Stop watching and close every connection. */
export function stopNotifier(): void {
  running = false
  for (const timer of timers) clearTimeout(timer)
  timers = []
  for (const socket of sockets) socket.close()
  sockets = []
  busySessions.clear()
  erroredSessions.clear()
}
