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
import { dockPluginDir, dshHome, pluginManagerDir } from './paths.js'

/**
 * Each plugin's package name and its real directory. The name must match that
 * plugin's own `package.json` and `cordis.patch.yml`.
 */
const PLUGIN_PACKAGES: readonly { name: string, dir: () => string }[] = [
  { name: 'harness-desktop-dock', dir: dockPluginDir },
  { name: 'harness-desktop-plugin-manager', dir: pluginManagerDir },
]

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
    throw new Error(`${link} is a real directory, not a junction — stopping rather than deleting someone else's files`)
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
  const dir = join(dshHome(), 'profiles', 'node_modules')
  // One `try` per plugin: a broken link costs only that plugin, the rest still get
  // linked.
  for (const plugin of PLUGIN_PACKAGES) {
    try {
      mkdirSync(dir, { recursive: true })
      ensureJunction(join(dir, plugin.name), plugin.dir())
      logShell(`plugin: linked ${plugin.name} into ${dir}`)
    } catch (error) {
      logShell(`plugin: could NOT link ${plugin.name} — ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
