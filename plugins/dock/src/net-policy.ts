/**
 * Một chỗ duy nhất quyết định một URL có trỏ ra ngoài máy này và ngoài mạng nội
 * bộ không. Agent hỏi ở đây trước khi mở trang.
 *
 * **Rào này chỉ áp cho AGENT.** Người dùng gõ tay vào thanh địa chỉ thì vẫn vào
 * được router, NAS, hay server đang chạy trên máy — đó là việc chính đáng, và
 * đường đó đi qua `chuanHoaUrl` trong `client/browser-stage.ts`, không đi qua
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
function phanTichIpv6(text: string): number[] | undefined {
  const nua = text.split('::')
  if (nua.length > 2) return undefined

  const thanhNhom = (phan: string): number[] | undefined => {
    if (phan === '') return []
    const ra: number[] = []
    for (const manh of phan.split(':')) {
      // Đuôi IPv4 nhúng, ví dụ `::ffff:127.0.0.1`.
      if (manh.includes('.')) {
        const o = phanTichIpv4(manh)
        if (o === undefined) return undefined
        const [a = 0, b = 0, c = 0, d = 0] = o
        ra.push((a << 8) | b, (c << 8) | d)
        continue
      }
      if (!/^[0-9a-f]{1,4}$/.test(manh)) return undefined
      ra.push(Number.parseInt(manh, 16))
    }
    return ra
  }

  const dau = thanhNhom(nua[0] ?? '')
  const duoi = nua.length === 2 ? thanhNhom(nua[1] ?? '') : []
  if (dau === undefined || duoi === undefined) return undefined

  if (nua.length === 1) return dau.length === 8 ? dau : undefined
  const trong = 8 - dau.length - duoi.length
  if (trong < 1) return undefined
  return [...dau, ...Array<number>(trong).fill(0), ...duoi]
}

/** Bốn octet của một địa chỉ IPv4 dạng chấm, hoặc undefined. */
function phanTichIpv4(text: string): number[] | undefined {
  const phan = text.split('.')
  if (phan.length !== 4) return undefined
  const octet: number[] = []
  for (const p of phan) {
    if (!/^\d{1,3}$/.test(p)) return undefined
    const n = Number(p)
    if (n > 255) return undefined
    octet.push(n)
  }
  return octet
}

/** Những dải nghĩa là chính máy này, đường mạng này, hoặc mạng nội bộ này. */
function laIpv4NoiBo(o: number[]): boolean {
  const a = o[0] ?? -1
  const b = o[1] ?? -1
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

function laIpv6NoiBo(g: number[]): boolean {
  const chiKhac = (n: number): boolean => g.slice(0, 7).every((x) => x === 0) && g[7] === n
  if (chiKhac(1)) return true // ::1 loopback
  if (g.every((x) => x === 0)) return true // :: chưa xác định
  // So bằng MẶT NẠ BIT, không bằng tiền tố chuỗi — xem lỗ hổng 3 ở đầu file.
  if (((g[0] ?? 0) & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if (((g[0] ?? 0) & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  // IPv4 nhúng (`::ffff:a.b.c.d` và dạng tương thích): xét theo phần v4 bên trong.
  const nhung = g.slice(0, 5).every((x) => x === 0)
  if (nhung && (g[5] === 0xffff || g[5] === 0)) {
    const g6 = g[6] ?? 0
    const g7 = g[7] ?? 0
    return laIpv4NoiBo([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff])
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
export function laHostNoiBo(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  if (host === '') return true

  // IPv6 trong `URL.hostname` LUÔN còn ngoặc vuông — xem lỗ hổng 1 ở đầu file.
  if (host.startsWith('[') && host.endsWith(']')) {
    const nhom = phanTichIpv6(host.slice(1, -1))
    return nhom === undefined ? true : laIpv6NoiBo(nhom)
  }

  const octet = phanTichIpv4(host)
  if (octet !== undefined) return laIpv4NoiBo(octet)

  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal')) return true
  if (host.endsWith('.home.arpa')) return true
  // Một nhãn đơn không có tên miền cha công cộng nào để phân giải; nó chỉ có thể
  // là một cái tên trong miền tìm kiếm của mạng nội bộ.
  if (!host.includes('.')) return true

  return false
}

/** http(s) trỏ tới một nơi không phải máy này và không phải mạng nội bộ. */
export function laUrlCongCong(url: string): boolean {
  try {
    const p = new URL(url)
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return false
    return !laHostNoiBo(p.hostname)
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
export function batBuocUrlCongCong(url: string): URL {
  let p: URL
  try {
    p = new URL(url)
  } catch {
    throw new Error('Không phải một URL hợp lệ.')
  }
  if (p.protocol !== 'http:' && p.protocol !== 'https:') {
    throw new Error('Chỉ cho phép http và https.')
  }
  if (laHostNoiBo(p.hostname)) {
    throw new Error(
      'Không được mở địa chỉ nội bộ (localhost, *.local, dải RFC1918, link-local, loopback). '
      + 'Người dùng vẫn tự gõ được địa chỉ đó vào thanh địa chỉ.',
    )
  }
  return p
}
