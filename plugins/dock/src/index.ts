/**
 * Nửa Node của panel phải: chạy trong tiến trình engine dsh, phục vụ dữ liệu
 * cho nửa giao diện qua HTTP loopback cùng gốc.
 *
 * Nửa giao diện nằm ở `src/client/`, được engine phục vụ tại
 * `/plugins/harness-desktop-dock/client.js`. Hai nửa không dùng IPC của
 * Electron — cửa sổ app trỏ thẳng vào web UI của engine nên `fetch` là cùng
 * gốc, và đường đó cũng chính là đường mà mọi plugin khác của upstream đi.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerBusRoutes } from './bus-routes.ts'
import { registerFsRoutes } from './fs-routes.ts'
import { registerPtyRoutes } from './pty-routes.ts'

export const name = 'harness-desktop-dock'

/**
 * Service cần có trước khi `apply` chạy. Cordis giữ fiber ở trạng thái chờ tới
 * khi đủ, nên không cần tự kiểm tra sự tồn tại của chúng.
 */
export const inject = ['webServer', 'fs', 'workspaceRegistry']

/**
 * Thân plugin.
 * @param ctx - context của plugin.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => registerFsRoutes(ctx), 'hdw-dock: route Files')
  ctx.effect(() => registerPtyRoutes(ctx), 'hdw-dock: route Terminal')
  // Cầu nối tới nửa giao diện. Hiện chưa có tool nào gọi nó — nó là nền móng
  // cho tầng tool sắp tới, và `bus` trả về ở đây chính là bề mặt tầng đó dùng.
  ctx.effect(() => registerBusRoutes(ctx).dispose, 'hdw-dock: cầu nối giao diện')
}
