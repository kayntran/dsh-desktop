/**
 * Ghi nhớ vị trí và kích thước cửa sổ giữa các lần mở app.
 *
 * Vị trí đã lưu chỉ được dùng lại khi còn nhìn thấy được: người dùng rút màn
 * hình phụ ra thì cửa sổ không được mở ở một toạ độ nằm ngoài mọi màn hình.
 * @module
 */

import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Kích thước mặc định cho lần chạy đầu tiên. */
const DEFAULT_SIZE = { width: 1280, height: 860 }

/** Kích thước nhỏ nhất chấp nhận được, khớp với `minWidth`/`minHeight` của cửa sổ. */
const MIN_SIZE = { width: 900, height: 600 }

/** Hoãn ghi đĩa trong lúc người dùng còn đang kéo thả cửa sổ. */
const SAVE_DEBOUNCE_MS = 400

/** Trạng thái cửa sổ được lưu lại. */
interface WindowState {
  /** Khung cửa sổ ở trạng thái bình thường (không phóng to). */
  bounds: Rectangle
  /** Cửa sổ có đang phóng to hay không. */
  maximized: boolean
}

function statePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/** Khung có nằm trong vùng làm việc của ít nhất một màn hình đang gắn không. */
function isVisible(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x)
    const overlapY = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y)
    // Đòi một mảng đủ lớn chứ không chỉ chạm mép: thanh tiêu đề phải với tới được.
    return overlapX > 120 && overlapY > 60
  })
}

function isRectangle(value: unknown): value is Rectangle {
  const candidate = value as Partial<Rectangle> | null
  return candidate !== null && typeof candidate === 'object'
    && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(candidate[key as keyof Rectangle]))
}

/**
 * Đọc trạng thái đã lưu, bỏ qua nếu file hỏng hoặc vị trí không còn nhìn thấy.
 * @returns tuỳ chọn khung để truyền vào `BrowserWindow`, kèm cờ phóng to.
 */
export function restoreState(): { bounds: Partial<Rectangle>; maximized: boolean } {
  const fallback = { bounds: DEFAULT_SIZE, maximized: false }
  const path = statePath()
  if (!existsSync(path)) return fallback
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const state = parsed as Partial<WindowState>
    if (!isRectangle(state.bounds)) return fallback
    const bounds = {
      ...state.bounds,
      width: Math.max(state.bounds.width, MIN_SIZE.width),
      height: Math.max(state.bounds.height, MIN_SIZE.height),
    }
    // Kích thước vẫn dùng lại được kể cả khi toạ độ đã lạc ra ngoài màn hình;
    // chỉ vị trí là thứ phải bỏ, và bỏ vị trí thì Electron tự canh giữa.
    if (!isVisible(bounds)) {
      return { bounds: { width: bounds.width, height: bounds.height }, maximized: state.maximized === true }
    }
    return { bounds, maximized: state.maximized === true }
  } catch {
    return fallback
  }
}

/** Theo dõi cửa sổ và ghi lại trạng thái mỗi khi người dùng đổi vị trí, kích thước, hoặc đóng. */
export function trackState(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined

  const save = (): void => {
    if (window.isDestroyed()) return
    const state: WindowState = {
      // getNormalBounds trả khung trước khi phóng to, nên khôi phục lại đúng
      // kích thước người dùng từng chọn thay vì kích thước toàn màn hình.
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
    }
    try {
      writeFileSync(statePath(), JSON.stringify(state))
    } catch {
      // Không ghi được thì lần sau mở ở kích thước mặc định — không đáng làm phiền.
    }
  }

  const scheduleSave = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(save, SAVE_DEBOUNCE_MS)
  }

  window.on('resize', scheduleSave)
  window.on('move', scheduleSave)
  window.on('maximize', scheduleSave)
  window.on('unmaximize', scheduleSave)
  // Ghi ngay khi đóng: hẹn giờ sẽ không kịp chạy trước lúc app thoát.
  window.on('close', () => {
    if (timer !== undefined) clearTimeout(timer)
    save()
  })
}
