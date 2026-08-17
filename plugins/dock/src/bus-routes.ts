/**
 * The bridge between the plugin's Node half and its client half: the `/hdw/bus`
 * WebSocket.
 *
 * Why it is needed: the agent's tools run in the Node half (inside the engine
 * process), while the web page lives in the client half (inside the app window).
 * Those two cannot call each other directly. This bridge lets the Node half **ask**
 * the client half to do something and wait for the result.
 *
 * Calls go **one way**: Node asks, the client answers. The client never makes Node
 * do anything.
 *
 * ## Who drives when several windows connect
 *
 * **The first one to connect, and it keeps the wheel until its socket closes.**
 *
 * Not "newest wins", even though that sounds more natural. The reason:
 * `isTrustedRequest` is a gate against foreign web pages and browser extensions,
 * **not authentication** — any Chrome tab pointed at `http://127.0.0.1:<port>`
 * passes it. Under "newest wins" a stray tab like that would steal the wheel the
 * moment it connected, and from that second on the agent would open pages in a
 * Chrome window the user is not watching, while the app stayed silent. "First and
 * sticky" also survives a page refresh (the new client only takes the wheel after
 * the old one dies) and does not fight the client half's own reconnect logic.
 *
 * ## Protocol
 *
 * JSON only, no binary frames.
 *
 *   Node → client:  { t: 'call',  id, cmd, params }
 *   client → Node:  { t: 'done',  id, result }
 *                   { t: 'error', id, reason }
 *   client → Node:  { t: 'hello', version }      (first frame, required)
 * @module
 */

import type { Duplex } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { WebSocketServer, type WebSocket } from 'ws'
import { assertPublicUrl } from './net-policy.js'
import { isTrustedRequest } from './trust.js'

/**
 * Protocol version. Bump it whenever the message shape changes.
 *
 * Needed because `npm run dev` reloads the Node half while the page in the window
 * does not reload — two different versions then talk to each other, and the symptom
 * is meaningless errors somewhere far away. A version mismatch is refused
 * immediately, with the reason stated.
 */
export const BUS_VERSION = 2

/**
 * Connection ceiling. Same reason as `MAX_TERMINALS` in `pty-routes.ts`: stop a
 * client stuck in a reconnect loop from flooding the engine with connections.
 */
const MAX_CLIENTS = 4

/** Ceiling on commands awaiting an answer, so a caller cannot grow the table forever. */
const MAX_PENDING = 64

/** How many junk frames a client may send before it is closed. */
const MAX_JUNK_FRAMES = 20

/** Maximum frame. `ws` defaults to 100MB — far too wide for a bridge carrying only JSON. */
const MAX_FRAME_BYTES = 1024 * 1024

/** Heartbeat, to detect a half-dead socket (a laptop waking from sleep). */
const HEARTBEAT_MS = 15_000

/** Private close code, telling the client NOT to reconnect. */
const CLOSE_FINAL = 4001

/**
 * READ-only commands — always allowed, even while the permission switch is off.
 *
 * Blindfolding the agent does not stop it acting, it only makes it act blind.
 *
 * The list lives here, right next to `call`, rather than in the tool layer. The
 * reason: the tool layer is not the only route to the bridge — the diagnostic route
 * calls straight in too. Two routes with two rules means one of them eventually
 * gets forgotten, and the forgotten one is always the route nobody looks at. A
 * single gate cannot be forgotten.
 */
const READ_COMMANDS = new Set([
  'ping', 'tabs_list', 'read_page', 'find', 'get_page_text', 'console_log', 'network_log',
  // A screenshot is a READ: it changes nothing on the page. These two commands only
  // set up the conditions for a capture and then put the screen back. Leaving them
  // out would mean turning the switch off also loses screenshots — while the tool
  // description promises a screenshot always works, and that contradiction only
  // surfaces once a real person turns the switch off.
  'shot_prepare', 'shot_done',
])

/** The refusal when the switch is off — it says where to turn it back on. */
const DENIED
  = 'The "Let the agent control the browser" switch is OFF, so this action was refused. '
  + 'The user turns it back on in Settings > General. Commands that only READ the page still work.'

/** The surface the tool layer uses. */
export interface Bus {
  /**
   * Ask the client half to do something and wait for the result.
   * @param cmd - command name in the client's command table.
   * @param params - the command's parameters.
   * @param timeoutMs - the TOTAL budget, including time spent waiting for a window.
   * @returns whatever the client returned.
   */
  call: (cmd: string, params: unknown, timeoutMs?: number) => Promise<unknown>
  /** Whether any window currently holds the wheel. */
  hasDriver: () => boolean
  /**
   * Whether the user lets the agent ACT on the page (click, type, scroll, fill forms).
   *
   * Reading is always allowed, even when this is off: blindfolding the agent does
   * not stop it acting, it only makes it act blind.
   *
   * The value lives HERE, in the Node half — where the tools actually run. The
   * client half is only where the user clicks and where the choice is kept between
   * launches; it pushes the value across on every bridge connection and on every
   * change. A gate the blocked party can lift for itself is not a gate.
   *
   * Defaults to `true`, by the project owner's choice.
   */
  agentControl: () => boolean
}

/**
 * The door that lets the diagnostic route run ONE tool exactly as the engine would.
 *
 * It starts as an empty object and gets filled in later, rather than being an
 * ordinary parameter: the bridge must exist before the tools can be built (the
 * tools hold a reference to the bridge), so at route-registration time no tool
 * exists yet. Same reason and same approach as the stage holder in the client half.
 */
export interface ToolProbe {
  /**
   * Run a tool by name.
   * @param name - the tool's name, e.g. `browser_read_page`.
   * @param args - the arguments exactly as the model would supply them.
   * @returns the raw value, the prose the model receives, and the data the UI card reads.
   */
  run?: (name: string, args: unknown) => Promise<{ value: unknown, text: string, meta: unknown }>
}

interface Pending {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/** Answer a refused upgrade request, then destroy the socket. */
function refuse(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

/** Answer with JSON, in the same shape as `fs-routes.ts`. */
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
 * Open the `/hdw/bus` bridge.
 * @param ctx - the plugin's context; needs `webServer`.
 * @returns the surface for the tool layer, and a disposer.
 */
export function registerBusRoutes(
  ctx: Context,
  captureShot?: (webContentsId: number) => Promise<{ width: number, height: number, data: string }>,
  toolProbe?: ToolProbe,
): { bus: Bus, dispose: () => void } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })
  const clients = new Set<WebSocket>()
  const pending = new Map<number, Pending>()
  const driverWaiters: Array<() => void> = []
  let driver: WebSocket | undefined
  let nextId = 0
  let agentControl = true

  /** Who drives: the first one still alive. See the module comment. */
  const pickDriver = (): void => {
    if (driver !== undefined && clients.has(driver) && driver.readyState === driver.OPEN) return
    driver = [...clients].find((ws) => ws.readyState === ws.OPEN)
    if (driver !== undefined) {
      // Wake every call that was waiting for a window.
      while (driverWaiters.length > 0) driverWaiters.shift()?.()
    }
  }

  /**
   * Finish one pending command.
   *
   * REMOVE it from the table and clear the timer BEFORE settling, not after. The
   * other order lets a late answer, or two answers carrying the same `id`, settle a
   * second time — and a Promise settled twice is the kind of bug that leaves no trace.
   */
  const settle = (id: number, ok: boolean, value: unknown): void => {
    const entry = pending.get(id)
    // Unknown `id`, duplicate `id`, or an answer arriving after the timeout: drop it
    // silently. No noisy logging — a junk client would turn the log into a dump.
    if (entry === undefined) return
    pending.delete(id)
    clearTimeout(entry.timer)
    if (ok) entry.resolve(value)
    else entry.reject(value instanceof Error ? value : new Error(String(value)))
  }

  /** Fail every pending command, for when the driver drops or the plugin unloads. */
  const failAll = (reason: string): void => {
    for (const id of [...pending.keys()]) settle(id, false, new Error(reason))
  }

  const handleFrame = (ws: WebSocket, data: unknown, isBinary: boolean): boolean => {
    // This bridge has no binary channel. A binary frame is junk by definition.
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
        ws.close(CLOSE_FINAL, `bus protocol ${String(BUS_VERSION)}, this window runs a different one — please reload the page`)
        return true
      }
      // The window brings along the switch state the user had saved.
      if (typeof frame.agentControl === 'boolean') agentControl = frame.agentControl
      return true
    }

    // The user just flipped the switch in Settings. This frame travels against the
    // bridge's usual direction (client → Node, not an answer to a call), so it
    // carries no `id`.
    if (frame.t === 'agent-control') {
      if (typeof frame.agentControl === 'boolean') agentControl = frame.agentControl
      return true
    }
    if (typeof frame.id !== 'number') return false
    if (frame.t === 'done') { settle(frame.id, true, frame.result); return true }
    if (frame.t === 'error') { settle(frame.id, false, new Error(String(frame.reason ?? 'the client reported an error'))); return true }
    return false
  }

  const acceptClient = (ws: WebSocket): void => {
    clients.add(ws)
    pickDriver()

    let junk = 0
    let alive = true
    ws.on('pong', () => { alive = true })
    // Heartbeat: a laptop waking from sleep leaves a half-dead socket — `readyState`
    // is still OPEN, sending raises no error, and every command dies of a timeout
    // instead of failing immediately.
    const heart = setInterval(() => {
      if (!alive) { ws.terminate(); return }
      alive = false
      ws.ping()
    }, HEARTBEAT_MS)
    heart.unref()

    ws.on('message', (data, isBinary) => {
      if (handleFrame(ws, data, isBinary)) return
      junk += 1
      if (junk >= MAX_JUNK_FRAMES) ws.close(CLOSE_FINAL, 'too many invalid frames')
    })

    ws.on('close', () => {
      clearInterval(heart)
      clients.delete(ws)
      if (driver === ws) {
        driver = undefined
        // The window dropped mid-flight (usually the user reloading the page): fail
        // every pending command NOW rather than letting them hang to the timeout. An
        // immediate "the window closed" is more useful than 20 seconds of silence.
        failAll('the app window closed or reloaded mid-flight')
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
        throw new Error(`more than ${String(MAX_PENDING)} commands are already waiting for the client to answer`)
      }
      const deadline = Date.now() + timeoutMs

      // Wait for a window to connect. `timeoutMs` is the TOTAL budget the caller
      // sees: waiting to connect and waiting for an answer share one clock rather
      // than adding up.
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
        throw new Error('no app window is open, so there is no browser to control')
      }

      const left = deadline - Date.now()
      if (left <= 0) throw new Error(`timed out after ${String(timeoutMs)}ms waiting for an app window`)

      nextId += 1
      const id = nextId
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          settle(id, false, new Error(`command "${cmd}" got no answer within ${String(timeoutMs)}ms`))
        }, left)
        timer.unref()
        pending.set(id, { resolve, reject, timer })
        target.send(JSON.stringify({ t: 'call', id, cmd, params }))
      })
    },
  }

  /**
   * The `/hdw/bus/probe` diagnostic route — is the bridge alive?
   *
   * Needed because the test suite runs in a different process from the engine and
   * cannot look into the bridge's memory. Without it there is no way to learn the
   * bridge is broken short of waiting for some tool to fail silently.
   *
   * Three guards stop it becoming an amplifier: every in-flight question collapses
   * into ONE `ping` (single-flight), it has its own short timeout, and it returns
   * nothing beyond the two fields below — adding a client count or an address would
   * start leaking information.
   *
   * `?open=<url>` runs the whole `open_tab` path, address gate included. This is the
   * ONLY route currently available to test that gate from outside; the tool layer
   * later calls `bus.call` directly and does not pass through here.
   */
  let pingInFlight: Promise<number> | undefined
  const offProbe = ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/bus/probe',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!isTrustedRequest(req)) { json(res, 403, { reason: 'the request did not pass the trust gate' }); return }
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

      // `?eval=<expression>` runs the whole loop Node → bridge → stage → guest page.
      // This is the only way for the test suite — running in a different process from
      // the engine — to confirm that whole chain is intact rather than just the bridge.
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

      // `?cmd=<name>&params=<json>` calls one bridge command directly.
      //
      // This is the ONLY way for the test suite to reach the command table: the real
      // tools are called by the model, and the suite has no model. It goes through
      // the very same `bus.call` the tools go through, so it obeys the same
      // permission gate — there is no shortcut here.
      const cmd = url.searchParams.get('cmd')
      if (cmd !== null) {
        let params: unknown
        try {
          params = JSON.parse(url.searchParams.get('params') ?? '{}')
        } catch {
          json(res, 400, { reason: 'params is not valid JSON' })
          return
        }
        try {
          json(res, 200, { ok: true, result: await bus.call(cmd, params, 40_000) })
        } catch (error) {
          json(res, 503, { reason: error instanceof Error ? error.message : String(error) })
        }
        return
      }

      // `?tool=<name>&args=<json>` runs ONE tool directly, the same code the model runs.
      //
      // One level above `?cmd=`, and that level is the whole tool layer: parameter
      // checks, the tool-layer address gate, the prose returned to the model, the data
      // the UI card reads. The suite has no model to ask, so there is no other way to
      // run that code against a real bridge and a real page.
      const toolName = url.searchParams.get('tool')
      if (toolName !== null) {
        if (toolProbe?.run === undefined) { json(res, 503, { reason: 'no tool set has been built yet' }); return }
        let args: unknown
        try {
          args = JSON.parse(url.searchParams.get('args') ?? '{}')
        } catch {
          json(res, 400, { reason: 'args is not valid JSON' })
          return
        }
        try {
          json(res, 200, { ok: true, ...await toolProbe.run(toolName, args) })
        } catch (error) {
          json(res, 503, { reason: error instanceof Error ? error.message : String(error) })
        }
        return
      }

      // `?shot=1` runs the WHOLE screenshot path: bridge → client → Node half →
      // the `/hdw/shell` route → the shell → and back. Three processes, two WebSockets
      // running in opposite directions, and no other way for the suite to measure that
      // whole chain.
      if (url.searchParams.get('shot') !== null) {
        if (captureShot === undefined) { json(res, 503, { reason: 'no screenshot path is available' }); return }
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
      failAll('the plugin was unloaded')
      // With `noServer: true`, `wss.close()` does NOT close the clients already
      // accepted — each has to be closed by hand, or the engine keeps the sockets
      // alive forever.
      for (const ws of clients) ws.close(CLOSE_FINAL, 'the plugin was unloaded')
      clients.clear()
      driver = undefined
      wss.close()
    },
  }
}
