/**
 * Dải pill của panel: Files, từng terminal, từng trang web đều là một pill
 * ngang hàng, cộng nút `+` để mở thêm và nút đóng cả panel.
 *
 * `Pill` là component có sẵn của upstream, và chú thích trong mã của họ ghi
 * đúng công dụng này — *"view switcher tabs, filters, badges"*. Bản trước bẻ
 * `Button` thành tablist rồi tự vẽ gạch chân; bản này bỏ được cả hai.
 *
 * Nút đóng trên mỗi pill nằm **ngoài** `Pill` chứ không lồng bên trong: một
 * `<button>` lồng trong một `<button>` là HTML không hợp lệ, và trình duyệt xử
 * lý mỗi nơi một kiểu. Nó được đặt chồng lên mép phải bằng CSS, nên nhìn ra vẫn
 * là một pill duy nhất, mà bàn phím vẫn tới được cả hai.
 * @module
 */

import { useEffect, useState } from 'react'
import {
  Button,
  IconApiOutline14,
  IconCloseFill14,
  IconCloseOutline16,
  IconFolderOpen16,
  IconGlobeOutline14,
  IconPlusOutline16,
  Menu,
  Pill,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Pane, PaneKind } from './store.ts'

/** Icon đầu mỗi pill, theo loại pane. */
function KindIcon({ kind }: { kind: PaneKind }): React.JSX.Element {
  if (kind === 'files') return <IconFolderOpen16 size={14} />
  if (kind === 'browser') return <IconGlobeOutline14 />
  return <IconApiOutline14 />
}

export interface TabBarProps {
  panes: readonly Pane[]
  activeId: string | undefined
  onSelect: (id: string) => void
  onClosePane: (id: string) => void
  onOpen: (kind: PaneKind) => void
  onClose: () => void
}

/**
 * Dải pill ở đầu panel.
 * @param props - xem {@link TabBarProps}.
 * @returns phần tử dải pill.
 */
export function TabBar({ panes, activeId, onSelect, onClosePane, onOpen, onClose }: TabBarProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)

  // Đóng menu khi một trang web giành lấy bàn phím.
  //
  // `Menu` của upstream tự đóng bằng cách nghe cú bấm trên `document`. Nhưng từ
  // khi panel thôi bắt chuột ở vùng trang web (xem `styles.css`), một cú bấm vào
  // trang KHÔNG còn tới `document` của app — nó đi thẳng vào tiến trình của
  // trang. Nên mở menu rồi bấm ra giữa trang web để bỏ thì menu cứ đứng đó.
  //
  // Thứ vẫn tới được: thẻ `<webview>` nhận tiêu điểm DOM, và sự kiện đó nổi lên
  // `document` dưới dạng `focusin`.
  useEffect(() => {
    if (!menuOpen) return undefined
    const onPageTakesFocus = (event: FocusEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && target.tagName.toLowerCase() === 'webview') setMenuOpen(false)
    }
    document.addEventListener('focusin', onPageTakesFocus)
    return () => { document.removeEventListener('focusin', onPageTakesFocus) }
  }, [menuOpen])

  const items: MenuEntry[] = [
    { id: 'browser', label: 'Trang web mới', icon: <IconGlobeOutline14 /> },
    { id: 'terminal', label: 'Terminal mới', icon: <IconApiOutline14 /> },
    { id: 'files', label: 'Files', icon: <IconFolderOpen16 size={14} /> },
  ]

  return (
    <div className="hdw-tabbar" role="tablist" aria-label="Các mặt của panel">
      <div className="hdw-pills">
        {panes.map((pane) => (
          <div className="hdw-pillwrap" key={pane.id}>
            <Pill
              className="hdw-pill"
              active={pane.id === activeId}
              onClick={() => { onSelect(pane.id) }}
              role="tab"
              aria-selected={pane.id === activeId}
              title={pane.title}
            >
              <span className="hdw-pill-icon"><KindIcon kind={pane.kind} /></span>
              <span className="hdw-pill-name">{pane.title}</span>
            </Pill>
            {/* Files không đóng được: nó là pane duy nhất luôn có nghĩa, và
                đóng nó chỉ để rồi mở lại thì không phải một lựa chọn thật. */}
            {pane.kind !== 'files' && (
              <button
                type="button"
                className="hdw-pill-x"
                aria-label={`Đóng ${pane.title}`}
                onClick={(event) => { event.stopPropagation(); onClosePane(pane.id) }}
              >
                <IconCloseFill14 />
              </button>
            )}
          </div>
        ))}

        <Menu
          open={menuOpen}
          items={items}
          // `portal` KHÔNG phải tuỳ chọn ở đây. Dải pill có `overflow-x: auto`
          // để prevộn ngang khi mở nhiều tab, và theo chuẩn CSS, đặt overflow cho
          // một trục sẽ biến trục kia từ `visible` thành `auto` — nên hộp menu
          // bị cắt cả chiều dọc. Triệu chứng đúng như chủ dự án gặp: bấm `+`
          // không thấy gì. Menu vẫn nằm trong DOM, đủ kích thước, đúng chỗ —
          // chỉ là không nhìn thấy và không bấm được.
          //
          // `portal` đưa hộp menu ra thẳng `document.body` rồi định vị theo ô
          // neo. Đây là đường upstream chừa sẵn cho đúng tình huống này; chú
          // thích của họ ghi: *"for anchors inside overflow-clipping containers"*.
          portal
          onSelect={(id) => { setMenuOpen(false); onOpen(id as PaneKind) }}
          onClose={() => { setMenuOpen(false) }}
          anchor={(
            <Button
              variant="ghost"
              size="sm"
              icon={<IconPlusOutline16 />}
              aria-label="Mở thêm"
              onClick={() => { setMenuOpen((prev) => !prev) }}
            />
          )}
        />
      </div>

      <Tooltip label="Đóng panel" side="bottom">
        <Button
          variant="ghost"
          size="sm"
          icon={<IconCloseOutline16 />}
          aria-label="Đóng panel"
          onClick={onClose}
        />
      </Tooltip>
    </div>
  )
}
