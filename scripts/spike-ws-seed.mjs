/**
 * Plugin tí hon CHỈ dùng cho spike: đăng ký thư mục đang chạy thành một
 * workspace của engine.
 *
 * Vì sao cần: mọi route của panel (`/hdw/fs/*`, `/hdw/pty`) đều đi qua rào
 * workspace — client không tự khai được thư mục gốc, chỉ workspace đã đăng ký
 * mới lọt. Spike dùng `DSH_HOME` tạm cho sạch, mà `DSH_HOME` mới tinh thì chưa
 * có workspace nào, nên nếu không gieo thì MỌI mục kiểm đều bị từ chối — trông
 * y hệt như rào hỏng ngược.
 *
 * Không thuộc mã sản phẩm: không bao giờ nằm trong `cordis.patch.yml` của
 * plugin, không đi vào bản đóng gói.
 */

export const name = 'hdw-ws-seed'
export const inject = ['workspaceRegistry']

/**
 * Đăng ký cwd thành workspace.
 * @param ctx - context của plugin.
 */
export function apply(ctx) {
  ctx.workspaceRegistry.create(process.cwd(), 'hdw-spike').then(
    () => {},
    (loi) => { console.log('[ws-seed] không đăng ký được workspace:', String(loi)) },
  )
}
