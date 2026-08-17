/**
 * A real terminal for the Terminal tab: a shell process on the machine, joined to the
 * client by one WebSocket.
 *
 * **Why upstream's `ctx.terminals` is not used.** That service exists, but it is a PTY
 * surface built for a *model*, not for a *person*: it sends line by line rather than
 * key by key, there is no data stream flowing back, there is no `resize`, and the owner
 * has to be an `Agent`. Typing `vim` or pressing Ctrl+C into it does not work. So this
 * tab opens its own PTY through `node-pty`, declared as the plugin's own dependency.
 *
 * **The protocol, one single specialization and no base64:**
 * - **binary** frames = the terminal's raw bytes, flowing both ways
 * - **text** frames = control JSON (`resize` upward, `ready`/`exit`/`error` downward)
 *
 * Split by *frame type* rather than by a prefix inside the content, so no string a user
 * types is ever mistaken for a command, and no 33% of the bandwidth goes to base64.
 *
 * **Authentication — the limit stated plainly.** The gate here is the equal of
 * upstream's gate on `/api`, which is where the agent could already run shell commands.
 * It blocks foreign web pages and stray browser extensions; it does NOT block another
 * process running on the same machine. This route therefore does not widen the attack
 * surface that already exists.
 * @module
 */

import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { IPty, IWindowsPtyForkOptions } from 'node-pty'
import { spawn } from 'node-pty'
import { WebSocketServer, type WebSocket } from 'ws'
import { isTrustedRequest } from './trust.ts'
import { resolveWorkspaceRoot } from './workspace-guard.ts'

import type {} from '@deepseek-ai/dsh-host-webserver'

/**
 * Ceiling on simultaneously open terminals. Not to limit the user — nobody opens eight
 * by hand. It stops the case where the client falls into a reconnect loop and spawns
 * shells without limit until the machine seizes.
 */
const MAX_TERMINALS = 8

/** Default size when the client sends none, or sends a nonsense number. */
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/** Read a positive integer within the allowed range from the query string. */
function positiveInt(value: string | null, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : fallback
}

/** The running operating system's default shell. */
function defaultShell(): string {
  return process.platform === 'win32'
    ? process.env['ComSpec'] ?? 'cmd.exe'
    : process.env['SHELL'] ?? '/bin/bash'
}

/**
 * The environment passed to the shell: the engine's own environment, with valueless
 * keys filtered out (node-pty demands an all-string map).
 */
function shellEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

/** Answer a refused upgrade request, then destroy the socket. */
function refuse(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

/**
 * Open the terminal's WebSocket route.
 * @param ctx - the plugin's context; needs `webServer`, `fs`, `workspaceRegistry`.
 * @returns a function that removes the route and kills every surviving shell.
 */
export function registerPtyRoutes(ctx: Context): () => void {
  // `noServer`: the engine owns the HTTP server; we only receive the socket already
  // routed to our own path.
  const wss = new WebSocketServer({ noServer: true })
  const live = new Set<IPty>()

  const openSession = (ws: WebSocket, cwd: string, cols: number, rows: number): void => {
    const shell = defaultShell()
    let term: IPty
    try {
      const options: IWindowsPtyForkOptions = {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: shellEnv(),
        // Use the conpty.dll bundled with the package rather than Windows' own. The
        // default branch's `kill` path forks a helper process to enumerate consoles, and
        // that helper throws "AttachConsole failed" onto stderr every time a terminal
        // closes — filling the engine log with fake error traces. This branch does not
        // fork. Measured with `scripts/spike-pty.mjs`; running it with and without
        // `HDW_CONPTY_DLL=1` shows the difference.
        useConptyDll: true,
      }
      term = spawn(shell, [], options)
    } catch (error) {
      ws.send(JSON.stringify({ t: 'error', reason: error instanceof Error ? error.message : 'could not open a shell' }))
      ws.close()
      return
    }

    live.add(term)
    ws.send(JSON.stringify({ t: 'ready', pid: term.pid, shell, cwd }))

    term.onData((data) => {
      if (ws.readyState === ws.OPEN) ws.send(Buffer.from(data, 'utf8'), { binary: true })
    })

    // Cleanup path 1: the shell exits on its own (the user typed `exit`, or it died).
    term.onExit(({ exitCode, signal }) => {
      live.delete(term)
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ t: 'exit', exitCode, signal }))
        ws.close()
      }
    })

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        term.write(Buffer.isBuffer(data) ? data.toString('utf8') : String(data))
        return
      }
      let msg: unknown
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }
      if (typeof msg === 'object' && msg !== null && (msg as { t?: unknown }).t === 'resize') {
        const { cols: c, rows: r } = msg as { cols?: unknown, rows?: unknown }
        if (Number.isInteger(c) && Number.isInteger(r) && (c as number) >= 1 && (r as number) >= 1) {
          // `resize` throws when the PTY is already dead but onExit has not run yet — an
          // ordinary race when the user drags the panel exactly as the shell exits.
          try { term.resize(c as number, r as number) } catch { /* the PTY is already closed */ }
        }
      }
    })

    // Cleanup path 2: the user closes the tab, reloads the page, or loses the connection.
    ws.on('close', () => {
      if (live.delete(term)) {
        try { term.kill() } catch { /* already dead */ }
      }
    })
  }

  const off = ctx.webServer.registerUpgrade({
    path: '/hdw/pty',
    handler: async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!isTrustedRequest(req)) { refuse(socket, 403, 'Forbidden'); return }
      if (live.size >= MAX_TERMINALS) { refuse(socket, 429, 'Too Many Terminals'); return }

      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const cwd = url.searchParams.get('cwd')
      if (cwd === null) { refuse(socket, 400, 'Missing cwd'); return }

      // The working directory is re-validated by the server; the client is not trusted.
      // A wrong one is REFUSED outright rather than silently falling back to
      // `process.cwd()` — that is the app's install directory, and a terminal quietly
      // opened there is something nobody expects.
      const target = await resolveWorkspaceRoot(ctx, cwd)
      if (target === undefined) { refuse(socket, 403, 'Not a registered workspace'); return }

      // The socket may have dropped while the resolve above was awaited.
      if (socket.destroyed) return

      const cols = positiveInt(url.searchParams.get('cols'), DEFAULT_COLS)
      const rows = positiveInt(url.searchParams.get('rows'), DEFAULT_ROWS)
      wss.handleUpgrade(req, socket, head, (ws) => {
        openSession(ws, target.displayPath, cols, rows)
      })
    },
  })

  // Cleanup path 3: the plugin unloads, or the engine shuts down. Without this step,
  // every `npm run dev` plugin reload would leave one orphaned shell behind.
  return () => {
    off()
    for (const term of live) {
      try { term.kill() } catch { /* already dead */ }
    }
    live.clear()
    wss.close()
  }
}
