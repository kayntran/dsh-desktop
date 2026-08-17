/**
 * Nút bật/tắt panel, đặt ở nhóm tiện ích canh phải trên hàng tiêu đề phiên —
 * `conversation.session.header.utilities`, slot loại `list` đang trống mà
 * upstream chừa sẵn. Cùng vị trí app tham chiếu đặt nút này: góc trên bên phải
 * khung hội thoại.
 *
 * Hệ quả của việc ở trong header phiên: màn hình chưa mở phiên nào thì chưa có
 * header, nên chưa có nút. App tham chiếu cũng đúng như vậy.
 * @module
 */

import { Button, IconPanelLeftOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { DockActions, DockState } from './store.ts'

export interface DockToggleProps {
  /** Kho panel, do plugin chuyền vào — cùng một kho với panel. */
  useDock: SnapshotSelectorHook<DockState>
  actions: DockActions
}

/**
 * Nút mở/đóng panel.
 * @param props - xem {@link DockToggleProps}.
 * @returns phần tử nút.
 */
export function DockToggle({ useDock, actions }: DockToggleProps): React.JSX.Element {
  const open = useDock((s) => s.open)
  const label = open ? 'Close tools panel' : 'Open tools panel'

  return (
    <Tooltip label={label} side="bottom">
      <Button
        variant="ghost"
        size="sm"
        // Bộ icon của upstream chỉ có bản "panel bên trái"; panel của ta nằm bên
        // phải nên lật ngang bằng CSS. Vẫn là icon của hệ thống, đúng nét đúng
        // cỡ — không tự vẽ thêm một icon mới.
        icon={<span className="hdw-flip"><IconPanelLeftOutline16 /></span>}
        aria-label={label}
        aria-pressed={open}
        onClick={actions.toggle}
      />
    </Tooltip>
  )
}
