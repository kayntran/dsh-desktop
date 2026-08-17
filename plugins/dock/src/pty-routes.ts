/**
 * Terminal thật cho tab Terminal: một tiến trình shell trên máy, nối với giao
 * diện bằng một WebSocket.
 *
 * **Vì sao không dùng `ctx.terminals` của upstream.** Service đó tồn tại, nhưng
 * nó là bề mặt PTY dành cho *model* chứ không cho *người*: gửi theo từng dòng
 * chứ không theo từng phím, không có luồng dữ liệu chảy về, không có `resize`,
 * và chủ sở hữu bắt buộc phải là một `Agent`. Gõ `vim` hay bấm Ctrl+C vào đó là
 * không được. Nên tab này mở PTY riêng bằng `node-pty`, khai làm phụ thuộc của
 * chính plugin.
 *
 * **Giao thức, một biệt hoá duy nhất và không base64:**
 * - khung **nhị phân** = byte thô của terminal, chảy hai chiều
 * - khung **văn bản** = JSON điều khiển (`resize` lên, `ready`/`exit`/`error` xuống)
 *
 * Tách theo *loại khung* chứ không theo tiền tố trong nội dung, nên không có
 * chuỗi nào của người dùng bị hiểu nhầm thành lệnh, và không tốn 33% băng thông
 * cho base64.
 *
 * **Xác thực — nói thẳng giới hạn.** Rào ở đây ngang bằng rào của upstream cho
 * `/api`, tức là nơi agent đã chạy được lệnh shell từ trước. Nó chặn trang web
 * lạ và tiện ích trình duyệt đi lạc; nó KHÔNG chặn một tiến trình khác đang
 * chạy trên cùng máy. Route này vì vậy không làm rộng thêm mặt tấn công vốn có.
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
 * Trần số terminal mở cùng lúc. Không phải để hạn chế người dùng — một người
 * không mở nổi tám cái. Nó chặn trường hợp giao diện rơi vào vòng lặp kết nối
 * lại và đẻ ra shell không giới hạn cho tới khi máy đứng.
 */
const MAX_TERMINALS = 8

/** Kích thước mặc định khi client không gửi, hoặc gửi số vô nghĩa. */
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/** Đọc một số nguyên dương trong khoảng cho phép từ query string. */
function positiveInt(value: string | null, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : fallback
}

/** Shell mặc định của hệ điều hành đang chạy. */
function defaultShell(): string {
  return process.platform === 'win32'
    ? process.env['ComSpec'] ?? 'cmd.exe'
    : process.env['SHELL'] ?? '/bin/bash'
}

/**
 * Biến môi trường truyền cho shell: đúng môi trường của engine, đã lọc bỏ khoá
 * không có giá trị (node-pty đòi map toàn chuỗi).
 */
function shellEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

/** Trả lời một lời nâng cấp bị từ chối rồi đóng socket. */
function refuse(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

/**
 * Mở route WebSocket của terminal.
 * @param ctx - context của plugin; cần `webServer`, `fs`, `workspaceRegistry`.
 * @returns hàm gỡ route và giết mọi shell còn sống.
 */
export function registerPtyRoutes(ctx: Context): () => void {
  // `noServer`: engine sở hữu HTTP server, ta chỉ nhận cái socket đã được định
  // tuyến tới đúng đường dẫn của mình.
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
        // Dùng conpty.dll kèm sẵn trong gói thay vì bản của Windows. Đường
        // `kill` của nhánh mặc định fork một tiến trình phụ để liệt kê console,
        // và tiến trình phụ đó ném "AttachConsole failed" ra stderr mỗi lần
        // đóng terminal — log engine đầy vệt lỗi giả. Nhánh này không fork.
        // Đo bằng `scripts/spike-pty.mjs`, chạy có và không có biến
        // `HDW_CONPTY_DLL=1` là thấy khác biệt.
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

    // Đường dọn 1: shell tự thoát (người dùng gõ `exit`, hoặc nó chết).
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
          // `resize` ném khi PTY đã chết mà onExit chưa kịp chạy tới — một cuộc
          // đua bình thường khi người dùng kéo panel đúng lúc shell thoát.
          try { term.resize(c as number, r as number) } catch { /* PTY đã đóng */ }
        }
      }
    })

    // Đường dọn 2: người dùng đóng tab, tải lại trang, hoặc mất kết nối.
    ws.on('close', () => {
      if (live.delete(term)) {
        try { term.kill() } catch { /* đã chết rồi */ }
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

      // Thư mục làm việc do server xác thực lại, không tin client. Sai thì TỪ
      // CHỐI hẳn, không âm thầm rơi về `process.cwd()` — chỗ đó là thư mục cài
      // app, và một terminal mở im lặng ở đấy là thứ không ai ngờ tới.
      const target = await resolveWorkspaceRoot(ctx, cwd)
      if (target === undefined) { refuse(socket, 403, 'Not a registered workspace'); return }

      // Socket có thể đã đứt trong lúc chờ phân giải ở trên.
      if (socket.destroyed) return

      const cols = positiveInt(url.searchParams.get('cols'), DEFAULT_COLS)
      const rows = positiveInt(url.searchParams.get('rows'), DEFAULT_ROWS)
      wss.handleUpgrade(req, socket, head, (ws) => {
        openSession(ws, target.displayPath, cols, rows)
      })
    },
  })

  // Đường dọn 3: plugin bị gỡ, hoặc engine tắt. Không có bước này thì `npm run
  // dev` nạp lại plugin sẽ để lại một shell mồ côi mỗi lần.
  return () => {
    off()
    for (const term of live) {
      try { term.kill() } catch { /* đã chết rồi */ }
    }
    live.clear()
    wss.close()
  }
}
