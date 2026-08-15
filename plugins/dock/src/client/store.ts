/**
 * Trạng thái của panel: mở/đóng, bề rộng, và danh sách pane đang mở.
 *
 * Dựng bằng `createSnapshotStore` chứ không phải `defineStore`, và lý do nằm ở
 * chỗ ĐẶT nút. Panel sống ở lớp nổi của cả cửa sổ (phạm vi `root`), còn nút
 * bật/tắt sống trong header của TỪNG PHIÊN (phạm vi `session`). `defineStore`
 * phát cho mỗi phạm vi một bản sao riêng — cùng một khai báo, hai instance —
 * nên nút ở phiên sẽ bật/tắt một bản sao mà panel không hề nhìn thấy: bấm vào
 * không có gì xảy ra, và không có lỗi nào báo.
 *
 * Kho dựng ở tầng plugin thì chỉ có đúng một, và cả hai bên nhận chính nó qua
 * `inject`. Đây là cơ chế của upstream, không phải lối đi vòng: plugin
 * agent-preset của họ chuyền `SnapshotStore` cho các slot y hệt cách này.
 *
 * `persist` vẫn do upstream lo: đọc lại từ localStorage lúc dựng, ghi lại mỗi
 * lần đổi, và nếu localStorage hỏng thì tự tắt phần lưu chứ không làm vỡ kho.
 *
 * ## Một dải pane, không phải ba tab cố định
 *
 * Files, mỗi terminal, mỗi trang web đều là một `Pane` ngang hàng trong cùng
 * một danh sách — đúng kiểu của app tham chiếu. Cái được không chỉ là hình
 * thức: **chỉ có một danh sách và một chủ sở hữu**. Bản trước có một `tab` cố
 * định cộng (về sau sẽ có) danh sách tab web riêng, tức hai mô tả về "đang xem
 * cái gì", và hai mô tả thì sớm muộn lệch nhau — đó chính là lỗi mà dự án tham
 * chiếu đã phải gỡ và ghi lại trong `browserStore.ts` của họ.
 * @module
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Loại của một pane. */
export type PaneKind = 'files' | 'terminal' | 'browser'

/** Bề rộng nhỏ nhất còn đọc được cây thư mục. */
export const MIN_WIDTH = 220

/** Bề rộng lớn nhất, để panel không nuốt mất hội thoại. */
export const MAX_WIDTH = 720

/** Một pane trong dải. */
export interface Pane {
  /** Định danh bền, dùng làm khoá React và làm tên tab cho agent gọi tới. */
  id: string
  kind: PaneKind
  /**
   * Chữ trên pill. Files là hằng số; terminal lấy tên shell; trang web lấy
   * tiêu đề trang — **do trang tự đặt**, nên chỉ dùng để hiện, không bao giờ
   * dùng để quyết định gì.
   */
  title: string
  /** Chỉ với `kind: 'browser'` — địa chỉ đang mở. */
  url?: string
}

/** Trạng thái panel, cùng một hình dạng cho cả panel lẫn nút bật/tắt. */
export interface DockState {
  open: boolean
  width: number
  panes: Pane[]
  /** Pane đang hiện. `undefined` khi dải rỗng. */
  activeId: string | undefined
}

/** Bộ ghi của panel. Component chỉ được đổi trạng thái qua đây. */
export interface DockActions {
  toggle: () => void
  close: () => void
  setWidth: (px: number) => void
  /**
   * Mở một pane mới và chuyển sang nó.
   *
   * Files là **duy nhất**: gọi lại chỉ chuyển sang cái đang có. Hai cây thư mục
   * của cùng một workspace không nói được điều gì khác nhau, mà lại làm dải tab
   * dài ra vô ích.
   * @returns id của pane đang hiện sau lời gọi.
   */
  openPane: (kind: PaneKind, url?: string) => string
  closePane: (id: string) => void
  setActive: (id: string) => void
  /** Cập nhật chữ trên pill và địa chỉ, khi trang đổi tiêu đề hoặc điều hướng. */
  describePane: (id: string, patch: { title?: string | undefined, url?: string | undefined }) => void
}

/** Kho cộng bộ ghi, dựng một lần trong `apply` rồi chia cho các slot. */
export interface Dock {
  store: SnapshotStore<DockState>
  actions: DockActions
}

/** Chữ mặc định trên pill của từng loại. */
const LABELS: Record<PaneKind, string> = {
  files: 'Files',
  terminal: 'Terminal',
  browser: 'Trang mới',
}

/** Id ngắn, duy nhất trong một phiên chạy. */
let counter = 0
function newId(kind: PaneKind): string {
  counter += 1
  return `${kind}-${String(counter)}-${Date.now().toString(36)}`
}

/**
 * Chọn pane kế tiếp sau khi đóng pane đang xem.
 *
 * Lấy cái bên phải, không có thì lấy cái bên trái — đúng thói quen của mọi
 * trình duyệt. Trả `undefined` khi vừa đóng cái cuối cùng.
 */
function nextAfterClose(panes: readonly Pane[], index: number): string | undefined {
  return panes[index]?.id ?? panes[index - 1]?.id
}

/**
 * Dựng kho trạng thái panel.
 *
 * Gọi trong `apply` chứ không phải ở cấp module: một kho ở cấp module là một
 * singleton trá hình, sẽ sống sót qua các lần nạp lại plugin và mang trạng thái
 * cũ sang bản mới.
 * @returns kho và bộ ghi đã buộc vào nó.
 */
export function createDock(): Dock {
  const first: Pane = { id: newId('files'), kind: 'files', title: LABELS.files }
  const store = createSnapshotStore<DockState>(
    { open: false, width: 320, panes: [first], activeId: first.id },
    { persist: { name: 'hdw.dock' } },
  )

  // Trạng thái đọc lại từ lần trước có thể tới từ một bản plugin cũ hơn (khoá
  // `hdw.dock` không đổi qua các bản). Dọn một lần lúc dựng, để phần còn lại
  // của code không phải phòng thủ ở mọi chỗ đọc.
  store.update((d) => {
    if (!Array.isArray(d.panes) || d.panes.length === 0) {
      const files: Pane = { id: newId('files'), kind: 'files', title: LABELS.files }
      d.panes = [files]
    }
    if (!d.panes.some((p) => p.id === d.activeId)) d.activeId = d.panes[0]?.id
  })

  return {
    store,
    actions: {
      toggle: () => { store.update((d) => { d.open = !d.open }) },
      close: () => { store.update((d) => { d.open = false }) },
      setWidth: (px) => {
        store.update((d) => { d.width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(px))) })
      },

      openPane: (kind, url) => {
        let result = ''
        store.update((d) => {
          if (kind === 'files') {
            const existing = d.panes.find((p) => p.kind === 'files')
            if (existing !== undefined) {
              d.activeId = existing.id
              result = existing.id
              return
            }
          }
          const pane: Pane = url === undefined
            ? { id: newId(kind), kind, title: LABELS[kind] }
            : { id: newId(kind), kind, title: LABELS[kind], url }
          d.panes.push(pane)
          d.activeId = pane.id
          d.open = true
          result = pane.id
        })
        return result
      },

      closePane: (id) => {
        store.update((d) => {
          const index = d.panes.findIndex((p) => p.id === id)
          if (index === -1) return
          d.panes.splice(index, 1)
          if (d.activeId === id) d.activeId = nextAfterClose(d.panes, index)
        })
      },

      setActive: (id) => {
        store.update((d) => {
          if (d.panes.some((p) => p.id === id)) d.activeId = id
        })
      },

      describePane: (id, patch) => {
        store.update((d) => {
          const pane = d.panes.find((p) => p.id === id)
          if (pane === undefined) return
          if (patch.title !== undefined) pane.title = patch.title
          if (patch.url !== undefined) pane.url = patch.url
        })
      },
    },
  }
}
