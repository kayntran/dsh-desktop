/**
 * Hai route chỉ-đọc cho tab Files: liệt kê thư mục và xem nội dung file.
 *
 * Dùng `ctx.fs` của upstream chứ không dùng `node:fs` thẳng. Lý do kỹ thuật:
 * nó đã lo realpath, kiểm tra chứa/không chứa, giải mã UTF-8, từ chối file nhị
 * phân, và mã lỗi có kiểu. Lý do quan trọng hơn: đó là **đúng cái nhìn mà agent
 * đang có**, nên thứ người dùng thấy trong panel khớp với thứ model thấy.
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { isTrustedRequest } from './trust.ts'
import { resolveWorkspaceRoot } from './workspace-guard.ts'

// Nạp phần khai báo bổ sung của hai gói này: chúng gắn `webServer` và
// `workspaceRegistry` vào `Context` bằng declaration merging, mà merge chỉ có
// hiệu lực khi module được kéo vào chương trình.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'

/** Trần nội dung xem trước. Quá ngưỡng thì cắt và nói rõ là đã cắt. */
const MAX_PREVIEW_BYTES = 512 * 1024

/** Trần số mục một thư mục trả về, để một thư mục khổng lồ không treo giao diện. */
const MAX_ENTRIES = 2000

/**
 * Thư mục không bao giờ hiện trong cây. Đây là những chỗ có hàng chục nghìn
 * file mà người dùng gần như không bao giờ muốn duyệt bằng tay.
 */
const HIDDEN_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '__pycache__', '.venv'])

/** Một mục con trong cây thư mục, đã gọt cho giao diện. */
interface DirEntryView {
  name: string
  type: 'file' | 'directory' | 'other'
  size?: number
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(text)),
  })
  res.end(text)
}

/** Mã lỗi có kiểu của `ctx.fs`, hoặc undefined nếu không phải lỗi của nó. */
function fsCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code.startsWith('FS_') ? code : undefined
}

/**
 * Kiểm tra và phân giải một cặp (root, path) từ query string.
 *
 * Thứ tự các bước ở đây là có chủ ý và không được đảo:
 * 1. `root` phải là một workspace đã đăng ký — rào này do **server** quyết
 *    định, client không tự khai được thư mục gốc, nên không ai duyệt được cả ổ
 *    đĩa bằng cách sửa URL.
 * 2. `lstat` chạy TRƯỚC `resolve` — `resolve` đi theo symlink, nên hỏi sau thì
 *    đã muộn: một symlink trỏ ra ngoài workspace sẽ được hợp thức hoá.
 * 3. `contains` chốt lại lần cuối.
 */
async function resolveInsideWorkspace(
  ctx: Context,
  url: URL,
): Promise<{ ok: true, target: FsTarget } | { ok: false, status: number, ly_do: string }> {
  const root = url.searchParams.get('root')
  const path = url.searchParams.get('path')
  if (root === null || path === null) return { ok: false, status: 400, ly_do: 'thiếu root hoặc path' }

  const rootTarget = await resolveWorkspaceRoot(ctx, root)
  if (rootTarget === undefined) {
    return { ok: false, status: 403, ly_do: 'root không phải một workspace đã đăng ký' }
  }

  const info = await ctx.fs.lstat(path)
  if (info === undefined) return { ok: false, status: 404, ly_do: 'không có đường dẫn này' }
  if (info.type === 'symlink') return { ok: false, status: 403, ly_do: 'không đi theo symlink' }

  const target = await ctx.fs.resolve(path)
  if (rootTarget.targetKey !== target.targetKey && !ctx.fs.contains(rootTarget, target)) {
    return { ok: false, status: 403, ly_do: 'đường dẫn nằm ngoài workspace' }
  }
  return { ok: true, target }
}

/**
 * Đăng ký hai route chỉ-đọc của tab Files.
 * @param ctx - context của plugin; cần các service `webServer`, `fs`, `workspaceRegistry`.
 * @returns hàm gỡ cả hai route.
 */
export function registerFsRoutes(ctx: Context): () => void {
  const guard = (req: IncomingMessage, res: ServerResponse): URL | undefined => {
    if (!isTrustedRequest(req)) {
      json(res, 403, { ly_do: 'request không qua được rào tin cậy' })
      return undefined
    }
    return new URL(req.url ?? '/', 'http://127.0.0.1')
  }

  const offList = ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/fs/list',
    handler: async (req, res) => {
      const url = guard(req, res)
      if (url === undefined) return
      const resolved = await resolveInsideWorkspace(ctx, url)
      if (!resolved.ok) { json(res, resolved.status, { ly_do: resolved.ly_do }); return }
      try {
        const info = await ctx.fs.stat(resolved.target)
        if (info?.type !== 'directory') { json(res, 400, { ly_do: 'không phải thư mục' }); return }
        const children = await ctx.fs.listDir(resolved.target)
        const entries: DirEntryView[] = children
          .filter((child) => !(child.type === 'directory' && HIDDEN_DIRS.has(child.name)))
          .slice(0, MAX_ENTRIES)
          .map((child) => child.size === undefined
            ? { name: child.name, type: child.type }
            : { name: child.name, type: child.type, size: child.size })
        json(res, 200, {
          path: resolved.target.displayPath,
          entries,
          truncated: children.length > MAX_ENTRIES,
        })
      } catch (error) {
        json(res, 500, { ly_do: fsCode(error) ?? 'không đọc được thư mục' })
      }
    },
  })

  const offRead = ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/fs/read',
    handler: async (req, res) => {
      const url = guard(req, res)
      if (url === undefined) return
      const resolved = await resolveInsideWorkspace(ctx, url)
      if (!resolved.ok) { json(res, resolved.status, { ly_do: resolved.ly_do }); return }
      try {
        const info = await ctx.fs.stat(resolved.target)
        if (info?.type !== 'file') { json(res, 400, { ly_do: 'không phải file' }); return }
        const size = info.size ?? 0
        // File lớn: chỉ lấy phần đầu. `readBytes` có chặn trên cứng nên đây là
        // đường duy nhất không kéo cả trăm megabyte vào bộ nhớ.
        if (size > MAX_PREVIEW_BYTES) {
          const bytes = await ctx.fs.readBytes(resolved.target, undefined, MAX_PREVIEW_BYTES)
          json(res, 200, {
            path: resolved.target.displayPath,
            size,
            truncated: true,
            text: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
          })
          return
        }
        const text = await ctx.fs.readText(resolved.target)
        json(res, 200, { path: resolved.target.displayPath, size, truncated: false, text })
      } catch (error) {
        // File nhị phân không phải sự cố — nó là một câu trả lời hợp lệ mà giao
        // diện cần để hiện "không xem trước được kiểu file này".
        if (fsCode(error) === 'FS_NOT_TEXT') {
          json(res, 200, { path: resolved.target.displayPath, binary: true })
          return
        }
        json(res, 500, { ly_do: fsCode(error) ?? 'không đọc được file' })
      }
    },
  })

  return () => { offList(); offRead() }
}
