/**
 * Một dòng trong Cài đặt → General: cho hay không cho agent thao tác trên trang
 * web trong panel.
 *
 * **Mức 1 — chỉ cộng thêm.** `settings.general.item` là slot loại `list`, và
 * upstream cắm nhiều dòng vào đó (ngôn ngữ, giao diện, hành vi phím Enter). Thêm
 * một dòng nữa không chiếm chỗ của ai.
 *
 * Dựng theo đúng khuôn dòng cài đặt của upstream (`EnterBehaviorRow`): chữ bên
 * trái, nút chọn bên phải, và nút đó là `Menu` của họ. Cố ý **không tự vẽ một
 * cái công tắc gạt**: bộ primitive của upstream không có sẵn component đó, và
 * mọi lựa chọn nhị phân trong Cài đặt của họ đều làm bằng `Menu` hai mục — tự vẽ
 * một cái gạt sẽ là thứ duy nhất trong trang trông khác mọi thứ còn lại.
 * @module
 */

import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconChevronDownOutline14,
  IconWarningOutline16,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DockState } from './store.ts'

/** Phần dữ liệu plugin chuyền vào dòng này. */
export interface AgentControlRowInjected {
  hooks: { dock: SnapshotStore<DockState> }
  actions: { setAgentControl: (allowed: boolean) => void }
}

/** Props đầy đủ của dòng cài đặt. */
export type AgentControlRowProps =
  PropsRuntime<'settings.general.item'>
  & InjectFace<AgentControlRowInjected>

/**
 * Dòng công tắc "cho agent điều khiển trình duyệt".
 * @param props - xem {@link AgentControlRowProps}.
 * @returns dòng cài đặt.
 */
export function AgentControlRow({ useDock, actions }: AgentControlRowProps): React.JSX.Element {
  const allowed = useDock((s) => s.agentControl)
  const [open, setOpen] = useState(false)

  return (
    <div className="hdw-setting">
      <div className="hdw-setting-text">
        <div className="hdw-setting-title">Cho agent điều khiển trình duyệt</div>
        <div className="hdw-setting-desc">
          <IconWarningOutline16 className="hdw-setting-warn" />
          <span>
            Trong trình duyệt của panel, agent hành động <b>nhân danh bạn</b> — nó dùng chính các
            phiên đăng nhập của bạn. Nội dung trang web nó đọc cũng là chỉ dẫn mà nó có thể nghe
            theo. Tắt thì agent vẫn <b>đọc</b> được trang, chỉ không bấm và không gõ được.
          </span>
        </div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={[
          { id: 'on', label: 'Bật' },
          { id: 'off', label: 'Tắt' },
        ]}
        selectedId={allowed ? 'on' : 'off'}
        onSelect={(id) => {
          setOpen(false)
          actions.setAgentControl(id === 'on')
        }}
        align="end"
        // `portal` vì lý do y hệt menu "+" của dải pill: trang Cài đặt có vùng
        // cuộn, và một hộp menu neo bên trong vùng cuộn sẽ bị cắt mất.
        portal
        anchor={(
          <button
            type="button"
            className="hdw-setting-pick"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen((v) => !v) }}
          >
            {allowed ? 'Bật' : 'Tắt'}
            <IconChevronDownOutline14 />
          </button>
        )}
      />
    </div>
  )
}
