/**
 * Đường lấy byte của một ảnh đã lưu, để thẻ kết quả hiển thị được: `/hdw/image`.
 *
 * ## Vì sao phải tự mở đường này
 *
 * Engine đã có sẵn một đường cho giao diện đọc ảnh (`session.readAttachment`),
 * và nó **từ chối** ảnh của chúng ta. Đã đo trong một lượt chạy thật với model
 * thật; câu từ chối là *"Image is not referenced by this session."*
 *
 * Luật của họ, đọc từ `packages/host/apiproxy/src/api-proxy.ts`: giao diện chỉ
 * được đọc một ảnh nếu nhật ký phiên có một khối `image` **mà model nhìn thấy**.
 * Và một khối như thế chỉ được phép tồn tại khi tuyến model đọc được ảnh — chính
 * upstream ghi rõ lý do ở `tool-fs/src/read-image.ts`: một kết quả tool đi vào
 * lịch sử phiên, nên nhét ảnh vào một tuyến không chở được ảnh là làm hỏng mọi
 * lượt hỏi sau của tuyến đó.
 *
 * Hai luật đó cộng lại thành một ràng buộc cứng: **model DeepSeek không đọc được
 * ảnh, nên tấm ảnh không bao giờ vào được nhật ký, nên giao diện không bao giờ
 * xin đọc được nó qua đường của họ.** Không có cách nào lách trong khuôn đó mà
 * không nói dối về khả năng của model.
 *
 * Nên ảnh vẫn lưu vào kho đính kèm của engine — content-addressed, bền qua lần
 * khởi động sau, không phình nhật ký — còn phần đọc ra thì đi đường này.
 *
 * ## Đánh đổi, nói thẳng
 *
 * Đường này **không** kiểm ảnh có thuộc phiên đang xem hay không, tức là bỏ đúng
 * phép kiểm mà upstream đặt ra. Hai thứ thay chỗ nó:
 *
 * - `isTrustedRequest`, y như mọi route `/hdw/*` khác;
 * - và mã ảnh là **sha256 của chính nội dung ảnh** — muốn lấy được một ảnh thì
 *   phải biết trước băm của nó, mà biết băm nghĩa là đã có ảnh.
 *
 * Nên thứ mất đi không phải "ai cũng đọc được ảnh", mà là "một trang trong app
 * đọc được ảnh của phiên khác nếu nó đã biết băm". Đổi lại là chủ dự án nhìn
 * thấy được thứ agent vừa nhìn.
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { isTrustedRequest } from './trust.ts'

/** Kiểu ảnh kho đính kèm nhận. Không nằm trong danh sách thì không phục vụ. */
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** Trả lỗi dạng chữ. Ảnh hỏng thì thẻ `<img>` chỉ cần biết là hỏng. */
function fail(res: ServerResponse, status: number, reason: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end(reason)
}

/** Đọc một số nguyên dương từ query, hoặc undefined. */
function positiveInt(raw: string | null): number | undefined {
  if (raw === null) return undefined
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * Mở route `/hdw/image`.
 * @param ctx - context của plugin; cần service `attachments`.
 * @returns hàm gỡ route.
 */
export function registerImageRoutes(ctx: Context): () => void {
  return ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/image',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!isTrustedRequest(req)) { fail(res, 403, 'the request did not pass the trust gate'); return }

      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const id = url.searchParams.get('id')
      const mediaType = url.searchParams.get('type') ?? 'image/png'
      const bytes = positiveInt(url.searchParams.get('bytes'))
      const width = positiveInt(url.searchParams.get('w'))
      const height = positiveInt(url.searchParams.get('h'))

      if (id === null || id === '') { fail(res, 400, 'missing id'); return }
      if (!MEDIA_TYPES.has(mediaType)) { fail(res, 400, `unsupported image type: ${mediaType}`); return }
      if (bytes === undefined || width === undefined || height === undefined) {
        // Kho đính kèm đối chiếu byte với đúng tham chiếu đã ghi, nên nó cần đủ
        // cả năm trường. Thiếu thì từ chối ở đây cho câu lỗi còn đọc được, thay
        // vì để nó vỡ sâu bên trong.
        fail(res, 400, 'missing bytes/w/h')
        return
      }

      const store = ctx.get('attachments')
      if (store === undefined) { fail(res, 503, 'the engine has no attachment store'); return }

      const ref = {
        attachmentId: id, mediaType, bytes, width, height,
      } as unknown as ImageAttachmentRef

      try {
        const stored = await store.readImage(ref)
        const body = Buffer.from(stored.data)
        res.writeHead(200, {
          'content-type': mediaType,
          'content-length': String(body.length),
          // Mã ảnh là băm của nội dung, nên nội dung không bao giờ đổi dưới một
          // mã. Đệm lâu là đúng, và nó cắt hẳn việc tải lại mỗi lần cuộn qua.
          'cache-control': 'private, max-age=31536000, immutable',
        })
        res.end(body)
      } catch (error) {
        fail(res, 404, error instanceof Error ? error.message : String(error))
      }
    },
  })
}
