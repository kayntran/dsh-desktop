/**
 * Nửa giao diện của panel phải. Engine phục vụ file này cho trình duyệt tại
 * `/plugins/harness-desktop-dock/client.js`.
 *
 * **Mức 1 — chỉ cộng thêm.** Hai đăng ký, cả hai vào slot loại `list` đang
 * trống mà upstream chừa sẵn: `shell.overlay` (lớp nổi trên mọi cột) và
 * `conversation.session.header.utilities` (nhóm tiện ích canh phải trên hàng
 * tiêu đề phiên). Không chiếm slot nào có chủ, nên mọi cập nhật tương lai của
 * DeepSeek vẫn về đủ.
 * @module
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import xtermStyles from '@xterm/xterm/css/xterm.css'
import { AgentControlRow } from './AgentControlRow.tsx'
import { openBridge } from './bus.ts'
import { DockPanel } from './DockPanel.tsx'
import { DockToggle } from './DockToggle.tsx'
import { ScreenshotCard, SCREENSHOT_TOOL } from './ScreenshotCard.tsx'
import { shotUrl } from './shot-loader.ts'
import { createStageHolder } from './stage-holder.ts'
import { createDock } from './store.ts'
import styles from './styles.css'

// Kéo khai báo slot của upstream vào chương trình. Không có hai dòng này thì
// `shell.overlay` và `conversation.session.header.utilities` không tồn tại về
// mặt kiểu.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'

export const name = 'harness-desktop-dock'

export const inject = ['slots']

/**
 * Tiêm CSS của plugin, có nhãn sở hữu theo đúng quy ước upstream dùng cho CSS
 * của plugin — nhờ nhãn đó vòng đời gỡ module nhận ra được thẻ này là của ai.
 *
 * Gồm cả stylesheet của xterm. Nó chỉ nhắm các class `.xterm*` nên không chạm
 * được vào giao diện của upstream, và đi cùng một thẻ nên gỡ plugin là sạch cả
 * hai.
 * @returns hàm gỡ thẻ style.
 */
function injectStyles(): () => void {
  const tag = document.createElement('style')
  tag.dataset['plugin'] = name
  tag.dataset['pluginCss'] = `${name}/styles.css`
  tag.textContent = `${xtermStyles}\n${styles}`
  document.head.append(tag)
  return () => { tag.remove() }
}

/**
 * Thân plugin phía trình duyệt.
 * @param ctx - context gốc phía client.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(injectStyles, 'hdw-dock: css')

  // Một kho duy nhất cho cả hai đăng ký. Chuyền qua `inject` chứ không qua
  // `store`: hai slot này ở hai phạm vi khác nhau (cửa sổ và phiên), mà `store`
  // phát cho mỗi phạm vi một bản sao riêng — xem chú thích đầu `store.ts`.
  const dock = createDock()

  // Ô chứa sân khấu webview. Dựng ở đây vì cầu cần nó NGAY, còn sân khấu thì
  // mãi tới lúc panel mount mới có — xem `stage-holder.ts`.
  const stageHolder = createStageHolder()

  const share = (): {
    hooks: { dock: typeof dock.store }
    actions: typeof dock.actions
    stageHolder: typeof stageHolder
  } => ({ hooks: { dock: dock.store }, actions: dock.actions, stageHolder })

  // Cầu nối với nửa Node. Đặt ở ĐÂY chứ không trong `DockPanel`: slot có thể
  // remount component bất cứ lúc nào, và cầu remount là cầu chết — im lặng, chỉ
  // biểu hiện ở chỗ nửa Node nhờ gì cũng hết giờ.
  ctx.effect(() => openBridge(dock.actions, stageHolder, dock.store), 'hdw-dock: cầu nối nửa Node')

  // `ctx.slots.inject` là bắt buộc, không phải cẩn thận thừa: đăng ký thẳng vào
  // một slot chưa được khai báo sẽ ném. `inject` chờ tới khi chủ slot mount,
  // và tự đăng ký lại nếu chủ đó sập rồi lên lại.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'hdw-dock',
    order: 10,
    inject: share,
  }, DockPanel))

  // Đặt cuối nhóm tiện ích, đúng chỗ app tham chiếu để nút này: phần tử sau
  // cùng bên phải header phiên.
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'hdw-dock-toggle',
    order: 100,
    inject: share,
  }, DockToggle))

  // Công tắc quyền của agent, trong mục General. Đặt sau các dòng của upstream
  // (ngôn ngữ order 0, giao diện 10, phím Enter 20): đây là tuỳ chọn của một
  // tính năng thêm vào, không phải tuỳ chọn cốt lõi của app.
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'hdw-agent-control',
    order: 50,
    inject: share,
  }, AgentControlRow))

  // Thẻ kết quả của lệnh chụp ảnh.
  //
  // **Mức 1.** Slot này khoá theo tên tool, và khoá ở đây là tool của chính
  // chúng ta — upstream ghi rõ đó là cộng thêm. Mười một tool còn lại cố ý
  // KHÔNG nhận: hàng mặc định của họ vẽ chúng đủ dùng, và nhận thêm là tự gánh
  // việc bảo trì một cái hàng mà không đổi lại được gì.
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: SCREENSHOT_TOOL,
    inject: () => ({ loadShot: async (ref: ImageAttachmentRef) => shotUrl(ref) }),
  }, ScreenshotCard))
}
