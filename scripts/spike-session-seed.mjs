/**
 * Plugin tí hon CHỈ dùng cho spike: dựng sẵn một phiên thứ hai.
 *
 * Vì sao cần: bài kiểm tách-panel-theo-chat phải có HAI chat thật. Bấm nút "New
 * Session" trong app không đủ — app khởi động vốn đã ở một phiên trống, nên bấm
 * lần nữa không sinh ra phiên nào, và id chat không đổi. Một phiên chỉ thật sự
 * ra đời khi có tin nhắn đầu tiên, mà spike thì không có model để gửi.
 *
 * Nên phiên thứ hai được dựng thẳng ở phía engine, đúng cách `spike-ws-seed.mjs`
 * gieo workspace. `cwd` lấy thư mục đang chạy, cũng là workspace mà bản gieo kia
 * vừa đăng ký — không có nó thì mọi route của panel từ chối phiên này.
 *
 * Không thuộc mã sản phẩm: không bao giờ nằm trong `cordis.patch.yml` của
 * plugin, không đi vào bản đóng gói.
 */

export const name = 'hdw-session-seed'
export const inject = ['sessions']

/**
 * Dựng phiên thứ hai, tên cố định để bài kiểm gọi tên được.
 *
 * ĐÃ THỬ VÀ KHÔNG ĂN: gieo thêm một phiên có sẵn tin nhắn, hòng làm app dựng
 * thanh tiêu đề phiên để bấm được nút bật panel. Phiên dựng thành công và client
 * cũng biết nó (mục 2c thấy nó trong danh sách), nhưng thanh bên vẫn bày màn hình
 * rỗng và không có hàng phiên nào để bấm vào. Nên nút bật panel vẫn phải nhờ người
 * bấm — xem mục 0.
 * @param ctx - context của plugin.
 */
export function apply(ctx) {
  try {
    ctx.sessions.create('session-hdw-spike-b', { meta: { cwd: process.cwd() } })
    console.log('[session-seed] đã dựng phiên thứ hai: session-hdw-spike-b')
  } catch (error) {
    console.log('[session-seed] không dựng được phiên thứ hai:', String(error))
  }
}
