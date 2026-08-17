/**
 * The code that runs INSIDE the guest web page — the agent's eyes and hands.
 *
 * This is a JavaScript string, not a module: it does not run in the app, it is injected
 * into someone else's page through `webview.executeJavaScript`. No types, no imports, no
 * syntax newer than the page might understand.
 *
 * ## Four rules about reference codes, each one paid for
 *
 * On every page read, every clickable element receives a code `ref_1`, `ref_2`… The agent
 * says `ref_7` instead of guessing coordinates. The four rules below are real bugs the
 * reference project paid to learn:
 *
 * 1. **Reissue from scratch on every read.** A code that survives a re-read is a code
 *    whose meaning changed silently — the agent clicks the wrong thing and nobody knows.
 * 2. **Codes die on navigation.** The page's globals are wiped, so this holds by itself;
 *    but the error message has to say what the old code pointed at.
 * 3. **Bring an element into view WITHOUT smooth scrolling.** With smooth scrolling, a
 *    measurement taken right afterwards reads the OLD position, and the click lands on
 *    nothing.
 * 4. **Measure from the element's individual rects, not its bounding box.** A wrapped
 *    link's bounding-box center falls into the gap between two lines — clicking there is
 *    clicking a miss.
 *
 * ## The most valuable check
 *
 * `locate` asks the page back: "what element is at exactly this point?" That one round
 * trip catches cookie banners, sticky bars, invisible overlays and dialog scrims — all
 * the things that send a click to the wrong place while every command still reports
 * success.
 * @module
 */

/** Ceiling on network entries kept. */
const MAX_NET_ENTRIES = 300

/** Ceiling on responses whose bodies are kept, and on the size of each. */
const MAX_BODIES = 25
const MAX_BODY_BYTES = 8192

/**
 * The code installed into the guest page. Running it repeatedly is harmless — a later
 * run sees it is already there and stops.
 *
 * Returns `'installed'` or `'already'` so the caller knows whether this was the first
 * time.
 */
export const PAGE_SCRIPT = `(() => {
  if (window.__hdw) return 'already'

  var state = { refs: new Map(), seq: 0, net: [], bodies: [] }

  // ----------------------------------------------------------------- roles

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
    // An element that takes clicks itself while carrying no semantic tag — very common in
    // div-built apps. Skipping them means skipping half the buttons on the modern web.
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
    // \`innerText\` rather than \`textContent\`: it respects CSS, so hidden text does not
    // leak into the name. More expensive, but this is a place worth the expense.
    return clean(el.innerText || el.textContent)
  }

  function visible(el) {
    if (el.getAttribute('aria-hidden') === 'true') return false
    var cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    if (cs.opacity === '0') return false
    var r = el.getBoundingClientRect()
    // Still below the fold counts as visible — the agent can scroll to it. Only an element
    // that OCCUPIES NO SPACE AT ALL is an element that is not really there.
    return r.width > 0 && r.height > 0
  }

  // ---------------------------------------------------------- reading the page

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

  // --------------------------------------------------------------- aiming

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

    // \`instant\` rather than the default: on a page that sets \`scroll-behavior: smooth\`,
    // the measurement right after this would read the OLD position and the click would
    // land on nothing.
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }) } catch (e) {
      el.scrollIntoView(true)
    }

    // Individual rects, not the bounding box: a wrapped link's bounding-box center falls
    // into the gap between two lines.
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

    // The most important check in the whole file: at exactly the point about to be
    // clicked, which element does the page return? Anything else means something is
    // covering it — a cookie banner, a sticky bar, an invisible overlay, a dialog scrim.
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
    try { el.focus({ preventScroll: true }) } catch (e) { /* the element refuses focus */ }
    return { ok: document.activeElement === el }
  }

  // -------------------------------------------------------- filling in forms

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
      // Assign through the prototype's NATIVE setter, not straight onto \`el.value\`.
      //
      // React (and every framework built the same way) overrides the setter to track
      // changes; assigning directly changes the DOM without React knowing, and on the next
      // render it writes the old value back over it. The symptom: the input flickers and
      // returns to empty, while the command reports success.
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

  // ---------------------------------------------------------------- network

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
    // \`buffered\` so requests that finished BEFORE this code was installed are caught too
    // — an agent usually only thinks of looking at the network after the page has loaded.
    observer.observe({ type: 'resource', buffered: true })
  } catch (e) { /* browser too old — the network list stays empty rather than crashing */ }

  // Also capture response BODIES for requests the page made itself. The performance
  // numbers above do not include them, and they are usually what is most needed when
  // debugging.
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
          }).catch(function () { /* the body could not be read */ })
        } catch (e) { /* never get in the page's way */ }
        return res
      })
    }
  } catch (e) { /* the page locked fetch down — skip it */ }

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
