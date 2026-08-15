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

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import xtermStyles from '@xterm/xterm/css/xterm.css'
import { DockPanel } from './DockPanel.tsx'
import { DockToggle } from './DockToggle.tsx'
import { createDock } from './store.ts'
import styles from './styles.css'

// Kéo khai báo slot của upstream vào chương trình. Không có hai dòng này thì
// `shell.overlay` và `conversation.session.header.utilities` không tồn tại về
// mặt kiểu.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

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
  const share = (): { hooks: { dock: typeof dock.store }, actions: typeof dock.actions } =>
    ({ hooks: { dock: dock.store }, actions: dock.actions })

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
}
