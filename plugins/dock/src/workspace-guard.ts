/**
 * Rào workspace: một đường dẫn client gửi lên chỉ được chấp nhận khi nó là một
 * workspace **đã đăng ký với engine**.
 *
 * Đây là rào do server quyết định. Nếu để client tự khai thư mục gốc thì sửa
 * URL một cái là duyệt được cả ổ đĩa — và với tab Terminal thì còn nặng hơn:
 * mở được shell ở bất cứ đâu. Danh sách workspace là thứ duy nhất client không
 * bịa ra được.
 *
 * Tách riêng khỏi `fs-routes.ts` vì tab Files và tab Terminal cùng cần đúng
 * rào này. Một rào an ninh bị chép làm hai bản là một rào sớm muộn lệch nhau.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'

// Kéo khai báo bổ sung vào chương trình: hai gói này gắn `fs` và
// `workspaceRegistry` lên `Context` bằng declaration merging, mà merge chỉ có
// hiệu lực khi module thực sự được nạp.
import type {} from '@deepseek-ai/dsh-workspace'

/**
 * Phân giải một đường dẫn và xác nhận nó là workspace đã đăng ký.
 *
 * So SAU KHI phân giải chứ không so chuỗi: `C:/x` và `C:\x` là cùng một thư mục
 * nhưng khác nhau từng ký tự. So chuỗi thì một cách viết hợp lệ bị từ chối mà
 * không ai hiểu vì sao, còn rào thì vẫn nguyên vẹn theo cách này — chỉ thư mục
 * đã đăng ký mới lọt, viết kiểu gì cũng vậy.
 * @param ctx - context của plugin; cần `fs` và `workspaceRegistry`.
 * @param root - đường dẫn client gửi lên.
 * @returns target đã phân giải, hoặc undefined nếu không phải workspace đã đăng ký.
 */
export async function resolveWorkspaceRoot(ctx: Context, root: string): Promise<FsTarget | undefined> {
  let target: FsTarget
  try {
    target = await ctx.fs.resolve(root)
  } catch {
    return undefined
  }
  const registered = await Promise.all(
    ctx.workspaceRegistry.list().map(async (workspace) => {
      try {
        return (await ctx.fs.resolve(workspace.path)).targetKey
      } catch {
        // Workspace trỏ vào thư mục đã bị xoá — bỏ qua, đừng làm hỏng cả request.
        return undefined
      }
    }),
  )
  return registered.includes(target.targetKey) ? target : undefined
}
