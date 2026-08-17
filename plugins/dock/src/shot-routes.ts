/**
 * Đầu bên plugin của đường chụp ảnh: WebSocket `/hdw/shell`.
 *
 * Chiều gọi ngược với `/hdw/bus`. Ở đó nửa Node nhờ giao diện làm việc; ở đây
 * nửa Node nhờ **lớp vỏ Electron** làm việc — vì chụp ảnh trang web là thứ duy
 * nhất trong cả bộ lệnh mà đường của plugin không đi được.
 *
 * Lý do đầy đủ nằm ở `src/main/shot-link.ts`. Tóm tắt: gọi `capturePage()` từ
 * trong trang làm treo cứng cả cửa sổ trên trang https thật; gọi từ tiến trình
 * chính thì chạy 23KB trong 5ms.
 *
 * ## Luật tài xế, giống hệt `/hdw/bus`
 *
 * Cái nối đầu tiên còn sống là cái được hỏi, và giữ tới khi socket đóng. Lý do
 * cũng y hệt: `isTrustedRequest` là rào chống trang lạ, **không phải xác thực**,
 * nên "mới nhất lái" sẽ trao việc cho bất kỳ tiến trình nào trên máy vừa nối
 * vào sau.
 *
 * Kẻ giả danh lớp vỏ chỉ NHẬN được yêu cầu chụp và trả ảnh giả — nó không sai
 * khiến được gì. Thiệt hại nếu có là agent nhìn thấy một ảnh không đúng, không
 * phải là ai đó chụp trộm được màn hình.
 * @module
 */

import type { Duplex } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { WebSocketServer, type WebSocket } from 'ws'
import { isTrustedRequest } from './trust.ts'

/** Ảnh PNG base64 có thể lớn; 32MB đủ cho một khung hình 4K. */
const MAX_FRAME_BYTES = 32 * 1024 * 1024

/** Trần số lệnh chụp đang chờ. Chụp là việc nặng, không cần hàng dài. */
const MAX_PENDING = 8

/** Mã đóng riêng, báo cho lớp vỏ biết ĐỪNG nối lại. */
const CLOSE_FINAL = 4001

/** Ảnh đã chụp. */
export interface Shot {
  data: string
  width: number
  height: number
}

/** Bề mặt cho tầng tool. */
export interface ShotLink {
  /**
   * Nhờ lớp vỏ chụp một trang khách.
   * @param webContentsId - id trang khách, do nửa giao diện hỏi thẻ webview.
   * @param timeoutMs - tổng ngân sách.
   * @returns ảnh PNG base64.
   */
  capture: (webContentsId: number, timeoutMs?: number) => Promise<Shot>
  /** Lớp vỏ đã nối vào chưa. */
  ready: () => boolean
}

interface Pending {
  resolve: (shot: Shot) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/** Trả lời một lời nâng cấp bị từ chối rồi đóng socket. */
function refuse(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

/**
 * Mở route `/hdw/shell`.
 * @param ctx - context của plugin; cần `webServer`.
 * @returns bề mặt cho tầng tool, và hàm dọn.
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

  /** Xoá khỏi bảng và tắt đồng hồ TRƯỚC khi settle — xem `bus-routes.ts`. */
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
          settle(frame.id, false, new Error(String(frame.reason ?? 'lớp vỏ báo lỗi')))
        })

        ws.on('close', () => {
          clients.delete(ws)
          if (shell === ws) {
            shell = undefined
            failAll('lớp vỏ đã đóng kết nối giữa chừng')
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
          'lớp vỏ app chưa nối vào nên chưa chụp được ảnh. '
          + 'Chỉ chụp được khi chạy trong app Harness Desktop, không chạy được ở trình duyệt thường.',
        )
      }
      if (pending.size >= MAX_PENDING) throw new Error(`quá ${String(MAX_PENDING)} lệnh chụp đang chờ`)

      nextId += 1
      const id = nextId
      return new Promise<Shot>((resolve, reject) => {
        const timer = setTimeout(() => {
          settle(id, false, new Error(`chụp ảnh quá ${String(timeoutMs)}ms không có trả lời`))
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
      failAll('plugin đã gỡ')
      for (const ws of clients) ws.close(CLOSE_FINAL, 'plugin đã gỡ')
      clients.clear()
      shell = undefined
      wss.close()
    },
  }
}
