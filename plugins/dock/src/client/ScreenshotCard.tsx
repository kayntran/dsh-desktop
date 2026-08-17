/**
 * Thẻ kết quả của lệnh `browser_screenshot` — chỗ tấm ảnh hiện ra cho người dùng.
 *
 * **Mức 1 — chỉ cộng thêm.** `tool.call.toolview` là slot khoá theo TÊN TOOL, và
 * khoá ở đây là tool của chính chúng ta. Upstream ghi rõ trong khai báo slot:
 * nhận một khoá chưa ai giữ là cộng thêm, nhận khoá của tool có sẵn mới là chiếm
 * chỗ. Mười một tool còn lại vẫn dùng hàng mặc định của họ, nên vẫn nhận mọi cải
 * tiến tương lai của hàng đó.
 *
 * ## Vì sao phải có file này
 *
 * Bản trước khai `presentResult` trả về `{ card: 'generic', content: [ảnh] }`,
 * đúng hợp đồng, và **không có gì hiện ra**. Đã đọc mã của giao diện web:
 * `GenericToolCard` chỉ đọc năm loại thẻ có cấu trúc riêng — terminal, đọc file,
 * diff, tìm kiếm, web. Loại `generic` không có ai đọc; hàng vẫn dựng từ tên tool
 * và JSON tham số thô. Nên `presentCall`/`presentResult` của cả 12 tool hiện là
 * mã chết trong app này. Chúng vẫn giữ nguyên (đúng hợp đồng, và một giao diện
 * khác có thể dùng), nhưng đường đưa ảnh ra màn hình phải là chỗ này.
 *
 * Bài học đắt hơn cái lỗi: 60 mục kiểm tự động đều xanh, vì cả hai bộ kiểm đều
 * hỏi *hàm đó trả về gì* mà không hỏi *có ai gọi nó không*.
 *
 * ## Tự dựng hàng — đã kiểm trước, theo Luật 4
 *
 * `ToolRow` và `GenericToolCard` của upstream **không được xuất ra** khỏi gói
 * `dsh-client-ui-tool`; nó chỉ xuất `apply`, `inject` và mấy kiểu. Nên phần
 * khung hàng buộc phải tự dựng. Bù lại, mọi vật liệu bên trong đều là đồ của hệ
 * thống: icon từ `ui-primitives`, ảnh từ `MessageImage` của `ui-attachment`
 * (kèm sẵn hộp xem ảnh gốc khi bấm vào), màu chỉ dùng biến `--dsw-alias-*`.
 * @module
 */

import { useCallback } from 'react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { MessageImage } from '@deepseek-ai/dsh-client-ui-attachment'
// Bộ 70 icon của upstream KHÔNG có cái máy ảnh nào — đã đếm. Dùng quả địa cầu,
// đúng cái mà panel trình duyệt đang dùng, để thẻ này đọc ra là "chuyện của
// trình duyệt" thay vì tự nhập một hình vẽ lạc tông vào.
import { IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'

/** Tên tool mà thẻ này nhận. Phải khớp `browser_screenshot` trong `tools.ts`. */
export const SCREENSHOT_TOOL = 'browser_screenshot'

/** Phần plugin chuyền vào thẻ. */
export interface ScreenshotCardInjected {
  /**
   * Lấy địa chỉ xem được của một ảnh đã lưu.
   * @param sessionId - phiên sở hữu ảnh; chính nó là phạm vi cho phép đọc.
   * @param attachment - tham chiếu ảnh dựng lại từ dữ liệu thẻ.
   * @returns địa chỉ dùng được trong thẻ `<img>`.
   */
  loadShot: (sessionId: string, attachment: ImageAttachmentRef) => Promise<string>
}

/** Props đầy đủ của thẻ. */
export type ScreenshotCardProps =
  ToolCallViewProps
  & InjectFace<ScreenshotCardInjected>

/**
 * Hình dạng mà `browser_screenshot` gửi kèm kết quả, đủ để dựng lại tham chiếu
 * ảnh mà không cần hỏi lại engine.
 */
interface ScreenshotMeta {
  attachment_id?: unknown
  media_type?: unknown
  width?: unknown
  height?: unknown
  bytes?: unknown
  seen_by_model?: unknown
}

/**
 * Dựng tham chiếu ảnh từ dữ liệu đi kèm kết quả.
 *
 * Phải chịu được dữ liệu THIẾU và dữ liệu LẠ: thẻ này còn chạy khi người dùng
 * cuộn lại một phiên cũ, và phiên cũ có thể do một bản plugin trước ghi ra.
 * Thiếu một trường thì trả `undefined` và thẻ chỉ hiện chữ — không ném, vì ném
 * ở đây là làm vỡ cả khung hội thoại.
 * @param meta - dữ liệu thô đi kèm kết quả.
 * @returns tham chiếu ảnh, hoặc undefined khi không đủ để vẽ.
 */
function toAttachment(meta: unknown): ImageAttachmentRef | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const shot = meta as ScreenshotMeta
  const id = shot.attachment_id
  const width = shot.width
  const height = shot.height
  if (typeof id !== 'string' || id === '') return undefined
  if (typeof width !== 'number' || typeof height !== 'number') return undefined
  if (width <= 0 || height <= 0) return undefined
  return {
    attachmentId: id as ImageAttachmentRef['attachmentId'],
    mediaType: (typeof shot.media_type === 'string' ? shot.media_type : 'image/png') as ImageAttachmentRef['mediaType'],
    bytes: typeof shot.bytes === 'number' ? shot.bytes : 0,
    width,
    height,
    name: 'Ảnh chụp trang',
  }
}

/** Chữ hiện trong khối ảnh. Tiếng Việt vì đây là chữ người dùng đọc. */
const IMAGE_LABELS = {
  image: 'Ảnh chụp trang',
  open: 'Bấm để xem ảnh gốc',
  openNamed: (label: string) => `Xem ảnh gốc: ${label}`,
  loading: 'Đang tải ảnh…',
  loadFailed: 'Không tải được ảnh — bấm để thử lại',
  lightbox: { dialog: 'Ảnh chụp trang, cỡ gốc', close: 'Đóng' },
}

/**
 * Thẻ kết quả của lệnh chụp ảnh.
 * @param props - xem {@link ScreenshotCardProps}.
 * @returns thẻ hiển thị trong dòng hội thoại.
 */
export function ScreenshotCard({ block, sessionId, loadShot }: ScreenshotCardProps): React.JSX.Element {
  const load = useCallback(
    async (attachment: ImageAttachmentRef) => loadShot(String(sessionId), attachment),
    [loadShot, sessionId],
  )

  // `'kind' in block` là cách upstream phân biệt lệnh đang chạy với lệnh đã
  // xong; giữ đúng phép thử đó thay vì tự nghĩ ra một phép khác.
  const done = 'kind' in block
  const failed = done && block.isError
  const attachment = done ? toAttachment(block.meta) : undefined

  return (
    <div className="hdw-shot-card" data-state={!done ? 'running' : failed ? 'error' : 'ok'}>
      <div className="hdw-shot-head">
        <IconGlobeOutline14 />
        <span className="hdw-shot-title">Ảnh chụp trang</span>
        <span className="hdw-shot-note">
          {!done
            ? 'đang chụp…'
            : failed
              ? 'chụp không được'
              : attachment === undefined
                ? 'không có ảnh'
                : `${String(attachment.width)}×${String(attachment.height)}`}
        </span>
      </div>
      {attachment !== undefined && (
        <div className="hdw-shot-image">
          <MessageImage attachment={attachment} load={load} variant="single" labels={IMAGE_LABELS} />
        </div>
      )}
    </div>
  )
}
