/**
 * Đầu giao diện của cầu `/hdw/bus`: nhận lệnh từ nửa Node, làm, rồi trả lời.
 *
 * Sống ở tầng plugin (`apply()` của `client/index.tsx`), **không** ở trong
 * `DockPanel`. Lý do giống hệt lý do kho panel phải dựng ở tầng plugin: slot của
 * upstream có thể remount component bất cứ lúc nào, mà cầu remount là cầu chết —
 * và cái chết đó không báo gì, chỉ là từ lúc ấy agent nhờ gì cũng hết giờ.
 *
 * Mỗi lệnh ở đây là nửa dưới của một tool: tool ở nửa Node lo phần model nhìn
 * thấy (tên, mô tả, kiểm tham số), còn chỗ này lo phần chạm vào trang thật.
 * @module
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { isPublicUrl } from '../net-policy.ts'
import { PAGE_SCRIPT } from './page-script.ts'
import type { InputEvent, Stage } from './browser-stage.ts'
import type { StageHolder } from './stage-holder.ts'
import type { DockActions, DockState } from './store.ts'

/** Phải khớp `BUS_VERSION` ở `bus-routes.ts`. */
const BUS_VERSION = 2

/** Mã đóng nghĩa là "đừng nối lại". */
const CLOSE_FINAL = 4001

/** Chỉ reset bậc lùi sau khi kết nối đã sống đủ lâu để coi là lành. */
const HEALTHY_AFTER_MS = 10_000

/** Trần thời gian chờ giữa hai lần nối lại. */
const MAX_BACKOFF_MS = 30_000

/** Bảng lệnh: tên lệnh → việc phải làm. */
type CommandTable = Record<string, (params: unknown) => unknown>

/**
 * Chọn tab để thao tác.
 *
 * Bỏ trống `tab_id` thì lấy tab web đang hiện — đúng thói quen "làm trên cái
 * tôi đang nhìn". Không có tab web nào đang hiện thì **báo lỗi**, không tự chọn
 * bừa một tab nền: agent thao tác nhầm tab là loại lỗi nó không tự phát hiện
 * được, vì mọi lệnh vẫn trả về "xong".
 */
function pickTab(holder: StageHolder, params: unknown): string {
  const stage = holder.require()
  const wanted = (params as { tab_id?: unknown } | null)?.tab_id
  const tabs = stage.list()

  if (typeof wanted === 'string' && wanted !== '') {
    if (!tabs.some((t) => t.id === wanted)) {
      throw new Error(`không có tab "${wanted}". Đang mở: ${tabs.map((t) => t.id).join(', ') || '(không có tab web nào)'}`)
    }
    return wanted
  }

  const active = tabs.find((t) => t.active)
  if (active !== undefined) return active.id
  throw new Error(
    tabs.length === 0
      ? 'chưa có tab trình duyệt nào đang mở'
      : `không có tab web nào đang hiện — nêu rõ tab_id. Đang mở: ${tabs.map((t) => t.id).join(', ')}`,
  )
}

/**
 * Chọn tab, rồi từ chối nếu trang đang mở không phải địa chỉ công cộng.
 *
 * Đây là chốt **mạnh nhất** trong cả bộ rào, và nó mạnh vì chặn *lợi ích* chứ
 * không chỉ chặn *lối vào*: bất kể tab tới địa chỉ nội bộ bằng đường nào — lệnh
 * mở, chuyển hướng của máy chủ, script của trang, hay người dùng tự gõ rồi agent
 * mượn tab đó — agent cũng không đọc và không thao tác được trên nó.
 *
 * Áp cho MỌI tab, không chỉ tab agent mở. Người dùng tự mở trang quản trị router
 * rồi để đó là chuyện thường; agent không có việc gì ở trong đấy.
 */
function pickPublicTab(holder: StageHolder, params: unknown): string {
  const id = pickTab(holder, params)
  const tab = holder.require().list().find((t) => t.id === id)
  const url = tab?.url ?? ''
  // Trang trắng và tab vừa tạo chưa có địa chỉ: cho qua, chưa có gì để đọc mà
  // cũng chưa có gì để rò.
  if (url === '' || url === 'about:blank') return id
  if (!isPublicUrl(url)) {
    throw new Error(
      `tab "${id}" đang mở một địa chỉ nội bộ (${url}). `
      + 'Agent không được đọc hay thao tác trên địa chỉ nội bộ.',
    )
  }
  return id
}

/**
 * Cài mã của agent vào trang khách nếu chưa có, rồi gọi một hàm của nó.
 *
 * Phải kiểm mỗi lần chứ không cài một lần rồi thôi: mỗi lần trang điều hướng là
 * biến toàn cục bị xoá sạch, và nếu cứ thế gọi thì lỗi hiện ra dưới dạng
 * "không đọc được thuộc tính của undefined" — một câu chẳng nói gì với ai.
 */
async function callInPage(stage: Stage, id: string, expression: string): Promise<unknown> {
  const installed = await stage.evaluate(id, `typeof window.__hdw`)
  if (installed !== 'object') await stage.evaluate(id, PAGE_SCRIPT)
  return stage.evaluate(id, expression)
}

/** Đợi một khoảng, dùng cho các lệnh phải nhường cho trang phản ứng. */
const wait = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms) })

/**
 * Đọc một tham số kiểu số, có chặn trên chặn dưới.
 *
 * Model sinh tham số, và tham số sinh ra có thể là bất cứ thứ gì. Kẹp về khoảng
 * hợp lệ thay vì ném: một con số lệch không đáng làm hỏng cả lượt làm việc.
 */
function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Bảng phím: tên người đọc được → mã phím Chromium hiểu.
 *
 * Chỉ liệt những phím KHÔNG suy ra được từ ký tự. Phím chữ và phím số đi thẳng.
 */
const KEY_CODES: Record<string, string> = {
  enter: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape',
  backspace: 'Backspace', delete: 'Delete', space: 'Space',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
}

/** Tên phím bổ trợ mà Electron nhận. */
const MODIFIERS: Record<string, string> = {
  ctrl: 'control', control: 'control', alt: 'alt', shift: 'shift',
  meta: 'meta', cmd: 'meta', command: 'meta',
}

/**
 * Tách một tổ hợp phím kiểu `ctrl+shift+a` thành mã phím và phím bổ trợ.
 * @param combo - chuỗi tổ hợp.
 * @returns mã phím Chromium và danh sách phím bổ trợ.
 */
function parseKey(combo: string): { keyCode: string, modifiers: string[] } {
  const parts = combo.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean)
  const modifiers: string[] = []
  let keyCode = ''
  for (const part of parts) {
    const mod = MODIFIERS[part]
    if (mod !== undefined) { modifiers.push(mod); continue }
    keyCode = KEY_CODES[part] ?? (part.length === 1 ? part.toUpperCase() : part)
  }
  if (keyCode === '') throw new Error(`không hiểu tổ hợp phím "${combo}"`)
  return { keyCode, modifiers }
}

/**
 * Gửi một cú bấm chuột thật, có bước đưa con trỏ tới nơi trước.
 *
 * Bước `mouseMove` không phải trang trí: rất nhiều trang chỉ hiện nút, menu con
 * hay tooltip sau khi con trỏ đi qua. Bấm thẳng vào toạ độ mà không đi qua đó là
 * bấm vào một trang chưa kịp trở thành hình dạng mà agent vừa nhìn thấy.
 */
async function clickAt(
  stage: Stage,
  id: string,
  x: number,
  y: number,
  options: { button?: 'left' | 'middle' | 'right', count?: number, modifiers?: string[] },
): Promise<void> {
  const button = options.button ?? 'left'
  const count = options.count ?? 1
  const modifiers = options.modifiers ?? []
  const base: InputEvent = { type: 'mouseMove', x, y, modifiers }
  stage.sendInput(id, base)
  await wait(60)
  for (let i = 1; i <= count; i += 1) {
    stage.sendInput(id, { type: 'mouseDown', x, y, button, clickCount: i, modifiers })
    await wait(30)
    stage.sendInput(id, { type: 'mouseUp', x, y, button, clickCount: i, modifiers })
    if (i < count) await wait(40)
  }
}

/** Kết quả của bước nhắm đích, đã kiểm cả chuyện bị che. */
interface AimPoint {
  x: number
  y: number
  role: string
  name: string
}

/**
 * Tính điểm để bấm, từ mã tham chiếu hoặc từ toạ độ.
 *
 * Với mã tham chiếu, hàm này **từ chối khi phần tử bị che**, kèm tên thứ đang
 * che. Đây là điểm khác biệt lớn nhất giữa một cú bấm đúng và một cú bấm rơi vào
 * banner cookie trong khi lệnh vẫn báo thành công.
 */
async function aim(stage: Stage, id: string, params: Record<string, unknown>): Promise<AimPoint> {
  const ref = params['ref']
  if (typeof ref === 'string' && ref !== '') {
    const spot = await callInPage(stage, id, `window.__hdw.locate(${JSON.stringify(ref)})`) as {
      error?: string, x?: number, y?: number, role?: string, name?: string
      covered?: boolean, coveredBy?: string
    }
    if (spot.error !== undefined) throw new Error(spot.error)
    if (spot.covered === true) {
      throw new Error(
        `${ref} ("${spot.name ?? ''}") đang bị "${spot.coveredBy ?? '?'}" che, bấm vào sẽ trúng thứ khác. `
        + 'Thường là banner cookie, thanh dính, hay lớp phủ của hộp thoại — đóng nó trước.',
      )
    }
    return { x: spot.x ?? 0, y: spot.y ?? 0, role: spot.role ?? '', name: spot.name ?? '' }
  }

  const coordinate = params['coordinate']
  if (Array.isArray(coordinate) && coordinate.length === 2) {
    return {
      x: clampNumber(coordinate[0], 0, 0, 20_000),
      y: clampNumber(coordinate[1], 0, 0, 20_000),
      role: '', name: '',
    }
  }
  throw new Error('thiếu đích: cần "ref" (lấy từ lệnh đọc trang) hoặc "coordinate"')
}

/**
 * Dựng bảng lệnh.
 * @param actions - bộ hành động của kho panel.
 * @param holder - ô chứa sân khấu webview.
 * @returns bảng lệnh cho cầu.
 */
function buildCommands(actions: DockActions, holder: StageHolder): CommandTable {
  /**
   * Hàm trả màn hình về chỗ cũ sau khi chụp.
   *
   * Chụp ảnh là lệnh DUY NHẤT phải bắc qua hai lượt gọi — đưa tab lên trước ở
   * lượt một, lớp vỏ chụp ở giữa, trả về chỗ cũ ở lượt hai. Nên trạng thái này
   * buộc phải sống ngoài một lời gọi. Gọi `shot_prepare` hai lần liên tiếp thì
   * lượt trước được dọn trước, để không bao giờ kẹt lại một tab bị ghim.
   */
  let restoreAfterShot: (() => void) | undefined

  return {
    ping: () => ({ at: Date.now() }),

    /** Mọi tab đang mở. Nền cho `browser_tabs`. */
    tabs_list: () => ({ tabs: holder.require().list() }),

    /**
     * Chuẩn bị chụp ảnh: đưa tab lên trước, đợi nó được vẽ, rồi trả về id để
     * lớp vỏ chụp.
     *
     * Lệnh này KHÔNG chụp. Chụp phải chạy ở lớp vỏ — gọi từ trong trang làm
     * treo cứng cả cửa sổ trên trang https thật. Việc của nó là dựng đúng điều
     * kiện rồi trao chìa khoá.
     *
     * KHÔNG trả hàm khôi phục về: tab phải còn nằm trên trong lúc lớp vỏ chụp,
     * và bước trả màn hình về chỗ cũ do lệnh `shot_done` lo sau đó.
     */
    shot_prepare: async (params) => {
      const id = pickPublicTab(holder, params)
      const stage = holder.require()
      restoreAfterShot?.()
      restoreAfterShot = await stage.revealForInput(id)
      if (!await stage.isDrawable(id)) {
        restoreAfterShot()
        restoreAfterShot = undefined
        throw new Error('trang này đang không được vẽ nên không có khung hình nào để chụp')
      }
      const wcId = stage.webContentsId(id)
      if (wcId === undefined) throw new Error('tab chưa gắn xong, chưa chụp được')
      return { tab_id: id, wc_id: wcId }
    },

    /** Trả màn hình về đúng chỗ trước khi chụp. */
    shot_done: () => {
      restoreAfterShot?.()
      restoreAfterShot = undefined
      return { ok: true }
    },

    /**
     * Chạy mã trong trang khách.
     *
     * Đường này là nền của mọi lệnh đọc — đọc trang, lấy chữ, tìm phần tử, đo
     * vị trí để bấm. Mục kiểm 15d đo được nó tới nơi trên trang https thật.
     */
    page_eval: async (params) => {
      const code = (params as { code?: unknown } | null)?.code
      if (typeof code !== 'string' || code === '') throw new Error('thiếu tham số code')
      const id = pickPublicTab(holder, params)
      return { tab_id: id, value: await holder.require().evaluate(id, code) }
    },

    /**
     * Mở một tab trình duyệt vào địa chỉ cho trước.
     *
     * Trả về `tab_id` và KHÔNG hứa "trang đã tải xong". `openPane` chỉ đẩy một
     * pane vào kho; thẻ webview do `BrowserPane` tạo ở lượt render sau, và trang
     * nạp sau nữa. Hứa quá tay ở đây là tool đầu tiên xây trên cầu này sẽ báo
     * thành công cho một địa chỉ trả về 404. Lệnh "chờ tải xong" thuộc giai đoạn
     * sau, cùng lúc với đường nối tới sân khấu webview.
     *
     * Rào địa chỉ KHÔNG nằm ở đây mà ở nửa Node: một rào mà bên bị chặn tự đặt
     * được thì không phải rào.
     */
    open_tab: (params) => {
      const url = (params as { url?: unknown } | null)?.url
      if (typeof url !== 'string' || url === '') throw new Error('thiếu tham số url')
      // Đánh dấu là tab của AGENT. Nhãn này theo tab suốt đời nó, và nó là thứ
      // quyết định rào chuyển hướng có kéo tab về khi trang tự nhảy sang địa chỉ
      // nội bộ hay không.
      return { tab_id: actions.openPane('browser', url, 'agent') }
    },

    select_tab: (params) => {
      const id = pickTab(holder, params)
      actions.setActive(id)
      holder.require().setActive(id)
      return { tab_id: id }
    },

    close_tab: (params) => {
      const id = pickTab(holder, params)
      holder.require().remove(id)
      actions.closePane(id)
      return { tab_id: id, closed: true }
    },

    // ------------------------------------------------------------- điều hướng

    navigate: async (params) => {
      const p = (params ?? {}) as Record<string, unknown>
      const id = pickPublicTab(holder, params)
      const stage = holder.require()
      const action = String(p['action'] ?? 'url')

      if (action === 'back') stage.goBack(id)
      else if (action === 'forward') stage.goForward(id)
      else if (action === 'reload') stage.reload(id)
      else {
        const url = p['url']
        if (typeof url !== 'string' || url === '') throw new Error('thiếu tham số url')
        stage.navigate(id, url)
      }

      // Chờ tải xong rồi mới trả lời. Đây là khác biệt với `open_tab` — lệnh đó
      // cố ý KHÔNG hứa gì về việc trang đã tải, còn lệnh này thì có, vì agent
      // gọi nó xong là đọc trang ngay.
      const deadline = Date.now() + clampNumber(p['timeout_ms'], 15_000, 1000, 60_000)
      let status = stage.status(id)
      while (Date.now() < deadline) {
        await wait(250)
        status = stage.status(id)
        if (status !== undefined && !status.loading && status.url !== '') break
      }
      return {
        tab_id: id,
        url: status?.url ?? '',
        title: status?.title ?? '',
        loading: status?.loading ?? false,
      }
    },

    // -------------------------------------------------------------- đọc trang

    read_page: async (params) => {
      const p = (params ?? {}) as Record<string, unknown>
      const id = pickPublicTab(holder, params)
      const options = {
        filter: p['filter'] === 'all' ? 'all' : 'interactive',
        depth: clampNumber(p['depth'], 30, 1, 60),
        maxChars: clampNumber(p['max_chars'], 24_000, 500, 120_000),
      }
      const out = await callInPage(
        holder.require(), id,
        `window.__hdw.scan(${JSON.stringify(options)})`,
      )
      return { tab_id: id, ...(out as object) }
    },

    find: async (params) => {
      const p = (params ?? {}) as Record<string, unknown>
      const query = p['query']
      if (typeof query !== 'string' || query === '') throw new Error('thiếu tham số query')
      const id = pickPublicTab(holder, params)
      const matches = await callInPage(
        holder.require(), id,
        `window.__hdw.find(${JSON.stringify(query)})`,
      ) as unknown[]
      // Danh sách rỗng gần như luôn nghĩa là chưa đọc trang, chứ không phải
      // không có phần tử nào khớp. Nói ra để agent không đi tìm nhầm hướng.
      return { tab_id: id, matches, hint: matches.length === 0 ? 'chưa đọc trang lần nào, hoặc không có gì khớp' : '' }
    },

    get_page_text: async (params) => {
      const p = (params ?? {}) as Record<string, unknown>
      const id = pickPublicTab(holder, params)
      const cap = clampNumber(p['max_chars'], 20_000, 500, 200_000)
      const out = await callInPage(holder.require(), id, `window.__hdw.text(${String(cap)})`)
      return { tab_id: id, ...(out as object) }
    },

    console_log: (params) => {
      const p = (params ?? {}) as Record<string, unknown>
      const id = pickPublicTab(holder, params)
      let lines = [...holder.require().consoleLog(id)]
      if (p['only_errors'] === true) lines = lines.filter((l) => l.level === 'error')
      const pattern = p['pattern']
      if (typeof pattern === 'string' && pattern !== '') {
        const re = new RegExp(pattern, 'i')
        lines = lines.filter((l) => re.test(l.text))
      }
      const limit = clampNumber(p['limit'], 50, 1, 200)
      return { tab_id: id, messages: lines.slice(-limit) }
    },

    network_log: async (params) => {
      const p = (params ?? {}) as Record<string, unknown>
      const id = pickPublicTab(holder, params)
      const limit = clampNumber(p['limit'], 50, 1, 200)
      const pattern = typeof p['url_pattern'] === 'string' ? p['url_pattern'] : ''
      const out = await callInPage(
        holder.require(), id,
        `window.__hdw.net(${String(limit)}, ${JSON.stringify(pattern)})`,
      )
      return { tab_id: id, ...(out as object) }
    },

    // --------------------------------------------------------------- thao tác

    computer: async (params) => {
      const p = (params ?? {}) as Record<string, unknown>
      const action = String(p['action'] ?? '')
      const id = pickPublicTab(holder, params)
      const stage = holder.require()

      if (action === 'wait') {
        await wait(clampNumber(p['duration'], 1000, 50, 10_000))
        return { tab_id: id, action, ok: true }
      }

      // Trang không được vẽ thì NHẬN cú bấm và VẪN báo xong, nhưng không làm gì
      // cả. Đưa tab lên trước, làm việc, rồi trả màn hình về đúng chỗ cũ — người
      // dùng không bị nhảy tab dưới tay mình.
      const restore = await stage.revealForInput(id)
      try {
        if (!await stage.isDrawable(id)) {
          throw new Error(
            'trang này đang không được vẽ nên nó nhận thao tác mà không phản ứng. '
            + 'Hãy mở panel và chuyển sang tab đó rồi thử lại.',
          )
        }

        const modifiers = Array.isArray(p['modifiers'])
          ? (p['modifiers']).map((m) => MODIFIERS[String(m).toLowerCase()] ?? '').filter(Boolean)
          : []

        if (action === 'type') {
          const value = p['text']
          if (typeof value !== 'string') throw new Error('thiếu tham số text')
          if (typeof p['ref'] === 'string') {
            await callInPage(stage, id, `window.__hdw.focus(${JSON.stringify(p['ref'])})`)
          }
          // `insertText` thay vì gõ từng phím: nhanh hơn nhiều và không sinh ra
          // chuỗi phím sai trên bàn phím không phải tiếng Anh. Phím đặc biệt
          // (Enter, Tab) đi đường `key`.
          await stage.insertText(id, value)
          await wait(120)
          return { tab_id: id, action, typed: value.length }
        }

        if (action === 'key') {
          const combo = p['text']
          if (typeof combo !== 'string' || combo === '') throw new Error('thiếu tham số text (tổ hợp phím)')
          const repeat = clampNumber(p['repeat'], 1, 1, 50)
          const parsed = parseKey(combo)
          for (let i = 0; i < repeat; i += 1) {
            // Phím bổ trợ phải được NHẤN THẬT quanh phím chính, không chỉ gắn cờ:
            // trang nào nghe sự kiện trên chính phím Ctrl sẽ không thấy gì nếu
            // chỉ có cờ.
            for (const mod of parsed.modifiers) {
              stage.sendInput(id, { type: 'keyDown', keyCode: mod })
            }
            stage.sendInput(id, { type: 'keyDown', keyCode: parsed.keyCode, modifiers: parsed.modifiers })
            stage.sendInput(id, { type: 'keyUp', keyCode: parsed.keyCode, modifiers: parsed.modifiers })
            for (const mod of [...parsed.modifiers].reverse()) {
              stage.sendInput(id, { type: 'keyUp', keyCode: mod })
            }
            await wait(40)
          }
          return { tab_id: id, action, key: combo, repeat }
        }

        if (action === 'scroll') {
          const direction = String(p['scroll_direction'] ?? 'down')
          const amount = clampNumber(p['scroll_amount'], 3, 1, 30)
          const step = 100
          const target = typeof p['ref'] === 'string' || Array.isArray(p['coordinate'])
            ? await aim(stage, id, p)
            : { x: Math.round(400), y: Math.round(300), role: '', name: '' }
          for (let i = 0; i < amount; i += 1) {
            stage.sendInput(id, {
              type: 'mouseWheel',
              x: target.x, y: target.y,
              deltaX: direction === 'left' ? step : direction === 'right' ? -step : 0,
              deltaY: direction === 'up' ? step : direction === 'down' ? -step : 0,
              canScroll: true,
            })
            await wait(50)
          }
          const view = await callInPage(stage, id, 'window.__hdw.viewport()')
          return { tab_id: id, action, direction, amount, viewport: view }
        }

        if (action === 'scroll_to') {
          const spot = await aim(stage, id, p)
          const view = await callInPage(stage, id, 'window.__hdw.viewport()')
          return { tab_id: id, action, at: spot, viewport: view }
        }

        if (action === 'left_click_drag') {
          const from = typeof p['start_ref'] === 'string' || Array.isArray(p['start_coordinate'])
            ? await aim(stage, id, { ref: p['start_ref'], coordinate: p['start_coordinate'] })
            : undefined
          if (from === undefined) throw new Error('thiếu điểm bắt đầu: start_ref hoặc start_coordinate')
          const to = await aim(stage, id, p)
          stage.sendInput(id, { type: 'mouseMove', x: from.x, y: from.y })
          await wait(60)
          stage.sendInput(id, { type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 })
          await wait(60)
          // Kéo theo nhiều chặng chứ không nhảy một phát: giao diện kéo-thả nào
          // cũng nghe `mousemove`, và một bước nhảy duy nhất thường bị bỏ qua.
          for (let i = 1; i <= 6; i += 1) {
            stage.sendInput(id, {
              type: 'mouseMove',
              x: Math.round(from.x + (to.x - from.x) * (i / 6)),
              y: Math.round(from.y + (to.y - from.y) * (i / 6)),
            })
            await wait(40)
          }
          stage.sendInput(id, { type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 })
          return { tab_id: id, action, from, to }
        }

        if (action === 'hover') {
          const spot = await aim(stage, id, p)
          stage.sendInput(id, { type: 'mouseMove', x: spot.x, y: spot.y, modifiers })
          await wait(250)
          return { tab_id: id, action, at: spot }
        }

        const CLICKS: Record<string, { button: 'left' | 'right', count: number }> = {
          left_click: { button: 'left', count: 1 },
          right_click: { button: 'right', count: 1 },
          double_click: { button: 'left', count: 2 },
          triple_click: { button: 'left', count: 3 },
        }
        const click = CLICKS[action]
        if (click !== undefined) {
          const spot = await aim(stage, id, p)
          await clickAt(stage, id, spot.x, spot.y, { ...click, modifiers })
          await wait(200)
          return { tab_id: id, action, at: spot }
        }

        throw new Error(`không có hành động "${action}"`)
      } finally {
        restore()
      }
    },

    form_input: async (params) => {
      const p = (params ?? {}) as Record<string, unknown>
      const ref = p['ref']
      if (typeof ref !== 'string' || ref === '') throw new Error('thiếu tham số ref')
      const id = pickPublicTab(holder, params)
      const out = await callInPage(
        holder.require(), id,
        `window.__hdw.setValue(${JSON.stringify(ref)}, ${JSON.stringify(p['value'] ?? '')})`,
      ) as { error?: string }
      if (out.error !== undefined) throw new Error(out.error)
      return { tab_id: id, ...out }
    },

    resize: (params) => {
      const p = (params ?? {}) as Record<string, unknown>
      const id = pickPublicTab(holder, params)
      const PRESETS: Record<string, { width: number, height: number }> = {
        mobile: { width: 375, height: 812 },
        tablet: { width: 768, height: 1024 },
        desktop: { width: 1280, height: 800 },
      }
      const preset = typeof p['preset'] === 'string' ? PRESETS[p['preset']] : undefined
      const size = preset ?? (p['width'] !== undefined
        ? { width: clampNumber(p['width'], 1280, 320, 3840), height: clampNumber(p['height'], 800, 320, 2160) }
        : undefined)
      holder.require().setViewport(id, size)
      return { tab_id: id, viewport: size ?? 'theo panel' }
    },
  }
}

/**
 * Nối vào cầu và giữ kết nối đó sống.
 * @param actions - bộ hành động của kho panel, để lệnh tác động lên các tab.
 * @param holder - ô chứa sân khấu webview, đường duy nhất chạm tới trang web.
 * @returns hàm đóng cầu, gọi khi plugin gỡ.
 */
export function openBridge(
  actions: DockActions,
  holder: StageHolder,
  store: SnapshotStore<DockState>,
): () => void {
  const commands = buildCommands(actions, holder)
  let socket: WebSocket | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let step = 0
  let stopped = false

  const connect = (): void => {
    if (stopped) return
    const url = new URL('/hdw/bus', location.href)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const openedAt = Date.now()
    const ws = new WebSocket(url)
    socket = ws

    // Khung chào mang theo trạng thái công tắc mà người dùng đã lưu. Nửa Node
    // khởi động không biết gì về nó — nó chỉ tồn tại ở chỗ người dùng bấm.
    ws.onopen = () => {
      ws.send(JSON.stringify({
        t: 'hello',
        version: BUS_VERSION,
        agentControl: store.getSnapshot().agentControl,
      }))
    }

    ws.onmessage = (event: MessageEvent<unknown>) => {
      let frame: { t?: unknown, id?: unknown, cmd?: unknown, params?: unknown }
      try {
        frame = JSON.parse(String(event.data)) as typeof frame
      } catch {
        return
      }
      if (frame.t !== 'call' || typeof frame.id !== 'number') return
      const id = frame.id
      const command = commands[String(frame.cmd)]
      if (command === undefined) {
        ws.send(JSON.stringify({ t: 'error', id, reason: `không có lệnh "${String(frame.cmd)}"` }))
        return
      }
      // `Promise.resolve` bọc ngoài để lệnh đồng bộ và lệnh bất đồng bộ đi chung
      // một đường — và để một lệnh ném đồng bộ cũng thành `error` chứ không làm
      // đứt cả cầu.
      void Promise.resolve()
        .then(() => command(frame.params))
        .then(
          (result) => { ws.send(JSON.stringify({ t: 'done', id, result })) },
          (error: unknown) => {
            ws.send(JSON.stringify({ t: 'error', id, reason: error instanceof Error ? error.message : String(error) }))
          },
        )
    }

    ws.onclose = (event: CloseEvent) => {
      socket = undefined
      // Server đóng bằng mã riêng nghĩa là "đừng nối lại" (plugin đã gỡ, hoặc
      // lệch phiên bản giao thức). Nối lại vào một cầu đã tháo chính là thứ đẻ
      // ra bão kết nối.
      if (event.code === CLOSE_FINAL) { stopped = true; return }
      // Chỉ coi là lành khi kết nối đã sống đủ lâu. Reset bậc ngay lúc mở thì
      // trường hợp "server nhận rồi đóng ngay vì quá trần" thành vòng lặp chặt.
      if (Date.now() - openedAt > HEALTHY_AFTER_MS) step = 0
      scheduleReconnect()
    }

    // Không làm gì ở `onerror`: mọi đường hỏng đều kết thúc bằng `onclose`, và
    // nối lại ở cả hai chỗ là nối lại hai lần.
    ws.onerror = () => {}
  }

  /** Lùi theo cấp số nhân, có jitter đầy đủ. */
  const scheduleReconnect = (): void => {
    if (stopped || retryTimer !== undefined) return
    step += 1
    // Jitter không phải trang trí: thiếu nó thì hai cửa sổ app cùng mất mạng sẽ
    // nối lại đồng pha mãi mãi.
    const wait = Math.random() * Math.min(MAX_BACKOFF_MS, 500 * 2 ** step)
    retryTimer = setTimeout(() => { retryTimer = undefined; connect() }, wait)
  }

  connect()

  // Người dùng gạt công tắc thì báo NGAY, không chờ lần nối lại: tắt quyền là
  // muốn nó có hiệu lực lập tức, không phải sau lần tải trang tới.
  //
  // Cầu chưa nối thì bỏ qua — khung chào của lần nối sau đã mang giá trị mới.
  let lastSent = store.getSnapshot().agentControl
  const unsubscribe = store.subscribe(() => {
    const now = store.getSnapshot().agentControl
    if (now === lastSent) return
    lastSent = now
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ t: 'agent-control', agentControl: now }))
    }
  })

  return () => {
    stopped = true
    unsubscribe()
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    socket?.close()
    socket = undefined
  }
}
