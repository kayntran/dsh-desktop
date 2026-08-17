/**
 * Đổi một tham chiếu ảnh đã lưu thành địa chỉ mà thẻ `<img>` hiển thị được.
 *
 * ## Vì sao tự làm chứ không nhờ service `conversation`
 *
 * Service đó CÓ sẵn hàm này (`resolveImage`, kèm bộ nhớ đệm), nhưng nó không nằm
 * trong `IConversation` — cái mặt mà upstream công bố cho plugin dùng. Gọi vào
 * một hàm chỉ tồn tại trên lớp cụ thể là bám vào thứ họ không hứa giữ, và lần
 * `/nang-cap-engine` sau nó hỏng im lặng: ảnh không hiện, không lỗi nào báo.
 *
 * Đường công bố là `session.readAttachment` — có trong hợp đồng, có tài liệu.
 * Phần đệm và phần thu hồi địa chỉ tự lo, và đó là toàn bộ nội dung file này.
 *
 * ## Hai điều bắt buộc
 *
 * - **Đệm theo `attachmentId`.** Thẻ kết quả dựng lại mỗi lần khung hội thoại vẽ
 *   lại; không đệm thì mỗi lần cuộn qua là một lần tải lại cả tấm ảnh.
 * - **Thu hồi lúc gỡ plugin.** `createObjectURL` giữ byte ảnh trong bộ nhớ trang
 *   cho tới khi có người gọi `revokeObjectURL`. Một phiên dài với vài chục lần
 *   chụp mà không thu hồi là vài chục megabyte nằm lại.
 * @module
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Đúng phần `ctx.sessions` mà file này dùng, khai lại tại chỗ.
 *
 * Cần khai lại vì hai nửa plugin dùng chung MỘT chương trình kiểm kiểu, nên
 * `Context` ở đây mang cả phần khai của nửa Node — và bên đó `sessions` là một
 * service khác hẳn, không có `binding`. Đây là hạn chế của cách xếp file, không
 * phải của upstream; khai hẹp đúng thứ mình gọi là cách duy nhất không phải nói
 * dối về kiểu.
 */
interface SessionLookup {
  binding: (id: string) => {
    session: {
      readAttachment: (id: ImageAttachmentRef['attachmentId']) => Promise<
        | { ok: true, value: { attachment: ImageAttachmentRef, data: Uint8Array } }
        | { ok: false, error: { code: string, message: string } }
      >
    }
  } | undefined
}

/** Bộ nạp ảnh, kèm hàm dọn. */
export interface ShotLoader {
  /**
   * Lấy địa chỉ xem được của một ảnh đã lưu.
   * @param sessionId - phiên sở hữu ảnh; chính nó là phạm vi cho phép đọc.
   * @param attachment - tham chiếu ảnh.
   * @returns địa chỉ dùng được cho thẻ `<img>`.
   */
  load: (sessionId: string, attachment: ImageAttachmentRef) => Promise<string>
  /** Thu hồi mọi địa chỉ đã cấp. */
  dispose: () => void
}

/**
 * Dựng bộ nạp ảnh cho thẻ kết quả.
 * @param ctx - context gốc phía client; cần service `sessions`.
 * @returns bộ nạp và hàm dọn.
 */
export function createShotLoader(ctx: ClientContext): ShotLoader {
  // Khoá gồm cả phiên: cùng một ảnh xem từ hai phiên là hai lần cho phép đọc
  // khác nhau, và gộp chúng là để một phiên mượn quyền của phiên kia.
  const cache = new Map<string, Promise<string>>()
  const urls = new Set<string>()

  const fetchOne = async (sessionId: string, attachment: ImageAttachmentRef): Promise<string> => {
    const sessions = (ctx as unknown as { sessions: SessionLookup }).sessions
    const session = sessions.binding(sessionId)?.session
    if (session === undefined) throw new Error(`không tìm thấy phiên "${sessionId}"`)
    const result = await session.readAttachment(attachment.attachmentId)
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    const bytes = Uint8Array.from(result.value.data)
    const url = URL.createObjectURL(new Blob([bytes], { type: result.value.attachment.mediaType }))
    urls.add(url)
    return url
  }

  return {
    load: async (sessionId, attachment) => {
      const key = `${sessionId}:${String(attachment.attachmentId)}`
      let pending = cache.get(key)
      if (pending === undefined) {
        // Hỏng thì XOÁ khỏi đệm, nếu không một lần hỏng vì mạng chập sẽ đóng
        // đinh mãi mãi và nút "thử lại" của khối ảnh trở thành nút vô nghĩa.
        pending = fetchOne(sessionId, attachment).catch((error: unknown) => {
          cache.delete(key)
          throw error
        })
        cache.set(key, pending)
      }
      return pending
    },
    dispose: () => {
      for (const url of urls) URL.revokeObjectURL(url)
      urls.clear()
      cache.clear()
    },
  }
}
