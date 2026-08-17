/**
 * Mã chạy BÊN TRONG trang web khách — mắt và tay của agent.
 *
 * Đây là một chuỗi JavaScript chứ không phải module: nó không chạy trong app mà
 * được bơm vào trang của người ta qua `webview.executeJavaScript`. Không có kiểu,
 * không có import, không dùng cú pháp mới hơn thứ trang có thể hiểu.
 *
 * ## Bốn quy tắc về mã tham chiếu, cả bốn đều có giá
 *
 * Mỗi lần đọc trang, mọi phần tử bấm được nhận một mã `ref_1`, `ref_2`… Agent
 * nói `ref_7` thay vì đoán toạ độ. Bốn quy tắc dưới đây là lỗi có thật mà dự án
 * tham chiếu đã trả giá để học:
 *
 * 1. **Cấp lại từ đầu mỗi lần đọc.** Một mã sống sót qua lần đọc lại là một mã
 *    bị đổi nghĩa âm thầm — agent bấm nhầm chỗ và không ai biết.
 * 2. **Mã chết khi trang điều hướng.** Biến toàn cục của trang bị xoá sạch, nên
 *    điều này tự đúng; nhưng câu lỗi phải nói rõ mã cũ trỏ tới cái gì.
 * 3. **Đưa phần tử vào tầm nhìn KHÔNG dùng cuộn mượt.** Cuộn mượt thì đo vị trí
 *    ngay sau đó ra vị trí cũ, và cú bấm rơi vào chỗ trống.
 * 4. **Đo bằng từng mảnh của phần tử, không bằng khung bao.** Một liên kết xuống
 *    dòng có tâm khung bao nằm lọt vào khe giữa hai dòng — bấm vào đó là bấm
 *    trượt.
 *
 * ## Phép kiểm giá trị nhất
 *
 * `locate` hỏi lại trang "ở đúng điểm này là phần tử nào". Một vòng hỏi đó bắt
 * được banner cookie, thanh dính, lớp phủ vô hình, nền mờ của hộp thoại — tất cả
 * những thứ làm cú bấm đi vào nhầm chỗ trong khi mọi lệnh vẫn báo thành công.
 * @module
 */

/** Trần số dòng mạng giữ lại. */
const MAX_NET_ENTRIES = 300

/** Trần số phản hồi giữ nội dung, và trần kích thước mỗi cái. */
const MAX_BODIES = 25
const MAX_BODY_BYTES = 8192

/**
 * Mã cài vào trang khách. Chạy nhiều lần vô hại — lần sau thấy đã có thì thôi.
 *
 * Trả về `'installed'` hoặc `'already'` để chỗ gọi biết có phải lần đầu không.
 */
export const PAGE_SCRIPT = `(() => {
  if (window.__hdw) return 'already'

  var state = { refs: new Map(), seq: 0, net: [], bodies: [] }

  // ---------------------------------------------------------------- vai trò

  var ROLE_BY_TAG = {
    a: 'link', button: 'button', textarea: 'textbox', select: 'combobox',
    img: 'image', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading',
    h5: 'heading', h6: 'heading', nav: 'navigation', main: 'main', form: 'form',
    table: 'table', ul: 'list', ol: 'list', li: 'listitem', option: 'option',
    summary: 'button', label: 'label', iframe: 'iframe', video: 'video',
    audio: 'audio', dialog: 'dialog', p: 'paragraph', article: 'article'
  }

  var ROLE_BY_INPUT = {
    checkbox: 'checkbox', radio: 'radio', range: 'slider', submit: 'button',
    button: 'button', reset: 'button', image: 'button', file: 'button',
    search: 'searchbox', hidden: ''
  }

  var INTERACTIVE = new Set([
    'link', 'button', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio',
    'slider', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab',
    'option', 'spinbutton'
  ])

  function roleOf(el) {
    var explicit = el.getAttribute('role')
    if (explicit) return explicit.trim().split(/\\s+/)[0]
    var tag = el.tagName.toLowerCase()
    if (tag === 'input') {
      var type = (el.getAttribute('type') || 'text').toLowerCase()
      if (type in ROLE_BY_INPUT) return ROLE_BY_INPUT[type]
      return 'textbox'
    }
    if (tag in ROLE_BY_TAG) return ROLE_BY_TAG[tag]
    // Phần tử tự nhận cú bấm mà không mang thẻ ngữ nghĩa nào — rất phổ biến ở
    // các app dựng bằng div. Bỏ qua chúng là bỏ qua nửa số nút của web hiện đại.
    if (el.hasAttribute('onclick') || el.getAttribute('tabindex') === '0') return 'button'
    if (el.isContentEditable) return 'textbox'
    return ''
  }

  function clean(text) {
    return String(text == null ? '' : text).replace(/\\s+/g, ' ').trim().slice(0, 140)
  }

  function nameOf(el) {
    var aria = el.getAttribute('aria-label')
    if (aria) return clean(aria)
    var by = el.getAttribute('aria-labelledby')
    if (by) {
      var parts = []
      by.split(/\\s+/).forEach(function (id) {
        var node = document.getElementById(id)
        if (node) parts.push(node.textContent || '')
      })
      if (parts.length) return clean(parts.join(' '))
    }
    var tag = el.tagName.toLowerCase()
    if (tag === 'img') return clean(el.getAttribute('alt'))
    if (tag === 'input' || tag === 'textarea') {
      return clean(el.getAttribute('placeholder') || el.getAttribute('name') || el.value)
    }
    if (tag === 'select') {
      var chosen = el.options[el.selectedIndex]
      return clean(el.getAttribute('name') || (chosen ? chosen.text : ''))
    }
    // \`innerText\` chứ không phải \`textContent\`: nó tôn trọng CSS, nên chữ đang
    // bị ẩn không lọt vào tên. Đắt hơn, nhưng đây là chỗ đắt xứng đáng.
    return clean(el.innerText || el.textContent)
  }

  function visible(el) {
    if (el.getAttribute('aria-hidden') === 'true') return false
    var cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    if (cs.opacity === '0') return false
    var r = el.getBoundingClientRect()
    // Còn nằm dưới màn hình vẫn tính là thấy được — agent cuộn tới được. Chỉ
    // phần tử KHÔNG CHIẾM CHỖ NÀO mới là phần tử không có thật.
    return r.width > 0 && r.height > 0
  }

  // ------------------------------------------------------------- đọc trang

  function scan(opts) {
    var onlyInteractive = opts.filter !== 'all'
    var maxDepth = opts.depth || 30
    var budget = opts.maxChars || 24000

    state.refs = new Map()
    state.seq = 0
    var lines = []
    var used = 0
    var truncated = false

    function walk(el, depth) {
      if (truncated || depth > maxDepth) return
      var children = el.children
      if (!visible(el)) return

      var role = roleOf(el)
      var name = nameOf(el)
      var isControl = INTERACTIVE.has(role)

      if (role && (isControl || (!onlyInteractive && name))) {
        var ref = ''
        if (isControl) {
          state.seq += 1
          ref = 'ref_' + state.seq
          state.refs.set(ref, el)
        }
        var extra = ''
        if (role === 'heading') extra = ' [level=' + el.tagName.charAt(1) + ']'
        if (el.disabled === true) extra += ' [disabled]'
        if (el.checked === true) extra += ' [checked]'
        var line = new Array(depth + 1).join('  ') + '- ' + role
          + (name ? ' "' + name + '"' : '') + extra + (ref ? ' [' + ref + ']' : '')
        used += line.length + 1
        if (used > budget) { truncated = true; return }
        lines.push(line)
      }

      for (var i = 0; i < children.length; i += 1) walk(children[i], depth + 1)
    }

    walk(document.body, 0)
    return {
      outline: lines.join('\\n'),
      refs: state.seq,
      truncated: truncated,
      url: location.href,
      title: document.title
    }
  }

  function find(query) {
    var needle = String(query || '').toLowerCase()
    var words = needle.split(/\\s+/).filter(Boolean)
    var out = []
    state.refs.forEach(function (el, ref) {
      var role = roleOf(el)
      var name = nameOf(el)
      var hay = (role + ' ' + name).toLowerCase()
      var score = 0
      if (hay.indexOf(needle) !== -1) score += 10
      words.forEach(function (w) { if (hay.indexOf(w) !== -1) score += 1 })
      if (score > 0) out.push({ ref: ref, role: role, name: name, score: score })
    })
    out.sort(function (a, b) { return b.score - a.score })
    return out.slice(0, 25)
  }

  function text(maxChars) {
    var main = document.querySelector('article') || document.querySelector('main') || document.body
    var body = (main.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim()
    var cap = maxChars || 20000
    return {
      text: body.slice(0, cap),
      truncated: body.length > cap,
      total: body.length,
      url: location.href,
      title: document.title
    }
  }

  // ------------------------------------------------------------- nhắm đích

  function describe(el) {
    if (!el) return 'nothing'
    var id = el.id ? '#' + el.id : ''
    var cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
      : ''
    return el.tagName.toLowerCase() + id + cls
  }

  function locate(ref) {
    var el = state.refs.get(ref)
    if (!el) return { error: 'no ' + ref + ' — read the page again for fresh codes' }
    if (!el.isConnected) {
      return { error: ref + ' is gone from the page (its content changed) — read it again' }
    }

    // \`instant\` chứ không phải mặc định: trang nào đặt \`scroll-behavior: smooth\`
    // thì phép đo ngay sau đây sẽ đọc ra vị trí CŨ, và cú bấm rơi vào chỗ trống.
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }) } catch (e) {
      el.scrollIntoView(true)
    }

    // Từng mảnh, không phải khung bao: một liên kết xuống dòng có tâm khung bao
    // nằm lọt vào khe giữa hai dòng.
    var rects = el.getClientRects()
    var best = null
    for (var i = 0; i < rects.length; i += 1) {
      var r = rects[i]
      if (r.width <= 0 || r.height <= 0) continue
      if (!best || r.width * r.height > best.width * best.height) best = r
    }
    if (!best) best = el.getBoundingClientRect()
    if (best.width <= 0 || best.height <= 0) {
      return { error: ref + ' takes up no space on screen (is it hidden?)' }
    }

    var x = Math.round(best.left + best.width / 2)
    var y = Math.round(best.top + best.height / 2)

    // Phép kiểm quan trọng nhất trong cả file: ở đúng điểm sắp bấm, trang trả về
    // phần tử nào? Trúng thứ khác nghĩa là có gì đó che — banner cookie, thanh
    // dính, lớp phủ vô hình, nền mờ của hộp thoại.
    var hit = document.elementFromPoint(x, y)
    var covered = !!hit && hit !== el && !el.contains(hit) && !hit.contains(el)

    return {
      x: x, y: y,
      width: Math.round(best.width), height: Math.round(best.height),
      role: roleOf(el), name: nameOf(el),
      covered: covered,
      coveredBy: covered ? describe(hit) : '',
      viewport: { width: innerWidth, height: innerHeight }
    }
  }

  function focus(ref) {
    var el = state.refs.get(ref)
    if (!el) return { error: 'no ' + ref }
    try { el.focus({ preventScroll: true }) } catch (e) { /* phần tử không nhận tiêu điểm */ }
    return { ok: document.activeElement === el }
  }

  // ------------------------------------------------------------- điền form

  function setValue(ref, value) {
    var el = state.refs.get(ref)
    if (!el) return { error: 'no ' + ref + ' — read the page again' }
    if (!el.isConnected) return { error: ref + ' is gone from the page' }

    var tag = el.tagName.toLowerCase()
    var type = (el.getAttribute('type') || '').toLowerCase()

    if (type === 'checkbox' || type === 'radio') {
      var want = value === true || value === 'true' || value === 1 || value === '1'
      if (el.checked !== want) el.click()
      return { ok: true, checked: el.checked }
    }

    if (tag === 'select') {
      var matched = false
      for (var i = 0; i < el.options.length; i += 1) {
        var opt = el.options[i]
        if (opt.value === String(value) || opt.text === String(value)) {
          el.selectedIndex = i
          matched = true
          break
        }
      }
      if (!matched) return { error: 'no option matches "' + value + '"' }
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, value: el.value }
    }

    if (el.isContentEditable) {
      el.focus()
      el.textContent = String(value)
      el.dispatchEvent(new InputEvent('input', { bubbles: true }))
      return { ok: true }
    }

    if (tag === 'input' || tag === 'textarea') {
      // Gán qua setter GỐC của prototype, không gán thẳng \`el.value\`.
      //
      // React (và mọi framework theo lối đó) ghi đè setter để theo dõi thay đổi;
      // gán thẳng thì DOM đổi mà React không biết, và ở lần vẽ lại kế tiếp nó
      // ghi đè ngược giá trị cũ lên. Triệu chứng: ô nhập nhấp nháy rồi trở về
      // trống, còn lệnh thì báo thành công.
      var proto = tag === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
      var setter = Object.getOwnPropertyDescriptor(proto, 'value')
      el.focus()
      if (setter && setter.set) setter.set.call(el, String(value))
      else el.value = String(value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, value: el.value }
    }

    return { error: 'cannot fill a <' + tag + '>' }
  }

  // ------------------------------------------------------------------ mạng

  function pushNet(entry) {
    state.net.push(entry)
    if (state.net.length > ${String(MAX_NET_ENTRIES)}) {
      state.net.splice(0, state.net.length - ${String(MAX_NET_ENTRIES)})
    }
  }

  try {
    var observer = new PerformanceObserver(function (list) {
      var entries = list.getEntries()
      for (var i = 0; i < entries.length; i += 1) {
        var e = entries[i]
        pushNet({
          url: e.name,
          kind: e.initiatorType || '',
          status: typeof e.responseStatus === 'number' ? e.responseStatus : null,
          bytes: Math.round(e.transferSize || 0),
          ms: Math.round(e.duration),
          at: Date.now()
        })
      }
    })
    // \`buffered\` để bắt cả những request đã xong TRƯỚC khi mã này được cài —
    // agent thường chỉ nghĩ tới việc đi xem mạng sau khi trang đã tải xong.
    observer.observe({ type: 'resource', buffered: true })
  } catch (e) { /* trình duyệt quá cũ — danh sách mạng sẽ rỗng, không sập */ }

  // Bắt thêm NỘI DUNG phản hồi cho request do chính trang gọi. Số liệu hiệu
  // năng ở trên không có phần này, mà đó thường là thứ cần nhất khi gỡ lỗi.
  try {
    var nativeFetch = window.fetch
    window.fetch = function () {
      var args = arguments
      var started = Date.now()
      return nativeFetch.apply(this, args).then(function (res) {
        try {
          var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || ''
          res.clone().text().then(function (body) {
            state.bodies.push({
              url: String(url), status: res.status, ms: Date.now() - started,
              body: body.slice(0, ${String(MAX_BODY_BYTES)}),
              truncated: body.length > ${String(MAX_BODY_BYTES)}
            })
            if (state.bodies.length > ${String(MAX_BODIES)}) state.bodies.shift()
          }).catch(function () { /* thân không đọc được */ })
        } catch (e) { /* không cản trở trang */ }
        return res
      })
    }
  } catch (e) { /* trang khoá fetch — bỏ qua */ }

  window.__hdw = {
    scan: scan, find: find, text: text, locate: locate, focus: focus,
    setValue: setValue,
    net: function (limit, pattern) {
      var rows = state.net
      if (pattern) {
        var re = new RegExp(pattern, 'i')
        rows = rows.filter(function (r) { return re.test(r.url) })
      }
      return { requests: rows.slice(-(limit || 50)), bodies: state.bodies.slice(-5) }
    },
    viewport: function () {
      return {
        width: innerWidth, height: innerHeight,
        scrollX: Math.round(scrollX), scrollY: Math.round(scrollY),
        pageHeight: Math.round(document.documentElement.scrollHeight)
      }
    }
  }
  return 'installed'
})()`
