/**
 * Đổi dữ liệu ảnh đi kèm kết quả thành một địa chỉ mà thẻ `<img>` hiển thị được.
 *
 * Chỉ ghép chuỗi, không tải gì: byte ảnh do route `/hdw/image` của nửa Node phục
 * vụ (xem `../image-routes.ts` để biết vì sao phải tự mở đường đó thay vì dùng
 * `session.readAttachment` của engine). Trình duyệt tự lo phần tải, phần đệm,
 * phần huỷ khi rời trang — ba việc mà một bộ nạp tự viết chỉ có thể làm tệ hơn.
 * @module
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

/**
 * Địa chỉ xem được của một ảnh đã lưu.
 *
 * Cùng gốc với trang, vì nửa Node và giao diện ở chung một web server — đó cũng
 * là điều kiện để `isTrustedRequest` bên kia cho qua.
 * @param attachment - tham chiếu ảnh dựng từ dữ liệu đi kèm kết quả.
 * @returns địa chỉ đặt vào `src` của thẻ ảnh.
 */
export function shotUrl(attachment: ImageAttachmentRef): string {
  const query = new URLSearchParams({
    id: String(attachment.attachmentId),
    type: attachment.mediaType,
    bytes: String(attachment.bytes),
    w: String(attachment.width),
    h: String(attachment.height),
  })
  return `/hdw/image?${query.toString()}`
}
