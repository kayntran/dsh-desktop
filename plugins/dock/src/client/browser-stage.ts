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

import { isPublicUrl, withScheme } from '../net-policy.ts'

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
  /**
   * Id tiến trình của trang khách.
   *
   * Con số này là cầu nối duy nhất giữa nửa giao diện và lớp vỏ Electron: lệnh
   * chụp ảnh chạy ở lớp vỏ, và lớp vỏ nhận diện trang cần chụp bằng id này.
   */
  getWebContentsId: () => number
  /**
   * Gửi chuột/phím thật vào trang khách.
   *
   * Đo được (mục 15e): đường này tới nơi. Và mục 15a đo thêm một điều quan
   * trọng hơn — nó tới nơi **kể cả khi cửa sổ app không ở trước mặt**, ngược với
   * ghi chú trong tài liệu Electron. Nhờ vậy agent làm việc được trong lúc người
   * dùng đang dùng app khác.
   */
  sendInputEvent: (event: InputEvent) => void
  /** Gõ chữ vào phần tử đang giữ con trỏ. Nhanh và đúng hơn gõ từng phím. */
  insertText: (text: string) => Promise<void>
  setUserAgent: (ua: string) => void
  setZoomFactor: (factor: number) => void
  /**
   * ĐỪNG GỌI. Trên trang https thật, gọi từ trong trang chủ làm **treo cứng
   * vòng lặp sự kiện của cả trang chủ** — `setTimeout` bọc ngoài cũng không nổ,
   * nên không có cách nào tự cứu. Khai ra để người đọc biết nó tồn tại và biết
   * vì sao không dùng. Đường chụp ảnh duy nhất lành là từ tiến trình chính.
   */
  capturePage: () => Promise<{ toDataURL: () => string }>
}

/** Một sự kiện chuột hoặc phím gửi vào trang khách. */
export interface InputEvent {
  type: string
  x?: number
  y?: number
  button?: 'left' | 'middle' | 'right'
  clickCount?: number
  keyCode?: string
  modifiers?: readonly string[]
  deltaX?: number
  deltaY?: number
  canScroll?: boolean
}

/** Những gì panel cần biết về một tab để vẽ thanh địa chỉ và pill. */
export interface TabStatus {
  url: string
  title: string
  loading: boolean
  canBack: boolean
  canForward: boolean
}

const BLANK_PAGE = 'about:blank'

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
  historyLength: number
  historyIndex: number
  /** Ai mở tab này. Quyết định rào địa chỉ có áp cho nó không. */
  owner: TabOwner
  /** Vòng đệm console, cắt đuôi ở `MAX_CONSOLE_LINES`. */
  consoleLines: ConsoleLine[]
}

/**
 * Số dòng console giữ lại cho mỗi tab.
 *
 * Đủ để lần ra một lỗi vừa xảy ra, và đủ nhỏ để một trang spam `console.log`
 * trong vòng lặp không ăn hết bộ nhớ của cửa sổ.
 */
const MAX_CONSOLE_LINES = 200

/** Bốn mức của `console-message`, theo thứ tự Chromium đánh số. */
const CONSOLE_LEVELS: readonly ConsoleLine['level'][] = ['debug', 'info', 'warn', 'error']

/** Ô mà sân khấu phải bám theo, tính theo toạ độ khung nhìn. */
export interface StageRect {
  x: number
  y: number
  width: number
  height: number
}

export interface Stage {
  /** Tạo tab nếu chưa có, rồi trả về nó. */
  ensure: (id: string, url?: string, owner?: TabOwner) => void
  remove: (id: string) => void
  /**
   * Tab nào nằm trên. `undefined` là không tab nào (dải rỗng).
   * @param giveKeyboard - true khi chính người dùng vừa chọn tab này, để trao
   * luôn bàn phím cho trang. Mặc định false: lúc app tự dựng lại panel mà giành
   * bàn phím là cướp nó khỏi ô nhập hội thoại.
   */
  setActive: (id: string | undefined, giveKeyboard?: boolean) => void
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

  // --- Bề mặt cho tầng tool của agent ---

  /** Mọi tab đang có, theo đúng thứ tự trên dải pill. */
  list: () => TabInfo[]
  /** Tab này do agent mở hay do người dùng mở. */
  openedBy: (id: string) => TabOwner | undefined
  /** Ghi chủ nhân lúc tạo tab. Mặc định là người dùng. */
  claim: (id: string, owner: TabOwner) => void
  /**
   * Chạy mã trong trang khách và nhận lại giá trị.
   * @throws khi không có tab đó, hoặc mã ném trong trang.
   */
  evaluate: (id: string, code: string) => Promise<unknown>
  /** Gửi một sự kiện chuột/phím thật vào trang. */
  sendInput: (id: string, event: InputEvent) => void
  /** Gõ chữ vào phần tử đang giữ con trỏ trong trang. */
  insertText: (id: string, text: string) => Promise<void>
  /**
   * Trang có ĐANG ĐƯỢC VẼ không.
   *
   * Bài học đắt nhất chép từ dự án tham chiếu: một tab không được vẽ **vẫn nhận
   * cú bấm và vẫn trả lời "xong"**, nhưng không làm gì cả. Không kiểm chỗ này
   * thì agent báo thành công cho những thao tác chưa từng xảy ra.
   */
  isDrawable: (id: string) => Promise<boolean>
  /**
   * Tạm đưa tab lên trước để nó được vẽ, rồi trả về hàm khôi phục.
   *
   * Gọi ở đầu mọi lệnh thao tác. Hàm trả về đưa mọi thứ về đúng chỗ cũ, nên
   * agent làm việc ở tab nền mà người dùng không bị nhảy màn hình.
   */
  revealForInput: (id: string) => Promise<() => void>
  /** Vài trăm dòng console gần nhất của trang. */
  consoleLog: (id: string) => readonly ConsoleLine[]
  /** Id tiến trình trang khách, để lớp vỏ biết chụp cái nào. */
  webContentsId: (id: string) => number | undefined
  /** Đổi kích thước khung nhìn mà trang tin là mình đang có. */
  setViewport: (id: string, size: ViewportSize | undefined) => void
}

/** Tab do ai mở — quyết định rào địa chỉ có áp cho nó không. */
export type TabOwner = 'user' | 'agent'

/** Một tab, gọt cho tầng tool. */
export interface TabInfo {
  id: string
  url: string
  title: string
  loading: boolean
  active: boolean
  openedBy: TabOwner
}

/** Một dòng console của trang khách. */
export interface ConsoleLine {
  level: 'debug' | 'info' | 'warn' | 'error'
  text: string
  source: string
  line: number
  at: number
}

/**
 * Khung nhìn giả lập.
 *
 * Panel hẹp hơn nhiều so với một màn hình desktop, nên không thể đặt bề rộng
 * thật là 1280px. Cách làm: đặt bề rộng BỐ CỤC là 1280 rồi thu nhỏ hình cho vừa
 * ô. Trang tin nó đang ở 1280px — media query, breakpoint, bố cục đều theo đó —
 * còn người dùng vẫn thấy trọn vẹn trong panel.
 */
export interface ViewportSize {
  width: number
  height: number
}

/**
 * Thêm `https://` khi người dùng gõ thiếu, và từ chối thứ không thành URL.
 *
 * Dùng chung phép nhận biết scheme với rào địa chỉ (`withScheme`), và đó là chủ
 * ý: hai đường vào cùng một trình duyệt mà hiểu địa chỉ khác nhau thì sớm muộn
 * người dùng gõ được một thứ mà agent không mở được, hoặc ngược lại. Bản trước
 * mỗi bên một kiểu, và cả hai cùng từ chối oan `example.com:8080` — dấu hai
 * chấm ở đó là cổng, không phải scheme.
 */
export function normalizeUrl(raw: string): string | undefined {
  const text = raw.trim()
  if (text === '') return undefined
  try {
    const url = new URL(withScheme(text))
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
  const root = document.createElement('div')
  root.className = 'hdw-stage'
  root.dataset['plugin'] = 'harness-desktop-dock'

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
  const sink = (): void => {
    root.style.zIndex = '-1'
    root.style.pointerEvents = 'none'
  }
  /** Nổi lên đúng tầng của nó (z-index 5, khai trong CSS). */
  const raise = (): void => {
    root.style.zIndex = ''
    root.style.pointerEvents = ''
  }

  sink()
  document.body.append(root)

  const tabs = new Map<string, Tab>()
  let activeId: string | undefined

  const report = (id: string, tab: Tab): void => { onChange(id, { ...tab.status }) }

  const restack = (giveKeyboard = false): void => {
    for (const [id, tab] of tabs) {
      // Tab đang xem nằm trên; tab nền bị nó che kín. Đây là cách ẩn DUY NHẤT
      // còn chụp ảnh được — xem chú thích đầu file.
      tab.el.style.zIndex = id === activeId ? '1' : '0'
    }
    handOffFocus(giveKeyboard)
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
   * Chỉ GIÀNH bàn phím khi CHÍNH NGƯỜI DÙNG vừa chọn tab — `giveKeyboard`. Giành
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
   * @param giveKeyboard - người dùng vừa tự chọn tab này.
   */
  const handOffFocus = (giveKeyboard: boolean): void => {
    const top = activeId === undefined ? undefined : tabs.get(activeId)
    if (top === undefined) {
      const holder = document.activeElement
      if (holder instanceof HTMLElement && holder.tagName.toLowerCase() === 'webview') holder.blur()
      return
    }
    if (giveKeyboard) top.el.focus()
  }

  const create = (id: string, url?: string, owner: TabOwner = 'user'): Tab => {
    // `document.createElement('webview')` chứ không phải JSX: thẻ này phải nằm
    // ngoài tầm tay của React, và nó không bao giờ được dựng lại.
    const el = document.createElement('webview') as WebviewTag
    el.setAttribute('src', url ?? BLANK_PAGE)
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
      historyLength: 1,
      historyIndex: 0,
      owner,
      consoleLines: [],
    }

    const patchStatus = (patch: Partial<TabStatus>): void => {
      tab.status = { ...tab.status, ...patch }
      report(id, tab)
    }

    el.addEventListener('did-start-loading', () => { patchStatus({ loading: true }) })
    el.addEventListener('did-stop-loading', () => { patchStatus({ loading: false }) })
    el.addEventListener('page-title-updated', (event) => {
      patchStatus({ title: (event as unknown as { title: string }).title })
    })
    el.addEventListener('did-navigate', (event) => {
      const address = (event as unknown as { url: string }).url

      // Tab của AGENT vừa đáp xuống một địa chỉ nội bộ: kéo nó ra ngay.
      //
      // Đường tới đây không phải lệnh mở của agent — lệnh đó đã bị rào địa chỉ
      // ở nửa Node chặn từ trước. Đây là đường vòng: agent đưa một địa chỉ công
      // cộng hợp lệ, trang đó trả về lệnh chuyển hướng sang mạng nội bộ. Phép
      // kiểm lúc mở đã chạy xong và đã cho qua.
      //
      // Thành thật về giới hạn: tới được đây nghĩa là ĐÚNG MỘT request đã kịp
      // bay tới địa chỉ nội bộ đó. Cái chặn được là mọi thứ sau đó — agent
      // không đọc được nội dung, không thao tác được, và tab không sống lại ở
      // lần mở app sau. Bịt luôn cả request đầu tiên thì phải tách kho cookie
      // riêng cho tab agent, và chủ dự án đã chọn dùng chung.
      //
      // Địa chỉ của chính engine thì không tới được đây: lớp vỏ đã chặn cứng ở
      // tầng request cho MỌI tab (`window.ts`, chốt 4).
      if (tab.owner === 'agent' && !isPublicUrl(address)) {
        el.stop()
        void el.loadURL(BLANK_PAGE)
        patchStatus({
          url: BLANK_PAGE,
          title: 'Đã chặn: chuyển hướng tới địa chỉ nội bộ',
          loading: false,
        })
        return
      }

      // Điều hướng mới cắt bỏ nhánh "tiến" phía trước, đúng như trình duyệt.
      tab.historyIndex += 1
      tab.historyLength = tab.historyIndex + 1
      patchStatus({ url: address, canBack: tab.historyIndex > 0, canForward: false })
    })
    el.addEventListener('did-navigate-in-page', (event) => {
      const e = event as unknown as { url: string, isMainFrame: boolean }
      if (e.isMainFrame) patchStatus({ url: e.url })
    })
    // Console của trang. Hứng liên tục chứ không bật khi cần: lỗi mà agent muốn
    // đọc thường đã xảy ra TRƯỚC lúc nó nghĩ tới việc đi đọc.
    el.addEventListener('console-message', (event) => {
      const e = event as unknown as { level: number, message: string, line: number, sourceId: string }
      tab.consoleLines.push({
        level: CONSOLE_LEVELS[e.level] ?? 'info',
        text: e.message,
        source: e.sourceId,
        line: e.line,
        at: Date.now(),
      })
      if (tab.consoleLines.length > MAX_CONSOLE_LINES) {
        tab.consoleLines.splice(0, tab.consoleLines.length - MAX_CONSOLE_LINES)
      }
    })
    // Điều hướng sang trang khác thì console cũ không còn nói về trang đang xem.
    // Giữ lại là đưa cho agent bằng chứng của một trang đã đi mất.
    el.addEventListener('did-navigate', () => { tab.consoleLines.length = 0 })

    el.addEventListener('did-fail-load', (event) => {
      const e = event as unknown as { errorCode: number, isMainFrame: boolean }
      // -3 là ERR_ABORTED: người dùng bấm dừng, hoặc trang tự chuyển hướng giữa
      // chừng. Đó không phải hỏng, và báo nó ra là báo động giả.
      if (e.isMainFrame && e.errorCode !== -3) patchStatus({ loading: false })
    })

    root.append(el)
    tabs.set(id, tab)
    restack()
    return tab
  }

  return {
    ensure: (id, url, owner) => {
      const existing = tabs.get(id)
      if (existing === undefined) { create(id, url, owner); return }
      if (owner !== undefined) existing.owner = owner
      if (url !== undefined && existing.status.url === '') void existing.el.loadURL(url)
    },

    remove: (id) => {
      const tab = tabs.get(id)
      if (tab === undefined) return
      tab.el.remove()
      tabs.delete(id)
      if (activeId === id) activeId = undefined
      restack()
    },

    setActive: (id, giveKeyboard = false) => {
      activeId = id
      restack(giveKeyboard)
    },

    setRect: (rect) => {
      if (rect === undefined) {
        // Giữ nguyên vị trí và kích thước — chỉ dìm xuống. Đổi kích thước lúc
        // này là bắt mọi trang nền bố trí lại vô ích.
        sink()
        return
      }
      root.style.left = `${String(rect.x)}px`
      root.style.top = `${String(rect.y)}px`
      root.style.width = `${String(rect.width)}px`
      root.style.height = `${String(rect.height)}px`
      raise()
    },

    status: (id) => {
      const tab = tabs.get(id)
      return tab === undefined ? undefined : { ...tab.status }
    },

    navigate: (id, url) => { void tabs.get(id)?.el.loadURL(url) },

    goBack: (id) => {
      const tab = tabs.get(id)
      if (tab === undefined || tab.historyIndex <= 0) return
      tab.historyIndex -= 1
      tab.el.goBack()
      tab.status = { ...tab.status, canBack: tab.historyIndex > 0, canForward: true }
      report(id, tab)
    },

    goForward: (id) => {
      const tab = tabs.get(id)
      if (tab === undefined || tab.historyIndex >= tab.historyLength - 1) return
      tab.historyIndex += 1
      tab.el.goForward()
      tab.status = { ...tab.status, canBack: true, canForward: tab.historyIndex < tab.historyLength - 1 }
      report(id, tab)
    },

    reload: (id) => { tabs.get(id)?.el.reload() },
    stop: (id) => { tabs.get(id)?.el.stop() },
    focus: (id) => { tabs.get(id)?.el.focus() },
    element: (id) => tabs.get(id)?.el,

    destroy: () => {
      tabs.clear()
      root.remove()
    },

    // --- Bề mặt cho tầng tool ---

    list: () => [...tabs].map(([id, tab]) => ({
      id,
      url: tab.status.url,
      title: tab.status.title,
      loading: tab.status.loading,
      active: id === activeId,
      openedBy: tab.owner,
    })),

    openedBy: (id) => tabs.get(id)?.owner,
    claim: (id, owner) => {
      const tab = tabs.get(id)
      if (tab !== undefined) tab.owner = owner
    },

    evaluate: async (id, code) => {
      const tab = tabs.get(id)
      if (tab === undefined) throw new Error(`không có tab "${id}"`)
      return tab.el.executeJavaScript(code)
    },

    sendInput: (id, event) => { tabs.get(id)?.el.sendInputEvent(event) },

    insertText: async (id, text) => {
      const tab = tabs.get(id)
      if (tab === undefined) throw new Error(`không có tab "${id}"`)
      await tab.el.insertText(text)
    },

    isDrawable: async (id) => {
      const tab = tabs.get(id)
      if (tab === undefined) return false
      try {
        // Hỏi ĐÚNG MỘT câu: `requestAnimationFrame` có chạy không.
        //
        // Bản trước hỏi thêm `document.visibilityState`, và từ chối ngay nếu nó
        // không phải `visible`. Đó là một phép kiểm SAI, và chính bộ kiểm này đã
        // đo ra: mục 13 thấy một tab báo `visibility=hidden` trong khi vẫn được
        // cấp 167 khung hình mỗi giây. Hậu quả cho người dùng: agent mở một tab,
        // trang hiện ra rành rành trước mắt, mà mọi lệnh bấm và mọi lệnh chụp
        // ảnh đều bị từ chối với câu "trang này đang không được vẽ".
        //
        // Vòng `requestAnimationFrame` trả lời thẳng câu hỏi thật: Chromium
        // ngừng gọi nó khi ngừng vẽ trang. Trang có được vẽ thì nó chạy trong
        // khoảng một phần sáu mươi giây; trang không được vẽ thì nó không bao
        // giờ chạy, và hết giờ chính là câu trả lời "không".
        const drawn = await Promise.race([
          tab.el.executeJavaScript(`new Promise((res) => {
            requestAnimationFrame(() => { res(true) })
          })`),
          new Promise((r) => { setTimeout(() => { r(false) }, 1500) }),
        ])
        return drawn === true
      } catch {
        return false
      }
    },

    revealForInput: async (id) => {
      const tab = tabs.get(id)
      if (tab === undefined) throw new Error(`không có tab "${id}"`)
      const prevActive = activeId
      const wasSunk = root.style.zIndex === '-1'

      if (activeId !== id) { activeId = id; restack() }
      // `raise()` khôi phục đúng vị trí và kích thước cũ, vì `sink()` cố ý chỉ
      // đổi tầng chứ không đụng tới hình học — xem chú thích của `sink`.
      if (wasSunk) raise()
      await waitFrames(tab.el, 2)

      return () => {
        if (activeId !== prevActive) { activeId = prevActive; restack() }
        if (wasSunk) sink()
      }
    },

    consoleLog: (id) => tabs.get(id)?.consoleLines ?? [],

    webContentsId: (id) => {
      const tab = tabs.get(id)
      if (tab === undefined) return undefined
      try {
        return tab.el.getWebContentsId()
      } catch {
        // Thẻ chưa gắn xong thì chưa có id. Đây là trạng thái bình thường ngay
        // sau khi mở tab, không phải sự cố.
        return undefined
      }
    },

    setViewport: (id, size) => {
      const tab = tabs.get(id)
      if (tab === undefined) return
      if (size === undefined) {
        tab.el.style.width = ''
        tab.el.style.height = ''
        tab.el.style.transform = ''
        tab.el.style.transformOrigin = ''
        return
      }
      // Đặt bề rộng BỐ CỤC theo đúng con số agent yêu cầu, rồi thu nhỏ hình cho
      // vừa ô. Trang tin nó đang ở kích thước đó — media query, breakpoint, bố
      // cục responsive đều theo con số này — còn người dùng vẫn thấy trọn vẹn
      // trong panel hẹp. Đổi kích thước thật thì không được: panel chỉ rộng tối
      // đa 720px, không chứa nổi một khung nhìn desktop 1280px.
      const box = root.getBoundingClientRect()
      const scale = Math.min(1, box.width / size.width, box.height / size.height)
      tab.el.style.width = `${String(size.width)}px`
      tab.el.style.height = `${String(size.height)}px`
      tab.el.style.transformOrigin = 'top left'
      tab.el.style.transform = `scale(${String(scale)})`
    },
  }
}

/**
 * Chờ trang khách vẽ xong vài khung hình.
 *
 * Chờ theo KHUNG HÌNH CỦA CHÍNH TRANG KHÁCH, không phải `setTimeout` ở trang
 * chủ. Khác biệt quan trọng: một khoảng ngủ chỉ nói "đã trôi qua ngần này mili
 * giây", còn thứ cần biết là "trang đã kịp vẽ chưa" — và hai điều đó tách nhau
 * ra đúng lúc máy bận, tức đúng lúc dễ hỏng nhất.
 * @param el - thẻ trang khách.
 * @param count - số khung hình cần chờ.
 */
async function waitFrames(el: WebviewTag, count: number): Promise<void> {
  try {
    await Promise.race([
      el.executeJavaScript(`new Promise((res) => {
        let left = ${String(count)}
        const step = () => { left -= 1; if (left <= 0) res(1); else requestAnimationFrame(step) }
        requestAnimationFrame(step)
      })`),
      // Trang không được vẽ thì `requestAnimationFrame` không bao giờ chạy. Chờ
      // vô hạn ở đây là treo cả lệnh của agent; hết giờ rồi để phép kiểm
      // `isDrawable` nói ra sự thật đó.
      new Promise((r) => { setTimeout(r, 1200) }),
    ])
  } catch {
    // Trang đóng giữa chừng. Chỗ gọi sẽ tự phát hiện khi thao tác thật.
  }
}
