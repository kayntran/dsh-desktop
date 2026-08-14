/**
 * Icon khay hệ thống và menu chuột phải.
 *
 * Khay là nơi app sống khi cửa sổ đã đóng: agent có thể đang chạy một việc dài,
 * và đóng cửa sổ không nên giết nó.
 * @module
 */

import { app, Menu, Tray } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resourcePath } from './paths.js'

/** Những việc menu khay gọi ngược về tiến trình chính. */
export interface TrayHandlers {
  /** Hiện và focus cửa sổ. */
  open: () => void
  /** Mở thư mục dữ liệu của dsh. */
  openDataDir: () => void
  /** Mở file log của engine. */
  openLog: () => void
  /** Mở file log của lớp vỏ app. */
  openShellLog: () => void
  /** Mở màn hình Giới thiệu. */
  openAbout: () => void
  /** Mở trang tải bản mới. */
  openRelease: () => void
  /** Thoát hẳn, dừng cả engine. */
  quit: () => void
}

let tray: Tray | undefined
let handlers: TrayHandlers | undefined
let status = 'Đang khởi động…'
let updateVersion: string | undefined

/** Thư mục dữ liệu dsh dùng — mặc định `~/.dsh`, đổi được bằng biến môi trường. */
export function dshHome(): string {
  return process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
}

function buildMenu(): Menu {
  const bound = handlers
  return Menu.buildFromTemplate([
    { label: `Mở ${app.getName()}`, click: () => bound?.open() },
    { type: 'separator' },
    { label: status, enabled: false },
    ...updateVersion === undefined ? [] : [{
      label: `Đã có bản ${updateVersion} — tải về`,
      click: () => bound?.openRelease(),
    }],
    { type: 'separator' },
    { label: 'Mở thư mục dữ liệu', click: () => bound?.openDataDir() },
    { label: 'Mở log của engine', click: () => bound?.openLog() },
    { label: 'Mở log của app', click: () => bound?.openShellLog() },
    { type: 'separator' },
    { label: 'Giới thiệu', click: () => bound?.openAbout() },
    { label: 'Thoát', click: () => bound?.quit() },
  ])
}

function refresh(): void {
  tray?.setToolTip(`${app.getName()} — ${status}`)
  tray?.setContextMenu(buildMenu())
}

/** Dựng icon khay. Gọi một lần sau khi app sẵn sàng. */
export function createTray(trayHandlers: TrayHandlers): void {
  handlers = trayHandlers
  // Electron tự chọn tray@2x.png trên màn hình DPI cao.
  tray = new Tray(resourcePath('tray.png'))
  tray.on('click', () => { trayHandlers.open() })
  tray.on('double-click', () => { trayHandlers.open() })
  refresh()
}

/** Cập nhật dòng trạng thái trong menu và tooltip. */
export function setTrayStatus(text: string): void {
  status = text
  refresh()
}

/** Thêm mục tải bản mới vào menu khay. */
export function setTrayUpdate(version: string): void {
  updateVersion = version
  refresh()
}

/**
 * Giải thích một lần duy nhất rằng app lui về khay chứ không tắt.
 *
 * Người dùng bấm X và thấy cửa sổ biến mất mà tiến trình vẫn còn sẽ tưởng app
 * treo; nói rõ đúng một lần rồi thôi, những lần sau đã là hành vi quen thuộc.
 */
export function hintHiddenToTray(): void {
  const marker = join(app.getPath('userData'), 'tray-hint-shown')
  if (existsSync(marker)) return
  try {
    writeFileSync(marker, '')
  } catch {
    // Không ghi được thì cùng lắm là lần sau nhắc lại — không đáng chặn luồng.
  }
  tray?.displayBalloon({
    title: `${app.getName()} vẫn đang chạy`,
    content: 'App thu về khay hệ thống để agent làm nốt việc. Chuột phải vào icon để mở lại hoặc thoát hẳn.',
    iconType: 'info',
  })
}

/** Gỡ icon khay khi thoát. */
export function destroyTray(): void {
  tray?.destroy()
  tray = undefined
}
