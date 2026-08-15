/**
 * Một chỗ duy nhất quyết định một URL có trỏ ra ngoài máy này và ngoài mạng nội
 * bộ không. Agent hỏi ở đây trước khi mở trang.
 *
 * **Rào này chỉ áp cho AGENT.** Người dùng gõ tay vào thanh địa chỉ thì vẫn vào
 * được router, NAS, hay server đang chạy trên máy — đó là việc chính đáng, và
 * đường đó đi qua `normalizeUrl` trong `client/browser-stage.ts`, không đi qua
 * đây. Thứ rào này chặn là một trang web độc dụ agent đi dò mạng nhà người dùng
 * rồi đọc kết quả về.
 *
 * ## Chép từ đâu, và vì sao chép
 *
 * Port nguyên logic từ dự án tham chiếu `D:\AI\DeepSeek Agentic AI`, file
 * `app/src/core/net-policy.ts`. Chép chứ không import vì đó là dự án khác; đối
 * chiếu lại nếu bên đó sửa. Cùng lý do và cùng cách làm với `trust.ts`.
 *
 * Bản gốc ghi rõ **ba lỗ hổng** mà nó đã trả giá để bịt, và cả ba đều là loại
 * lỗi im lặng — rào vẫn chạy, vẫn trả lời, chỉ là trả lời sai:
 *
 *   1. `new URL("http://[::1]/").hostname` trả về `"[::1]"` — **kèm ngoặc
 *      vuông**. So với `"::1"` thì không bao giờ khớp, và `startsWith("fd")`
 *      cũng không khớp `"[fd00::1]"`. Kết quả: mọi địa chỉ IPv6 nội bộ đều lọt.
 *   2. Chỉ liệt `127.0.0.1` nên phần còn lại của `127.0.0.0/8` đi thẳng qua, và
 *      `0.0.0.0` cũng vậy (trên Windows và Linux nó về localhost).
 *   3. `startsWith("fc")` định nhắm dải ULA của IPv6 nhưng khớp nhầm `fc2.com`.
 *      Cột "chặn oan" quan trọng không kém: một rào chặn nhầm trang thật là một
 *      rào sẽ bị tắt.
 *
 * ## Thứ nó CỐ Ý không làm
 *
 * Không phân giải tên miền. Một tên công cộng mà DNS trả về `127.0.0.1` thì lọt
 * qua đây, và một tên trả lời khác đi ở lần tra thứ hai (DNS rebinding) cũng
 * lọt. Bịt được chỗ đó phải kiểm ở tầng kết nối, dưới tầng URL. Hãy coi đây là
 * bộ lọc những mục tiêu nội bộ lộ liễu, không phải hàng rào sống sót trước kẻ
 * điều khiển được DNS.
 * @module
 */

/** Các nhóm 16-bit của một địa chỉ IPv6, hoặc undefined nếu không phân tích được. */
function parseIpv6(text: string): number[] | undefined {
  const halves = text.split('::')
  if (halves.length > 2) return undefined

  const toGroups = (part: string): number[] | undefined => {
    if (part === '') return []
    const out: number[] = []
    for (const piece of part.split(':')) {
      // Đuôi IPv4 nhúng, ví dụ `::ffff:127.0.0.1`.
      if (piece.includes('.')) {
        const embedded = parseIpv4(piece)
        if (embedded === undefined) return undefined
        const [a = 0, b = 0, c = 0, d = 0] = embedded
        out.push((a << 8) | b, (c << 8) | d)
        continue
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return undefined
      out.push(Number.parseInt(piece, 16))
    }
    return out
  }

  const head = toGroups(halves[0] ?? '')
  const tail = halves.length === 2 ? toGroups(halves[1] ?? '') : []
  if (head === undefined || tail === undefined) return undefined

  if (halves.length === 1) return head.length === 8 ? head : undefined
  const gap = 8 - head.length - tail.length
  if (gap < 1) return undefined
  return [...head, ...Array<number>(gap).fill(0), ...tail]
}

/** Bốn octet của một địa chỉ IPv4 dạng chấm, hoặc undefined. */
function parseIpv4(text: string): number[] | undefined {
  const parts = text.split('.')
  if (parts.length !== 4) return undefined
  const octets: number[] = []
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return undefined
    const n = Number(p)
    if (n > 255) return undefined
    octets.push(n)
  }
  return octets
}

/** Những dải nghĩa là chính máy này, đường mạng này, hoặc mạng nội bộ này. */
function isPrivateIpv4(octets: number[]): boolean {
  const a = octets[0] ?? -1
  const b = octets[1] ?? -1
  if (a === 0) return true // 0.0.0.0/8 — "chính máy này"
  if (a === 10) return true // RFC1918
  if (a === 127) return true // loopback, CẢ dải /8
  if (a === 169 && b === 254) return true // link-local, gồm cả địa chỉ metadata của cloud
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true // dải đo hiệu năng
  if (a >= 224) return true // multicast + dành riêng + broadcast
  return false
}

function isPrivateIpv6(groups: number[]): boolean {
  const onlyLast = (n: number): boolean => groups.slice(0, 7).every((x) => x === 0) && groups[7] === n
  if (onlyLast(1)) return true // ::1 loopback
  if (groups.every((x) => x === 0)) return true // :: chưa xác định
  // So bằng MẶT NẠ BIT, không bằng tiền tố chuỗi — xem lỗ hổng 3 ở đầu file.
  if (((groups[0] ?? 0) & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if (((groups[0] ?? 0) & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  // IPv4 nhúng (`::ffff:a.b.c.d` và dạng tương thích): xét theo phần v4 bên trong.
  const embedded = groups.slice(0, 5).every((x) => x === 0)
  if (embedded && (groups[5] === 0xffff || groups[5] === 0)) {
    const g6 = groups[6] ?? 0
    const g7 = groups[7] ?? 0
    return isPrivateIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff])
  }
  return false
}

/**
 * Hostname có trỏ về chính máy này, đường mạng này, hay một mạng nội bộ không.
 *
 * Nhận **`URL.hostname`**, tức là chuỗi đã được chuẩn hoá sẵn: bộ phân tích
 * WHATWG biến `2130706433`, `0x7f000001`, `0177.0.0.1` và `127.1` thành
 * `127.0.0.1` trước khi hàm này nhìn thấy, và hạ chữ thường mọi tên miền. Truyền
 * một chuỗi host thô chưa qua `new URL()` vào đây là tự bỏ hết những phép chuẩn
 * hoá đó.
 *
 * Thứ không phân tích được thì coi là nội bộ: một hình dạng ta không hiểu thì
 * hỏng theo hướng đóng, không hỏng theo hướng mở.
 * @param hostname - `URL.hostname` đã chuẩn hoá.
 * @returns true khi địa chỉ thuộc về máy này hoặc mạng nội bộ.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  if (host === '') return true

  // IPv6 trong `URL.hostname` LUÔN còn ngoặc vuông — xem lỗ hổng 1 ở đầu file.
  if (host.startsWith('[') && host.endsWith(']')) {
    const groups = parseIpv6(host.slice(1, -1))
    return groups === undefined ? true : isPrivateIpv6(groups)
  }

  const octets = parseIpv4(host)
  if (octets !== undefined) return isPrivateIpv4(octets)

  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal')) return true
  if (host.endsWith('.home.arpa')) return true
  // Một nhãn đơn không có tên miền cha công cộng nào để phân giải; nó chỉ có thể
  // là một cái tên trong miền tìm kiếm của mạng nội bộ.
  if (!host.includes('.')) return true

  return false
}

/** http(s) trỏ tới một nơi không phải máy này và không phải mạng nội bộ. */
export function isPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return !isPrivateHost(parsed.hostname)
  } catch {
    return false
  }
}

/**
 * Cùng phép kiểm, nhưng nói rõ luật nào từ chối — câu này đi thẳng tới model.
 * @param url - địa chỉ agent muốn mở.
 * @returns URL đã phân tích, dùng lại được.
 * @throws khi URL không hợp lệ, sai scheme, hoặc trỏ vào mạng nội bộ.
 */
export function assertPublicUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Không phải một URL hợp lệ.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Chỉ cho phép http và https.')
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error(
      'Không được mở địa chỉ nội bộ (localhost, *.local, dải RFC1918, link-local, loopback). '
      + 'Người dùng vẫn tự gõ được địa chỉ đó vào thanh địa chỉ.',
    )
  }
  return parsed
}
