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
import type { DockActions, DockState } from './store.ts'

export interface DockPanelProps {
  /** Kho panel, do plugin chuyền vào — cùng một kho với nút ở header phiên. */
  useDock: SnapshotSelectorHook<DockState>
  actions: DockActions
  useSessions: SnapshotSelectorHook<SessionListState>
  useWorkspaces: SnapshotSelectorHook<WorkspaceListState>
}

/**
 * Thân panel.
 * @param props - trạng thái panel cộng bộ chọn dữ liệu toàn cục của framework.
 * @returns phần tử panel.
 */
export function DockPanel({ useDock, actions, useSessions, useWorkspaces }: DockPanelProps): React.JSX.Element {
  const open = useDock((s) => s.open)
  const width = useDock((s) => s.width)
  const panes = useDock((s) => s.panes)
  const activeId = useDock((s) => s.activeId)

  // Thư mục gốc: cwd của phiên đang mở. Chưa có phiên thì lấy workspace đầu
  // danh sách — registry xếp workspace mới lên đầu, nên đó là cái vừa dùng —
  // để mở app lên là đã có cái để nhìn thay vì một panel trống.
  const cwd = useSessions((s) => s.current === undefined ? undefined : s.byId[s.current]?.cwd)
  const dauDanhSach = useWorkspaces((s) => s.items[0]?.path)
  const root = cwd ?? dauDanhSach

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
  useEffect(() => () => { stage.destroy() }, [stage])

  const active = useMemo(() => panes.find((p) => p.id === activeId), [panes, activeId])

  // Sân khấu chỉ hiện khi panel mở VÀ pane đang xem là một trang web. Mọi lúc
  // khác nó ẩn hẳn — nếu không, trang web sẽ nổi đè lên tab Files.
  useEffect(() => {
    stage.setActive(activeId)
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

  const dongPane = useCallback((id: string) => {
    stage.remove(id)
    actions.closePane(id)
  }, [stage, actions])

  return (
    <aside className="hdw-dock" aria-label="Panel công cụ" hidden={!open}>
      <TabBar
        panes={panes}
        activeId={activeId}
        onSelect={actions.setActive}
        onClosePane={dongPane}
        onOpen={(kind) => { actions.openPane(kind) }}
        onClose={actions.close}
      />
      <div className="hdw-body">
        {panes.map((pane) => {
          const an = pane.id !== activeId
          if (pane.kind === 'files') return <FilesTab key={pane.id} root={root} an={an} />
          if (pane.kind === 'terminal') return <TerminalTab key={pane.id} root={root} an={an} />
          return (
            <BrowserPane
              key={pane.id}
              paneId={pane.id}
              stage={stage}
              an={an}
              batDau={pane.url}
            />
          )
        })}
        {panes.length === 0 && <div className="hdw-empty">Dải trống. Bấm dấu + để mở thêm.</div>}
      </div>
      <Resizer width={width} onResize={actions.setWidth} />
    </aside>
  )
}
