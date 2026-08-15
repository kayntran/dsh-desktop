/**
 * Rào tin cậy trình duyệt cho mọi route `/hdw/*`.
 *
 * Đây là bản chép có chủ ý của `isTrustedApiRequest` trong upstream
 * (`_upstream_dsh/packages/client/connection/src/api-request-trust.ts`).
 * Không import lại được: plugin phân giải module từ thư mục của chính nó, mà ở
 * đó không có `@deepseek-ai/dsh-client-connection`. Rào của ta phải ngang bằng
 * rào của họ, nên chép nguyên logic là lựa chọn đúng — và khi nâng cấp engine
 * thì đối chiếu lại với file gốc nêu trên.
 *
 * Nó chống hai đường "phó sứ bị lừa" mà một trình duyệt mở ra trước một API
 * chạy trên máy: DNS rebinding (header `Host` mang tên miền của kẻ tấn công
 * trong khi socket vẫn tới server này) và request cross-site do một trang độc
 * hại bắn ra.
 *
 * Nó KHÔNG phải lớp xác thực: một tiến trình khác trên cùng máy vẫn gọi được.
 * Điều đó đúng cả với `/api` của upstream, nơi agent chạy lệnh shell — nên
 * route của ta không làm rộng thêm mặt tấn công vốn có.
 * @module
 */

import type { IncomingMessage } from 'node:http'

/**
 * Hostname có phải địa chỉ loopback không.
 * @param hostname - hostname đã chuẩn hoá theo WHATWG (IPv6 còn nguyên ngoặc).
 * @returns true với localhost, loopback IPv6, hoặc bất kỳ IPv4 nào trong 127/8.
 */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Chuẩn hoá một authority của header `Host`, hoặc undefined nếu không phân tích được. */
function parseAuthority(authority: string): URL | undefined {
  try {
    // `http:` là "special scheme" của WHATWG: phân tích xong thì hostname
    // không rỗng, hoặc ném.
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Request này có được phép chạm vào route của plugin không.
 * @param req - request HTTP đang tới.
 * @returns true khi `Host` là của ta và mọi dấu hiệu trình duyệt đều cùng gốc.
 */
export function isTrustedRequest(req: IncomingMessage): boolean {
  // Rào Host, áp cho MỌI request: một lần đọc của trình duyệt qua HTTP thường
  // (ảnh, điều hướng) không mang Origin lẫn Fetch-Metadata, nhìn không khác gì
  // curl — nên không có lối tắt nào theo dấu hiệu. `Host` là thứ duy nhất mà
  // rebinding không giả được.
  const host = header(req, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname)) return false

  // Rào cross-site: trình duyệt hiện đại dán nhãn quan hệ với bên khởi tạo lên
  // mọi fetch. Nhãn cross-site thì từ chối, bất kể Origin là gì.
  if (header(req, 'sec-fetch-site') === 'cross-site') return false

  // Rào Origin: có Origin thì phải đúng bằng authority này. Không có Origin là
  // bình thường — rào Host ở trên đã ràng buộc rồi. Chuỗi "null" (iframe
  // sandbox, trang file:) là origin mờ đục, từ chối.
  const origin = header(req, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
