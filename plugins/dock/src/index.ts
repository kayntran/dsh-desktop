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
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { registerBusRoutes, type ToolProbe } from './bus-routes.ts'
import { registerFsRoutes } from './fs-routes.ts'
import { registerPtyRoutes } from './pty-routes.ts'
import { registerShotRoutes } from './shot-routes.ts'
import { registerBrowserTools } from './tools.ts'

export const name = 'harness-desktop-dock'

/**
 * Service cần có trước khi `apply` chạy. Cordis giữ fiber ở trạng thái chờ tới
 * khi đủ, nên không cần tự kiểm tra sự tồn tại của chúng.
 */
export const inject = ['webServer', 'fs', 'workspaceRegistry', 'tools', 'attachments']

/**
 * Thân plugin.
 * @param ctx - context của plugin.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => registerFsRoutes(ctx), 'hdw-dock: route Files')
  ctx.effect(() => registerPtyRoutes(ctx), 'hdw-dock: route Terminal')
  // Cầu nối tới nửa giao diện, và bộ tool đứng trên nó.
  //
  // Hai thứ này buộc phải cùng một `effect`: tool giữ tham chiếu tới `bus`, nên
  // gỡ cầu mà để tool sống là để lại một bộ tool gọi vào hư không — agent nhờ gì
  // cũng hết giờ, không có lỗi nào báo. Cùng vòng đời thì cùng sống, cùng chết.
  ctx.effect(() => {
    const shot = registerShotRoutes(ctx)
    // Ô rỗng, điền ngay dưới. Cầu phải có trước vì tool giữ tham chiếu tới nó.
    const probe: ToolProbe = {}
    const { bus, dispose } = registerBusRoutes(ctx, async (id) => shot.link.capture(id), probe)
    const { tools, dispose: offTools } = registerBrowserTools(ctx, bus, shot.link)

    probe.run = async (name, args) => {
      const tool = tools.find((t) => t.name === name)
      if (tool === undefined) {
        throw new Error(`không có tool tên "${name}" — có: ${tools.map((t) => t.name).join(', ')}`)
      }
      // Không có agent nào đang chạy ở đường này, và tool nào cũng phải chịu
      // được điều đó: `modelReadsImages` hỏi qua `exec.agent?` rồi hỏng theo
      // hướng đóng. Đúng cái nhánh mà model DeepSeek chạy hằng ngày.
      const exec = { signal: AbortSignal.timeout(90_000) } as unknown as ToolRunContext
      // `execute` khai trả `unknown`, còn `render` đòi JSON — mà giá trị đi qua
      // đây LÀ JSON: nó vừa được gửi qua cầu WebSocket. Ép kiểu ở đúng một chỗ.
      const value = await tool.execute(args, exec) as never
      const blocks = tool.output.render(args as never, value) as Array<{ type?: string, text?: string }>
      return {
        value: value as unknown,
        text: blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n'),
        meta: tool.output.presentationMeta?.(args as never, value),
      }
    }

    return () => { offTools(); shot.dispose(); dispose() }
  }, 'hdw-dock: cầu nối và bộ lệnh trình duyệt')
}
