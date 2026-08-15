/**
 * Định vị các đường dẫn phụ thuộc vào việc app đang chạy dev hay đã đóng gói.
 * @module
 */

import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Thư mục dữ liệu dsh dùng — mặc định `~/.dsh`, đổi được bằng biến môi trường.
 *
 * Cách xử lý biến môi trường phải khớp `resolveDshHome` của upstream
 * (`_upstream_dsh/packages/util/home-paths/src/index.ts:87`): giá trị rỗng hay
 * toàn khoảng trắng coi như chưa đặt, và `~` được khai triển. Lệch ở đây thì
 * app và engine sẽ trỏ vào hai thư mục khác nhau mà không báo gì.
 */
export function dshHome(): string {
  const fromEnv = process.env['DSH_HOME']
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  return resolve(selected.startsWith('~') ? join(homedir(), selected.slice(1)) : selected)
}

/**
 * Thư mục chứa cây phụ thuộc của engine.
 *
 * Engine sống tách khỏi node_modules của app và được chép nguyên khối vào
 * `resources/engine` khi đóng gói. Hai lý do: nó chạy trong một tiến trình Node
 * riêng nên phải phân giải module bằng đường dẫn thật trên đĩa (không nhìn được
 * vào asar), và các gói của dsh khai báo phụ thuộc bằng peerDependencies mà
 * trình đóng gói không lần theo — chép nguyên khối thì npm đã lo xong phần
 * phân giải. Xem `engine/package.json`.
 */
function engineRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'engine')
    : join(app.getAppPath(), 'engine')
}

/** Entry point của CLI dsh — thứ engine spawn chạy. */
export function dshBinPath(): string {
  return join(engineRoot(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

/**
 * Node runtime đóng gói kèm app, nơi engine dsh thực sự chạy.
 *
 * App KHÔNG dùng binary Electron ở chế độ Node cho việc này. V8 trong Electron
 * bật memory cage, nên N-API không tạo được external ArrayBuffer; koffi —
 * thứ upstream gọi dialog chọn thư mục của Windows qua đó — cần đúng khả năng
 * ấy, và khi thiếu thì tiến trình chết hẳn (`FATAL ERROR: Error::New`) chứ
 * không ném ra lỗi bắt được. Một node.exe chính thức tránh cả lớp lỗi đó.
 *
 * Tải về bằng `npm run runtime:install`; xem `scripts/fetch-node.ps1`.
 */
export function nodeExePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'runtime', 'node.exe')
    : join(app.getAppPath(), 'runtime', 'node.exe')
}

/** Version dsh đang dùng, hiển thị ở màn hình Giới thiệu. */
export function dshVersion(): string {
  try {
    const manifest = join(engineRoot(), 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
    const version = (parsed as { version?: unknown }).version
    return typeof version === 'string' ? version : 'không rõ'
  } catch {
    return 'không rõ'
  }
}

/**
 * Version của Node runtime đóng gói, hiển thị ở màn hình Giới thiệu. Hỏi thẳng
 * binary thay vì ghi cứng một con số, để cái hiện ra luôn là cái thật sự chạy.
 */
export function nodeVersion(): string {
  try {
    return execFileSync(nodeExePath(), ['-v'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    }).trim()
  } catch {
    return 'không rõ'
  }
}

/**
 * Thư mục chứa các plugin riêng của app.
 *
 * Cùng lý do với `engineRoot`: engine chạy trong một tiến trình Node riêng nên
 * phải đọc plugin bằng đường dẫn thật trên đĩa, không nhìn được vào asar. Khi
 * đóng gói, `electron-builder.yml` chép `plugins/` vào `resources/plugins`.
 */
export function pluginsRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'plugins')
    : join(app.getAppPath(), 'plugins')
}

/** Thư mục plugin panel phải (Files / Terminal / Browser). */
export function dockPluginDir(): string {
  return join(pluginsRoot(), 'dock')
}

/** File cấu hình bật plugin panel phải, truyền cho engine qua `--patch`. */
export function dockPatchPath(): string {
  return join(dockPluginDir(), 'cordis.patch.yml')
}

/** Tài nguyên tĩnh (splash, trang lỗi, icon) đi kèm app. */
export function resourcePath(...parts: string[]): string {
  return join(app.getAppPath(), 'resources', ...parts)
}

/** Log stdout/stderr của engine, để trang lỗi và menu tray mở ra được. */
export function engineLogPath(): string {
  return join(app.getPath('userData'), 'engine.log')
}

/** File ghi PID engine, dùng để dọn tiến trình sót sau một lần tắt cứng. */
export function enginePidPath(): string {
  return join(app.getPath('userData'), 'engine.pid')
}
