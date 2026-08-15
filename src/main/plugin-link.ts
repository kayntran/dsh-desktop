/**
 * Làm cho plugin riêng của app phân giải được từ phía engine.
 *
 * Vì sao cần bước này: engine tìm nửa giao diện của một plugin bằng
 * `createRequire(<thư mục profile>).resolve('<tên gói>/package.json')`. Thư mục
 * profile nằm trong `~/.dsh`, còn plugin của ta nằm trong thư mục app — Node
 * không có đường nào đi từ chỗ nọ sang chỗ kia. Một junction trong cây phân
 * giải của profile nối hai chỗ lại.
 *
 * Khai đường dẫn tuyệt đối trong `cordis.patch.yml` thay cho tên gói thì nửa
 * Node vẫn chạy, engine không báo lỗi gì, mà panel đơn giản là không bao giờ
 * hiện ra — nên bước này không có đường tắt nào an toàn hơn.
 *
 * Chỗ đặt junction là `<DSH_HOME>/profiles/node_modules/`, đúng thư mục mà
 * upstream tự dựng và tự chữa cây junction của nó
 * (`healProfilesModuleFallback`), và routine đó chỉ thêm chứ không xoá tên lạ.
 * @module
 */

import { lstatSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { logShell } from './log.js'
import { dockPluginDir, dshHome } from './paths.js'

/** Tên gói của plugin panel — phải khớp `package.json` và `cordis.patch.yml`. */
const DOCK_PACKAGE = 'harness-desktop-dock'

function lstatOrUndefined(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

/**
 * Dựng junction trỏ tới một thư mục, gọi lại được nhiều lần.
 *
 * Luôn tạo lại thay vì so đích cũ: trên Windows, `readlink` của một junction
 * trả về dạng `\\?\D:\...` nên so chuỗi không đáng tin, mà tạo lại thì rẻ.
 * @param link - đường dẫn junction cần có.
 * @param target - thư mục thật nó trỏ tới.
 * @throws khi vị trí junction đã bị một thư mục thật chiếm chỗ.
 */
function ensureJunction(link: string, target: string): void {
  const info = lstatOrUndefined(link)
  if (info?.isSymbolicLink() === true) {
    unlinkSync(link)
  } else if (info !== undefined) {
    throw new Error(`${link} đã là thư mục thật, không phải junction — dừng lại thay vì xoá đồ của người khác`)
  }
  // Junction trên Windows không cần quyền quản trị, khác với symlink thường.
  symlinkSync(target, link, 'junction')
}

/**
 * Nối các plugin của app vào cây phân giải module của profile dsh.
 *
 * Chạy lại mỗi lần khởi động nên tự lành: người dùng đổi chỗ thư mục app, hay
 * một công cụ nào đó dọn mất junction, lần mở app sau là có lại.
 *
 * Không ném ra ngoài: link hỏng thì app mất panel, còn ném thì app mất engine.
 * Đánh đổi đó chỉ có một chiều đúng.
 */
export function linkPlugins(): void {
  try {
    const dir = join(dshHome(), 'profiles', 'node_modules')
    mkdirSync(dir, { recursive: true })
    ensureJunction(join(dir, DOCK_PACKAGE), dockPluginDir())
    logShell(`plugin: đã nối ${DOCK_PACKAGE} vào ${dir}`)
  } catch (error) {
    logShell(`plugin: KHÔNG nối được ${DOCK_PACKAGE} — ${error instanceof Error ? error.message : String(error)}`)
  }
}
