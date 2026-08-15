/**
 * Sân khấu chứa các thẻ `<webview>` — sống **ngoài** cây React, cố ý.
 *
 * Ba sự thật buộc phải làm vậy:
 *
 * 1. Gỡ một `<webview>` khỏi DOM rồi cắm lại là **nạp lại trang từ đầu**: mất
 *    cuộn, mất nội dung form, mất trạng thái JS, mất cả đăng nhập chưa lưu.
 * 2. React reconcile là chuyên gia gỡ-và-cắm-lại. Một thay đổi ở tổ tiên, một
 *    lần đổi thứ tự danh sách, một `key` khác đi — đều có thể làm điều đó, và
 *    không có gì báo cho ai biết.
 * 3. `partition` (kho cookie) chỉ đặt được **trước** lần điều hướng đầu tiên.
 *    Dựng lại thẻ là mất luôn cơ hội đó.
 *
 * Nên React chỉ vẽ khung — dải pill, thanh địa chỉ — và chừa một ô trống. Mỗi
 * lần bố cục đổi, nó đo ô trống đó rồi báo toạ độ sang đây; sân khấu bám theo.
 * Đúng cách app tham chiếu đặt `bounds` cho `WebContentsView` của họ.
 *
 * ## Vì sao tab nền bị CHE chứ không bị ẩn
 *
 * `scripts/spike-webview.cjs` đo được: `capturePage()` **treo vĩnh viễn** khi
 * webview bị `visibility: hidden` hoặc bị đẩy ra ngoài khung nhìn — không lỗi,
 * không timeout, Promise không bao giờ giải quyết. Cách ẩn duy nhất vẫn chụp
 * được là **bị một lớp khác che kín**. Nên mọi tab xếp chồng đúng một chỗ, tab
 * đang xem nằm trên; tab nền bị chính nó che, và vẫn chụp được.
 *
 * Kế hoạch ban đầu ghi `visibility: hidden`. Nếu làm theo, lệnh chụp ảnh của
 * agent nhắm vào tab nền sẽ treo cứng cả lượt hội thoại.
 * @module
 */

/**
 * Phần API của thẻ `<webview>` mà panel dùng tới.
 *
 * Khai tay thay vì kéo `@types/electron` vào plugin: plugin không phụ thuộc
 * Electron, và nó chạy trong trang chứ không trong tiến trình chính. Danh sách
 * ngắn này cũng là bản khai đầy đủ những gì ta thật sự động vào.
 */
export interface WebviewTag extends HTMLElement {
  src: string
  loadURL: (url: string) => Promise<void>
  getURL: () => string
  getTitle: () => string
  reload: () => void
  stop: () => void
  goBack: () => void
  goForward: () => void
  executeJavaScript: (code: string) => Promise<unknown>
  capturePage: () => Promise<{ toDataURL: () => string }>
}

/** Những gì panel cần biết về một tab để vẽ thanh địa chỉ và pill. */
export interface TabStatus {
  url: string
  title: string
  loading: boolean
  canBack: boolean
  canForward: boolean
}

const TRANG_TRONG = 'about:blank'

interface Tab {
  el: WebviewTag
  status: TabStatus
  /**
   * Số mục lịch sử đã đi qua và vị trí hiện tại.
   *
   * Tự đếm thay vì hỏi `canGoBack()`: hàm đó đã bị đánh dấu lỗi thời trên
   * `webContents` và đường thay thế (`navigationHistory`) không lộ ra trên thẻ
   * `<webview>`. Đếm theo sự kiện điều hướng là thứ chắc chắn có.
   */
  lichSu: number
  viTri: number
}

/** Ô mà sân khấu phải bám theo, tính theo toạ độ khung nhìn. */
export interface StageRect {
  x: number
  y: number
  width: number
  height: number
}

export interface Stage {
  /** Tạo tab nếu chưa có, rồi trả về nó. */
  ensure: (id: string, url?: string) => void
  remove: (id: string) => void
  /**
   * Tab nào nằm trên. `undefined` là không tab nào (dải rỗng).
   * @param traoBanPhim - true khi chính người dùng vừa chọn tab này, để trao
   * luôn bàn phím cho trang. Mặc định false: lúc app tự dựng lại panel mà giành
   * bàn phím là cướp nó khỏi ô nhập hội thoại.
   */
  setActive: (id: string | undefined, traoBanPhim?: boolean) => void
  /** Đặt vị trí sân khấu; `undefined` là ẩn hẳn. */
  setRect: (rect: StageRect | undefined) => void
  status: (id: string) => TabStatus | undefined
  navigate: (id: string, url: string) => void
  goBack: (id: string) => void
  goForward: (id: string) => void
  reload: (id: string) => void
  stop: (id: string) => void
  /** Trao bàn phím cho trang của tab này. */
  focus: (id: string) => void
  element: (id: string) => WebviewTag | undefined
  destroy: () => void
}

/** Thêm `https://` khi người dùng gõ thiếu, và từ chối thứ không thành URL. */
export function chuanHoaUrl(raw: string): string | undefined {
  const text = raw.trim()
  if (text === '') return undefined
  const co_scheme = /^[a-z][a-z0-9+.-]*:/i.test(text)
  const thu = co_scheme ? text : `https://${text}`
  try {
    const url = new URL(thu)
    // Chỉ http/https. `javascript:` gõ vào thanh địa chỉ là một cách kinh điển
    // để tự bắn script vào trang mình đang mở.
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/**
 * Dựng sân khấu và gắn vào `document.body`.
 * @param onChange - gọi mỗi khi trạng thái một tab đổi, để React vẽ lại.
 * @returns tay điều khiển sân khấu.
 */
export function createStage(onChange: (id: string, status: TabStatus) => void): Stage {
  const goc = document.createElement('div')
  goc.className = 'hdw-stage'
  goc.dataset['plugin'] = 'harness-desktop-dock'

  /**
   * Giấu sân khấu bằng cách DÌM NÓ XUỐNG DƯỚI giao diện app — tuyệt đối không
   * dùng `display: none`.
   *
   * Đã trả giá để học điều này: một `<webview>` bị gắn vào lúc ô chứa đang
   * `display: none` thì **bề mặt hiển thị không bao giờ được cấp**. Mọi thứ
   * khác vẫn chạy — sự kiện điều hướng nổ, tiêu đề lan sang pill, trang tự vẽ
   * trong bộ nhớ (ảnh CDP chụp từ guest vẫn đầy đủ) — chỉ màn hình là trắng.
   * Vì mọi phép đo "trang có vẽ không" trước đây đều đo bộ nhớ của guest, lỗi
   * này lọt qua cả 13 mục kiểm và chỉ lộ khi chụp màn hình thật bằng
   * PrintWindow.
   *
   * Dìm bằng `z-index: -1` thì phần tử vẫn được vẽ (chỉ là bị các lớp sơn sau
   * che mất — panel có nền đục), nên bề mặt guest vẫn sống. Đây chính là điều
   * `spike-webview.cjs` mục 6b đo được từ đầu: *"bị che kín"* là cách ẩn duy
   * nhất mà webview vẫn hoạt động đầy đủ.
   */
  const dim = (): void => {
    goc.style.zIndex = '-1'
    goc.style.pointerEvents = 'none'
  }
  /** Nổi lên đúng tầng của nó (z-index 5, khai trong CSS). */
  const noiLen = (): void => {
    goc.style.zIndex = ''
    goc.style.pointerEvents = ''
  }

  dim()
  document.body.append(goc)

  const tabs = new Map<string, Tab>()
  let activeId: string | undefined

  const bao = (id: string, tab: Tab): void => { onChange(id, { ...tab.status }) }

  const xepChong = (traoBanPhim = false): void => {
    for (const [id, tab] of tabs) {
      // Tab đang xem nằm trên; tab nền bị nó che kín. Đây là cách ẩn DUY NHẤT
      // còn chụp ảnh được — xem chú thích đầu file.
      tab.el.style.zIndex = id === activeId ? '1' : '0'
    }
    banGiaoTieuDiem(traoBanPhim)
  }

  /**
   * Bàn giao tiêu điểm bàn phím khi tab đang xem đổi.
   *
   * Phải làm tường minh: `z-index` chỉ đổi thứ tự sơn, nó KHÔNG lấy lại tiêu
   * điểm. Mà ở đây tab nền không bị ẩn, chỉ bị che — nên thiếu bước này thì
   * người dùng bấm vào trang ở tab A, chuyển sang tab khác, gõ phím, và phím đi
   * thẳng vào một trang web vô hình đang nằm dưới. Không có gì báo; người dùng
   * chỉ thấy "gõ mà không có gì xảy ra".
   *
   * Chỉ GIÀNH bàn phím khi CHÍNH NGƯỜI DÙNG vừa chọn tab — `traoBanPhim`. Giành
   * vô điều kiện thì mở app lên, panel tự dựng lại một tab web, và bàn phím bị
   * cướp khỏi ô nhập hội thoại; đó là đổi một lỗi lấy một lỗi khó chịu hơn.
   *
   * Ý định phải được KHAI BÁO chứ không suy đoán. Bản trước đoán bằng cách xem
   * tiêu điểm có đang nằm trong panel không — nghe hợp lý, nhưng sai ngay ở một
   * đường thường gặp: gọi `.click()` bằng mã (và vài cách chọn bằng bàn phím)
   * không hề dời tiêu điểm, nên ý định thật bị đọc thành "không phải người dùng".
   *
   * Chiều NHẢ thì làm vô điều kiện: một trang đang bị che mà vẫn giữ bàn phím
   * thì luôn là sai.
   * @param traoBanPhim - người dùng vừa tự chọn tab này.
   */
  const banGiaoTieuDiem = (traoBanPhim: boolean): void => {
    const tren = activeId === undefined ? undefined : tabs.get(activeId)
    if (tren === undefined) {
      const dangGiu = document.activeElement
      if (dangGiu instanceof HTMLElement && dangGiu.tagName.toLowerCase() === 'webview') dangGiu.blur()
      return
    }
    if (traoBanPhim) tren.el.focus()
  }

  const tao = (id: string, url?: string): Tab => {
    // `document.createElement('webview')` chứ không phải JSX: thẻ này phải nằm
    // ngoài tầm tay của React, và nó không bao giờ được dựng lại.
    const el = document.createElement('webview') as WebviewTag
    el.setAttribute('src', url ?? TRANG_TRONG)
    // `partition` bị lớp vỏ ép lại ở `will-attach-webview` bất kể ghi gì ở đây;
    // ghi ra cho người đọc thấy ý định, và để thẻ đúng ngay cả khi chốt đổi.
    el.setAttribute('partition', 'persist:hdw-browser')
    // KHÔNG khai `allowpopups`. Nó là thuộc tính boolean của HTML: có mặt là
    // BẬT, kể cả khi giá trị là chuỗi "false". Bản trước ghi `allowpopups="false"`
    // với ý tắt popup, và nó nói ngược đúng điều nó định nói. Không gây hậu quả
    // thật vì lớp vỏ xoá thuộc tính này ở `will-attach-webview` rồi chặn tiếp ở
    // `setWindowOpenHandler` — nhưng để lại là để lại một cái bẫy đọc hiểu.
    // `tabindex="-1"` để `focus()` gọi được bằng mã.
    //
    // Không có nó thì thẻ `<webview>` không phải phần tử nhận tiêu điểm, và
    // `el.focus()` im lặng không làm gì — đo được: sau khi gọi focus, trang chủ
    // vẫn báo `activeElement=BODY` và trang khách vẫn `hasFocus=false`. Đúng
    // loại hỏng im lặng mà bộ luật này sinh ra để chống.
    //
    // Chọn `-1` chứ không phải `0`: trang web không nên chen vào vòng Tab của
    // giao diện app — người dùng bấm Tab trong panel là để đi giữa các nút của
    // panel, không phải để rơi vào trong trang.
    el.setAttribute('tabindex', '-1')
    el.className = 'hdw-webview'

    const tab: Tab = {
      el,
      status: { url: url ?? '', title: '', loading: url !== undefined, canBack: false, canForward: false },
      lichSu: 1,
      viTri: 0,
    }

    const dat = (patch: Partial<TabStatus>): void => {
      tab.status = { ...tab.status, ...patch }
      bao(id, tab)
    }

    el.addEventListener('did-start-loading', () => { dat({ loading: true }) })
    el.addEventListener('did-stop-loading', () => { dat({ loading: false }) })
    el.addEventListener('page-title-updated', (event) => {
      dat({ title: (event as unknown as { title: string }).title })
    })
    el.addEventListener('did-navigate', (event) => {
      const dia_chi = (event as unknown as { url: string }).url
      // Điều hướng mới cắt bỏ nhánh "tiến" phía trước, đúng như trình duyệt.
      tab.viTri += 1
      tab.lichSu = tab.viTri + 1
      dat({ url: dia_chi, canBack: tab.viTri > 0, canForward: false })
    })
    el.addEventListener('did-navigate-in-page', (event) => {
      const e = event as unknown as { url: string, isMainFrame: boolean }
      if (e.isMainFrame) dat({ url: e.url })
    })
    el.addEventListener('did-fail-load', (event) => {
      const e = event as unknown as { errorCode: number, isMainFrame: boolean }
      // -3 là ERR_ABORTED: người dùng bấm dừng, hoặc trang tự chuyển hướng giữa
      // chừng. Đó không phải hỏng, và báo nó ra là báo động giả.
      if (e.isMainFrame && e.errorCode !== -3) dat({ loading: false })
    })

    goc.append(el)
    tabs.set(id, tab)
    xepChong()
    return tab
  }

  return {
    ensure: (id, url) => {
      const co_san = tabs.get(id)
      if (co_san === undefined) { tao(id, url); return }
      if (url !== undefined && co_san.status.url === '') void co_san.el.loadURL(url)
    },

    remove: (id) => {
      const tab = tabs.get(id)
      if (tab === undefined) return
      tab.el.remove()
      tabs.delete(id)
      if (activeId === id) activeId = undefined
      xepChong()
    },

    setActive: (id, traoBanPhim = false) => {
      activeId = id
      xepChong(traoBanPhim)
    },

    setRect: (rect) => {
      if (rect === undefined) {
        // Giữ nguyên vị trí và kích thước — chỉ dìm xuống. Đổi kích thước lúc
        // này là bắt mọi trang nền bố trí lại vô ích.
        dim()
        return
      }
      goc.style.left = `${String(rect.x)}px`
      goc.style.top = `${String(rect.y)}px`
      goc.style.width = `${String(rect.width)}px`
      goc.style.height = `${String(rect.height)}px`
      noiLen()
    },

    status: (id) => {
      const tab = tabs.get(id)
      return tab === undefined ? undefined : { ...tab.status }
    },

    navigate: (id, url) => { void tabs.get(id)?.el.loadURL(url) },

    goBack: (id) => {
      const tab = tabs.get(id)
      if (tab === undefined || tab.viTri <= 0) return
      tab.viTri -= 1
      tab.el.goBack()
      tab.status = { ...tab.status, canBack: tab.viTri > 0, canForward: true }
      bao(id, tab)
    },

    goForward: (id) => {
      const tab = tabs.get(id)
      if (tab === undefined || tab.viTri >= tab.lichSu - 1) return
      tab.viTri += 1
      tab.el.goForward()
      tab.status = { ...tab.status, canBack: true, canForward: tab.viTri < tab.lichSu - 1 }
      bao(id, tab)
    },

    reload: (id) => { tabs.get(id)?.el.reload() },
    stop: (id) => { tabs.get(id)?.el.stop() },
    focus: (id) => { tabs.get(id)?.el.focus() },
    element: (id) => tabs.get(id)?.el,

    destroy: () => {
      tabs.clear()
      goc.remove()
    },
  }
}
