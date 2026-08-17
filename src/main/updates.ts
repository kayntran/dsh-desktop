/**
 * Báo khi có bản mới. App KHÔNG tự cài — chỉ nói cho biết và mở trang tải.
 *
 * Việc này quan trọng hơn vẻ ngoài của nó: engine dsh đang ở giai đoạn rc và
 * thượng nguồn nói thẳng là sẽ có thay đổi phá vỡ tương thích, nên người dùng
 * kẹt ở một bản cũ có lỗi mà không biết là chuyện dễ xảy ra.
 * @module
 */

import { app, Notification, shell } from 'electron'

/**
 * Kho phát hành trên GitHub, dạng `chu-so-huu/ten-kho`.
 *
 * Chưa có kho thì để nguyên: mọi việc kiểm tra sẽ bị bỏ qua chứ không gọi mạng
 * và cũng không báo lỗi. Điền vào đây là tính năng tự bật.
 */
const REPOSITORY = ''

/** Chờ một lúc sau khi app mở rồi mới hỏi — lúc khởi động còn nhiều việc hơn. */
const FIRST_CHECK_DELAY_MS = 10_000

/** Nhịp hỏi lại khi app chạy dài ngày. */
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

/** Bản mới đã tìm thấy, nếu có. */
export interface AvailableUpdate {
  /** Số hiệu bản mới, ví dụ `1.2.0`. */
  version: string
  /** Trang phát hành để người dùng tải về. */
  url: string
}

let timers: NodeJS.Timeout[] = []
let available: AvailableUpdate | undefined
let announced = false
let onFound: ((update: AvailableUpdate) => void) | undefined

/** Tách `v1.2.3-rc.4` thành các số để so sánh; hậu tố tiền phát hành bị bỏ qua. */
function parseVersion(raw: string): { parts: number[]; prerelease: boolean } | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(raw.trim())
  if (match === null) return undefined
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] !== undefined,
  }
}

/**
 * `candidate` có mới hơn `current` không.
 *
 * So ba số chính trước; bằng nhau thì bản chính thức được coi là mới hơn bản
 * tiền phát hành cùng số. Không so sâu vào hậu tố tiền phát hành: người dùng
 * bản phát hành công khai không cần biết rc.3 hay rc.4.
 */
function isNewer(candidate: string, current: string): boolean {
  const next = parseVersion(candidate)
  const now = parseVersion(current)
  if (next === undefined || now === undefined) return false
  for (let index = 0; index < 3; index++) {
    const a = next.parts[index] ?? 0
    const b = now.parts[index] ?? 0
    if (a !== b) return a > b
  }
  return now.prerelease && !next.prerelease
}

/** Hỏi GitHub một lần. Mọi lỗi đều im lặng — đây không phải việc đáng làm phiền. */
async function check(): Promise<void> {
  if (REPOSITORY === '') return
  try {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return
    const release = await response.json() as { tag_name?: unknown; html_url?: unknown; draft?: unknown }
    if (release.draft === true) return
    const tag = typeof release.tag_name === 'string' ? release.tag_name : undefined
    const url = typeof release.html_url === 'string' ? release.html_url : undefined
    if (tag === undefined || url === undefined || !isNewer(tag, app.getVersion())) return

    available = { version: tag.replace(/^v/, ''), url }
    onFound?.(available)
    // Nói đúng một lần mỗi phiên chạy; nhắc lại mỗi sáu tiếng là quấy rầy.
    if (announced) return
    announced = true
    if (!Notification.isSupported()) return
    const notification = new Notification({
      title: `${app.getName()} ${available.version} is available`,
      body: 'Click to open the download page.',
    })
    notification.on('click', () => { openReleasePage() })
    notification.show()
  } catch {
    // Mất mạng, GitHub giới hạn tốc độ, JSON lạ — đều không phải việc của
    // người dùng.
  }
}

/**
 * Bắt đầu theo dõi bản mới.
 * @param onUpdateFound - gọi khi tìm thấy bản mới, để menu khay thêm mục tải về.
 */
export function startUpdateChecks(onUpdateFound: (update: AvailableUpdate) => void): void {
  onFound = onUpdateFound
  timers.push(setTimeout(() => { void check() }, FIRST_CHECK_DELAY_MS))
  timers.push(setInterval(() => { void check() }, RECHECK_INTERVAL_MS))
}

/** Bản mới đang chờ, nếu đã tìm thấy. */
export function pendingUpdate(): AvailableUpdate | undefined {
  return available
}

/** Mở trang phát hành của bản mới. */
export function openReleasePage(): void {
  if (available !== undefined) void shell.openExternal(available.url)
}

/** Dừng theo dõi khi thoát. */
export function stopUpdateChecks(): void {
  for (const timer of timers) clearTimeout(timer)
  timers = []
}
