/**
 * The plugin end of the screenshot path: the `/hdw/shell` WebSocket.
 *
 * The direction of calls is the reverse of `/hdw/bus`. There, the Node half asks the
 * client to do work; here, the Node half asks the **Electron shell** to do work —
 * because capturing a web page is the one thing in the whole command set that the
 * plugin's own route cannot do.
 *
 * The full reasoning lives in `src/main/shot-link.ts`. In short: calling
 * `capturePage()` from inside the page hard-locks the whole window on a real https
 * page; calling it from the main process runs 23KB in 5ms.
 *
 * ## The driver rule, identical to `/hdw/bus`
 *
 * The first connection still alive is the one asked, and it holds until its socket
 * closes. The reason is identical: `isTrustedRequest` is a gate against foreign pages,
 * **not authentication**, so "newest wins" would hand the work to whatever process on
 * the machine connected most recently.
 *
 * Something impersonating the shell can only RECEIVE capture requests and return fake
 * images — it cannot command anything. The damage, if any, is that the agent sees a
 * wrong image, not that somebody captured the screen without permission.
 * @module
 */

import type { Duplex } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { WebSocketServer, type WebSocket } from 'ws'
import { isTrustedRequest } from './trust.ts'

/** A base64 PNG can be large; 32MB is enough for a 4K frame. */
const MAX_FRAME_BYTES = 32 * 1024 * 1024

/** Ceiling on pending captures. Capturing is heavy work; a long queue serves nobody. */
const MAX_PENDING = 8

/** Private close code, telling the shell NOT to reconnect. */
const CLOSE_FINAL = 4001

/** A captured image. */
export interface Shot {
  data: string
  width: number
  height: number
}

/** The surface for the tool layer. */
export interface ShotLink {
  /**
   * Ask the shell to capture one guest page.
   * @param webContentsId - the guest page's id, which the client half asks the webview tag for.
   * @param timeoutMs - the total budget.
   * @returns the PNG image as base64.
   */
  capture: (webContentsId: number, timeoutMs?: number) => Promise<Shot>
  /** Whether the shell has connected. */
  ready: () => boolean
}

interface Pending {
  resolve: (shot: Shot) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/** Answer a refused upgrade request, then destroy the socket. */
function refuse(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

/**
 * Open the `/hdw/shell` route.
 * @param ctx - the plugin's context; needs `webServer`.
 * @returns the surface for the tool layer, and a disposer.
 */
export function registerShotRoutes(ctx: Context): { link: ShotLink, dispose: () => void } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })
  const clients = new Set<WebSocket>()
  const pending = new Map<number, Pending>()
  let shell: WebSocket | undefined
  let nextId = 0

  const pickShell = (): void => {
    if (shell !== undefined && clients.has(shell) && shell.readyState === shell.OPEN) return
    shell = [...clients].find((ws) => ws.readyState === ws.OPEN)
  }

  /** Remove from the table and clear the timer BEFORE settling — see `bus-routes.ts`. */
  const settle = (id: number, ok: boolean, value: Shot | Error): void => {
    const entry = pending.get(id)
    if (entry === undefined) return
    pending.delete(id)
    clearTimeout(entry.timer)
    if (ok && !(value instanceof Error)) entry.resolve(value)
    else entry.reject(value instanceof Error ? value : new Error(String(value)))
  }

  const failAll = (reason: string): void => {
    for (const id of [...pending.keys()]) settle(id, false, new Error(reason))
  }

  const off = ctx.webServer.registerUpgrade({
    path: '/hdw/shell',
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!isTrustedRequest(req)) { refuse(socket, 403, 'Forbidden'); return }
      if (clients.size >= 2) { refuse(socket, 429, 'Too Many Shell Clients'); return }
      wss.handleUpgrade(req, socket, head, (ws) => {
        clients.add(ws)
        pickShell()

        ws.on('message', (data) => {
          let frame: { id?: unknown, ok?: unknown, reason?: unknown, data?: unknown, width?: unknown, height?: unknown }
          try {
            frame = JSON.parse(String(data)) as typeof frame
          } catch {
            return
          }
          if (typeof frame.id !== 'number') return
          if (frame.ok === true && typeof frame.data === 'string') {
            settle(frame.id, true, {
              data: frame.data,
              width: typeof frame.width === 'number' ? frame.width : 0,
              height: typeof frame.height === 'number' ? frame.height : 0,
            })
            return
          }
          settle(frame.id, false, new Error(String(frame.reason ?? 'the shell reported an error')))
        })

        ws.on('close', () => {
          clients.delete(ws)
          if (shell === ws) {
            shell = undefined
            failAll('the shell closed the connection mid-flight')
          }
          pickShell()
        })
      })
    },
  })

  const link: ShotLink = {
    ready: () => shell !== undefined && shell.readyState === shell.OPEN,

    capture: async (webContentsId, timeoutMs = 15_000) => {
      const target = shell
      if (target === undefined || target.readyState !== target.OPEN) {
        throw new Error(
          'the app shell is not connected, so no screenshot can be taken. '
          + 'Screenshots only work inside the Harness Desktop app, not in an ordinary browser.',
        )
      }
      if (pending.size >= MAX_PENDING) throw new Error(`more than ${String(MAX_PENDING)} screenshot requests are already waiting`)

      nextId += 1
      const id = nextId
      return new Promise<Shot>((resolve, reject) => {
        const timer = setTimeout(() => {
          settle(id, false, new Error(`the screenshot got no answer within ${String(timeoutMs)}ms`))
        }, timeoutMs)
        timer.unref()
        pending.set(id, { resolve, reject, timer })
        target.send(JSON.stringify({ id, wc_id: webContentsId }))
      })
    },
  }

  return {
    link,
    dispose: () => {
      off()
      failAll('the plugin was unloaded')
      for (const ws of clients) ws.close(CLOSE_FINAL, 'the plugin was unloaded')
      clients.clear()
      shell = undefined
      wss.close()
    },
  }
}
