/**
 * Panel bên phải. Đăng ký vào `shell.overlay` — slot loại `list` đang trống mà
 * upstream chừa sẵn cho lớp nổi trên mọi cột.
 *
 * Nó nổi lên bằng `position: fixed` bám mép phải, còn khung app co lại nhường
 * chỗ nhờ biến `--hdw-dock-w` ghi trên `<html>` (xem `styles.css`). Nhìn ra là
 * bốn cột nằm cạnh nhau, không cái nào che cái nào.
 *
 * ## Panel đóng KHÔNG được tháo nội dung
 *
 * Bản trước trả `null` khi đóng. Hậu quả không thấy ngay nhưng nặng: tháo
 * component là đóng WebSocket, mà đóng WebSocket là giết shell — bấm đóng panel
 * một cái là mất `npm run dev` đang chạy dở, và mở lại thì thấy một terminal
 * trắng như chưa từng có gì. Giờ panel chỉ **ẩn**; mọi pane vẫn sống.
 * @module
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { BrowserPane } from './BrowserPane.tsx'
import { createStage, type Stage } from './browser-stage.ts'
import { FilesTab } from './FilesTab.tsx'
import { Resizer } from './Resizer.tsx'
import { TabBar } from './TabBar.tsx'
import { TerminalTab } from './TerminalTab.tsx'
import type { StageHolder } from './stage-holder.ts'
import type { DockActions, DockState } from './store.ts'

export interface DockPanelProps {
  /** Kho panel, do plugin chuyền vào — cùng một kho với nút ở header phiên. */
  useDock: SnapshotSelectorHook<DockState>
  actions: DockActions
  /** Ô chứa sân khấu, để cầu nối ở tầng plugin với tới được trang web. */
  stageHolder: StageHolder
  useSessions: SnapshotSelectorHook<SessionListState>
  useWorkspaces: SnapshotSelectorHook<WorkspaceListState>
}

/**
 * Thân panel.
 * @param props - trạng thái panel cộng bộ chọn dữ liệu toàn cục của framework.
 * @returns phần tử panel.
 */
export function DockPanel({ useDock, actions, stageHolder, useSessions, useWorkspaces }: DockPanelProps): React.JSX.Element {
  const open = useDock((s) => s.open)
  const width = useDock((s) => s.width)
  const panes = useDock((s) => s.panes)
  const activeId = useDock((s) => s.activeId)

  // Thư mục gốc: cwd của phiên đang mở. Chưa có phiên thì lấy workspace đầu
  // danh sách — registry xếp workspace mới lên đầu, nên đó là cái vừa dùng —
  // để mở app lên là đã có cái để nhìn thay vì một panel trống.
  const cwd = useSessions((s) => s.current === undefined ? undefined : s.byId[s.current]?.cwd)
  const firstWorkspace = useWorkspaces((s) => s.items[0]?.path)
  const root = cwd ?? firstWorkspace

  // Sân khấu webview: dựng một lần cho cả panel, sống ngoài React. Xem
  // `browser-stage.ts` để biết vì sao nó không thể là component.
  const stageRef = useRef<Stage | undefined>(undefined)
  if (stageRef.current === undefined) {
    stageRef.current = createStage((id, status) => {
      actions.describePane(id, {
        title: status.title === '' ? undefined : status.title,
        url: status.url,
      })
    })
  }
  const stage = stageRef.current

  // Trao sân khấu cho tầng plugin, và THU LẠI khi component tháo.
  //
  // Bước thu lại quan trọng ngang bước trao: slot có thể dựng lại component bất
  // cứ lúc nào, và sân khấu cũ bị `destroy()`. Không xoá khỏi ô thì từ giây đó
  // cầu cầm một sân khấu đã chết — không lỗi nào báo, chỉ là mọi lệnh của agent
  // bắt đầu im lặng thất bại.
  useEffect(() => {
    stageHolder.current = stage
    return () => {
      if (stageHolder.current === stage) stageHolder.current = undefined
      stage.destroy()
    }
  }, [stage, stageHolder])

  const active = useMemo(() => panes.find((p) => p.id === activeId), [panes, activeId])

  // Người dùng vừa tự bấm chọn tab, hay panel đang tự dựng lại?
  //
  // Khác biệt này quyết định có trao bàn phím cho trang web hay không, và nó
  // KHÔNG suy ra được từ trạng thái: cùng một `activeId` mới, một đằng là cú
  // bấm, một đằng là app vừa mở lên và đọc lại phiên trước. Nên ý định được ghi
  // ngay tại chỗ phát sinh rồi tiêu đi khi dùng.
  const userPicked = useRef(false)
  const selectTab = useCallback((id: string) => {
    userPicked.current = true
    actions.setActive(id)
  }, [actions])

  // Sân khấu chỉ hiện khi panel mở VÀ pane đang xem là một trang web. Mọi lúc
  // khác nó ẩn hẳn — nếu không, trang web sẽ nổi đè lên tab Files.
  useEffect(() => {
    stage.setActive(activeId, userPicked.current)
    userPicked.current = false
    if (!open || active?.kind !== 'browser') stage.setRect(undefined)
  }, [stage, open, activeId, active?.kind])

  // Ghi bề rộng lên `<html>` để CSS của panel và padding của `#root` cùng đọc
  // một con số. Dọn sạch khi panel gỡ đi — app phải trở lại đúng như chưa có
  // plugin nào.
  useLayoutEffect(() => {
    const el = document.documentElement
    el.style.setProperty('--hdw-dock-w', open ? `${String(width)}px` : '0px')
    return () => { el.style.removeProperty('--hdw-dock-w') }
  }, [open, width])

  const closeTab = useCallback((id: string) => {
    stage.remove(id)
    actions.closePane(id)
  }, [stage, actions])

  return (
    <aside className="hdw-dock" aria-label="Panel công cụ" hidden={!open}>
      <TabBar
        panes={panes}
        activeId={activeId}
        onSelect={selectTab}
        onClosePane={closeTab}
        onOpen={(kind) => { actions.openPane(kind) }}
        onClose={actions.close}
      />
      <div className="hdw-body">
        {panes.map((pane) => {
          const isHidden = pane.id !== activeId
          if (pane.kind === 'files') return <FilesTab key={pane.id} root={root} isHidden={isHidden} />
          if (pane.kind === 'terminal') return <TerminalTab key={pane.id} root={root} isHidden={isHidden} />
          return (
            <BrowserPane
              key={pane.id}
              paneId={pane.id}
              stage={stage}
              isHidden={isHidden}
              startUrl={pane.url}
              openedBy={pane.openedBy ?? 'user'}
            />
          )
        })}
        {panes.length === 0 && <div className="hdw-empty">Dải trống. Bấm dấu + để mở thêm.</div>}
      </div>
      <Resizer width={width} onResize={actions.setWidth} />
    </aside>
  )
}
