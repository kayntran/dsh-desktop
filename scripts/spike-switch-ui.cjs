/**
 * UI probe for Settings > Plugins > On/off — the tab that turns plugins on and off.
 *
 * ## Why this file exists
 *
 * Twice in this project a defect the user hits on first sight walked straight
 * through a green test suite:
 *
 *   - the screenshot card never appeared in the chat frame  — 60 checks green
 *   - re-enabling a plugin showed no Reload button          — 13 checks green
 *
 * Both times the fault lived in COMPONENT logic: code that only runs once a real
 * page is open and someone clicks. `spike:manager` asks the engine over HTTP, and
 * the engine was right both times. Nothing opened a page. Nothing clicked.
 *
 * `spike-dock-ui.cjs` already drives a real renderer, but only ever touched the
 * dock panel. No script in this repo had ever reached the Settings page with a
 * mouse. This one does.
 *
 * ## Method — the same one `spike-dock-ui.cjs` established
 *
 * Do NOT try to drive the running app's window: Windows refuses focus to a
 * background process, and synthetic mouse messages into Chromium's child windows
 * are dropped. Instead build a BrowserWindow this probe owns, configured like the
 * real shell, pointed at the engine the probe spawned. Inside our own window
 * `executeJavaScript` clicks and reads everything.
 *
 *   npm run spike:switch
 */

// CJS, not ESM: when Electron loads an ESM entry the specifier 'electron'
// resolves through Node's resolver and hits the empty npm shim in node_modules
// instead of the built-in module — every API then returns undefined.

// VS Code's integrated terminal presets ELECTRON_RUN_AS_NODE=1, which turns
// electron.exe into a plain node.exe: no window, no built-in modules.
if (process.env['ELECTRON_RUN_AS_NODE'] !== undefined) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']
  console.log('ELECTRON_RUN_AS_NODE đang bật — khởi động lại spike trong Electron thật.\n')
  const child = spawnSync(process.execPath, [__filename, ...process.argv.slice(2)], { stdio: 'inherit', env })
  process.exit(child.status ?? 1)
}

const { app, BrowserWindow } = require('electron')

// Turn off Windows' occlusion detection. MANDATORY for a background run: the
// probe window is usually covered, Windows reports it occluded, Chromium decides
// nobody is looking and STOPS PRODUCING FRAMES. Every real-click check then fails
// for a reason that has nothing to do with the code under test. Measured in
// `spike-dock-ui.cjs`, which is where this switch came from.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

const { execFileSync, spawn } = require('node:child_process')
const { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const root = join(__dirname, '..')
const nodeExe = join(root, 'runtime', 'node.exe')
const dshBin = join(root, 'engine', 'node_' + 'modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

/** Package name of the plugin whose switch we flip, and the one under test. */
const DOCK_PKG = 'harness-desktop-dock'
/** Registration id of our tab. It reaches the DOM, which is why we can find it. */
const TAB_ID = 'hdw-switch'

/** Preferred core plugin for the confirmation-dialog checks. Only ever cancelled. */
const CORE_PREF = '@deepseek-ai/dsh-client-ui-settings-plugin-inventory'

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------- engine

let engine

/**
 * Spawn the engine the way the shell spawns it, in a throwaway DSH_HOME.
 * @returns {Promise<string>} the engine's loopback origin.
 */
function startEngine() {
  const home = mkdtempSync(join(tmpdir(), 'hdw-switch-'))
  const nmDir = join(home, 'profiles', 'node_' + 'modules')
  mkdirSync(nmDir, { recursive: true })
  // Junction, not symlink: the engine resolves each client half through
  // `createRequire(<profile dir>).resolve('<pkg>/package.json')`, and Windows
  // needs a junction for a directory link without elevation.
  symlinkSync(join(root, 'plugins', 'dock'), join(nmDir, DOCK_PKG), 'junction')
  symlinkSync(join(root, 'plugins', 'plugin-manager'),
    join(nmDir, 'harness-desktop-plugin-manager'), 'junction')

  // Seed cwd as a registered workspace. Every dock route goes through the
  // workspace gate, and a fresh DSH_HOME has no workspace — without this the
  // panel comes up crippled and it looks like the gate is inverted. Generated
  // inside the temp home because it must carry an ABSOLUTE path, and on Windows
  // it must be a `file:///C:/...` URL (a bare path raises
  // ERR_UNSUPPORTED_ESM_URL_SCHEME).
  const seedPlugin = pathToFileURL(join(root, 'scripts', 'spike-ws-seed.mjs')).href
  const seedPatch = join(home, 'hdw-ws-seed.patch.yml')
  writeFileSync(seedPatch, `- insert:\n    - id: hdw-ws-seed\n      name: ${seedPlugin}\n`)

  // The user-choices layer. It must EXIST before the engine starts — the engine
  // treats an unreadable `--patch` file as a startup failure — and it must be
  // LAST on the command line, because a layer can only edit rows that already
  // exist when it applies. Same contract as `src/main/engine.ts`.
  const statePath = join(home, 'harness-desktop-plugins.cordis.yml')
  writeFileSync(statePath, '[]\n')

  const patches = [
    '--patch', join(root, 'plugins', 'dock', 'cordis.patch.yml'),
    '--patch', join(root, 'plugins', 'plugin-manager', 'cordis.patch.yml'),
    '--patch', seedPatch,
    '--patch', statePath,
  ]

  engine = spawn(nodeExe, [dshBin, '--profile', 'web', ...patches, '--port', '0'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, DSH_HOME: home },
  })

  let out = ''
  let err = ''
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('engine không in dòng URL sau 300s')), 300_000)
    engine.stdout.setEncoding('utf8')
    engine.stdout.on('data', (chunk) => {
      out += chunk
      const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/m.exec(out)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
    engine.stderr.setEncoding('utf8')
    engine.stderr.on('data', (chunk) => { err += chunk })
    engine.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`engine thoát sớm mã ${code}\n${err.slice(-2000)}`))
    })
  })
}

// ------------------------------------------------------------------ window

/**
 * The app's real webview guards, loaded from the built output rather than copied.
 *
 * `spike-dock-ui.cjs` records why: an earlier version hand-copied the guards, then
 * drifted from them, and a check went red while the app was correct. A guard
 * verified against a copy of itself verifies nothing. Loading `dist/` also proves
 * the build still runs.
 * @returns {Promise<object>} the window module.
 */
async function loadRealGuards() {
  return import(pathToFileURL(join(root, 'dist', 'main', 'window.js')).href)
}

// ----------------------------------------------------------------- helpers

/** Re-ask an expression on a beat until it is true, or give up. */
async function waitUntil(win, expression, budgetMs) {
  const deadline = Date.now() + budgetMs
  let last
  while (Date.now() < deadline) {
    try {
      if (await win.webContents.executeJavaScript(expression) === true) return true
    } catch (error) { last = error.message }
    await sleep(300)
  }
  return last ?? `hết ${budgetMs / 1000}s`
}

/**
 * Close upstream's welcome dialogs, then wait until the app root is interactive
 * again.
 *
 * The second half is the part that is easy to miss and expensive to miss.
 * Upstream's onboarding step sets `#root.inert = true`, and an inert subtree does
 * not run activation behaviour — so `.click()` is silently ignored: no error, no
 * warning, the button simply behaves as if it was never pressed. The step also
 * refuses Escape and mask clicks (`onClose` is an empty function), so the only way
 * out is its own button.
 * @returns {Promise<string>} what happened, for the report.
 */
async function clearOverlays(win) {
  // What dialogs are showing, as one comparable string.
  //
  // Counting them is NOT enough, and that cost a run to learn: upstream's
  // onboarding steps REPLACE each other one for one — "Internal Testing Notice"
  // closes and "Add an API key" opens in the same tick — so the count sits at 1
  // the whole way through and a count-based wait concludes nothing ever closed.
  // The identity of the top dialog does change, so that is what we watch.
  const dialogSignature = async () => await win.webContents.executeJavaScript(`(() => {
    const boxes = [...document.querySelectorAll('[role="dialog"]')]
    return boxes.map((d) => (d.getAttribute('aria-label') ?? d.textContent.trim().slice(0, 40))).join(' | ')
  })()`)
  const countDialogs = async () => await win.webContents.executeJavaScript(
    `document.querySelectorAll('[role="dialog"]').length`)

  // WAIT for a dialog rather than asking once. The onboarding step mounts AFTER
  // the page settles — it renders null while it reads config over the API — so a
  // single query almost always answers "none" and the run then proceeds under a
  // mask that covers the whole window.
  let count = 0
  for (let i = 0; i < 16 && count === 0; i += 1) {
    count = await countDialogs()
    if (count === 0) await sleep(500)
  }

  // Benign close buttons, in order of preference. Deliberately NO
  // "Save"/"Confirm": a test must not commit anything on the user's behalf.
  const LABELS = 'Continue|Configure later|Skip|Later|Close|Done|Tiếp tục|Bỏ qua|Đóng|继续|跳过'
  const ways = [
    // By label first. The first version clicked the dialog's FIRST button
    // instead — and that is the header's X, whose handler upstream deliberately
    // leaves empty for onboarding steps, so nothing happened and the run died at
    // check 0.
    `[...document.querySelectorAll('[role="dialog"] button')]`
      + `.find(b => new RegExp('^(' + ${JSON.stringify(LABELS)} + ')$').test(b.textContent.trim()))?.click()`,
    // The primary action sits last in the footer.
    `(() => { const b = [...document.querySelectorAll('[role="dialog"] button')]; b[b.length - 1]?.click() })()`,
    `document.querySelector('[role="dialog"]')?.parentElement?.querySelector('[aria-hidden="true"]')?.click()`,
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  ]

  const closed = []
  for (let round = 0; round < 8; round += 1) {
    const before = await dialogSignature()
    if (before === '') break
    const label = before.slice(0, 40)
    let moved = false
    for (const way of ways) {
      try { await win.webContents.executeJavaScript(way) } catch { /* try the next way */ }
      // "Continue" WRITES an acknowledgement through the settings API before it
      // closes, so the wait has to outlast a round trip.
      for (let i = 0; i < 24 && !moved; i += 1) {
        if (await dialogSignature() !== before) moved = true
        else await sleep(250)
      }
      if (moved) break
    }
    if (!moved) {
      const seen = await win.webContents.executeJavaScript(`(() => {
        const boxes = [...document.querySelectorAll('[role="dialog"]')]
        return boxes.map((d) => ({
          label: d.getAttribute('aria-label'),
          buttons: [...d.querySelectorAll('button')].map((b) => ({
            text: b.textContent.trim().slice(0, 24),
            aria: b.getAttribute('aria-label'),
            disabled: b.disabled,
          })),
          inputs: [...d.querySelectorAll('input')].map((i) => i.type),
        }))
      })()`)
      return `KHÔNG đóng được hộp "${label}" — ${JSON.stringify(seen)}`
    }
    closed.push(label)
  }

  const live = await waitUntil(win, `(() => {
    const el = document.getElementById('root')
    return el !== null && el.inert !== true
  })()`, 20_000)
  if (live !== true) return `#root vẫn inert (${String(live)}) — MỌI CÚ BẤM SẼ BỊ BỎ QUA`
  return `đã đóng ${closed.length} hộp, #root nhận thao tác lại`
}

/**
 * Open Settings, find the Plugins section, and select our tab.
 *
 * Nothing here depends on visible text. Upstream's nav labels are localized
 * ("Plugins" is 插件 under zh), and the nav buttons carry no id, no role and no
 * data attribute — so the Plugins section is found by EFFECT: click each nav
 * button in turn and stop when our own tab appears. That works in any locale and
 * survives upstream inserting new sections.
 *
 * Our tab, by contrast, is addressable: upstream builds the tab's `id` from the
 * registration id, so `hdw-switch` is really in the DOM.
 * @returns {Promise<object>} a report of each step.
 */
async function openSwitchTab(win) {
  const opened = await win.webContents.executeJavaScript(`(() => {
    const trigger = document.querySelector('[data-slot="sidebar.settings"] button[aria-haspopup="dialog"]')
    if (trigger === null) return { ly_do: 'không thấy nút mở Cài đặt' }
    trigger.click()
    return { ok: true }
  })()`)
  if (opened.ly_do !== undefined) return opened

  const panelUp = await waitUntil(win,
    `!!document.querySelector('[role="dialog"][aria-modal="true"]')`, 15_000)
  if (panelUp !== true) return { ly_do: `panel Cài đặt không mở: ${String(panelUp)}` }

  // Walk the nav until our tab shows up.
  const found = await win.webContents.executeJavaScript(`(async () => {
    const panel = document.querySelector('[role="dialog"][aria-modal="true"]')
    const buttons = [...panel.querySelectorAll('nav button')]
    for (let i = 0; i < buttons.length; i += 1) {
      buttons[i].click()
      for (let wait = 0; wait < 12; wait += 1) {
        if (document.querySelector('button[role="tab"][id$="-tab-${TAB_ID}"]') !== null) {
          return { navCount: buttons.length, navIndex: i }
        }
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    return { ly_do: 'bấm hết ' + buttons.length + ' mục nav mà không thấy tab của ta' }
  })()`)
  if (found.ly_do !== undefined) return found

  // Ray-cast the tab's midpoint BEFORE clicking. "In the DOM" and "reachable by a
  // real mouse" are different questions, and only the second one is what a user
  // experiences. The whole `dongHopThoai` saga in `spike-dock-ui.cjs` came from
  // the first question answering yes while the second answered no.
  const reach = await win.webContents.executeJavaScript(`(() => {
    const tab = document.querySelector('button[role="tab"][id$="-tab-${TAB_ID}"]')
    const box = tab.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return {
      label: tab.textContent.trim(),
      siblings: tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]').length,
      clickable: hit !== null && (tab === hit || tab.contains(hit)),
      covering: hit === null ? 'không có' : (hit.className || hit.tagName),
    }
  })()`)

  await win.webContents.executeJavaScript(
    `document.querySelector('button[role="tab"][id$="-tab-${TAB_ID}"]').click()`)
  const bodyUp = await waitUntil(win, `(() => {
    const body = document.querySelector('[role="tabpanel"][id$="-panel-${TAB_ID}"]')
    return body !== null && body.hidden !== true && body.querySelector('.hdw-pm-list') !== null
  })()`, 20_000)

  return { ...found, ...reach, bodyUp }
}

/** Read the whole tab body in one round trip. */
async function readTab(win) {
  return await win.webContents.executeJavaScript(`(() => {
    const body = document.querySelector('[role="tabpanel"][id$="-panel-${TAB_ID}"]')
    if (body === null) return { ly_do: 'thân tab không có trong trang' }
    const groups = [...body.querySelectorAll('.hdw-pm-group')].map((section) => ({
      heading: section.querySelector('h3')?.textContent.trim() ?? '',
      rows: section.querySelectorAll('.hdw-pm-row').length,
    }))
    const rows = [...body.querySelectorAll('.hdw-pm-row')].map((row) => {
      const button = row.querySelector('button')
      return {
        entryId: row.dataset.pluginEntry,
        pkg: row.querySelector('strong')?.getAttribute('title') ?? '',
        pill: row.querySelector('.hdw-pm-row-title span:last-child')?.textContent.trim() ?? '',
        action: button?.textContent.trim() ?? '',
        locked: button?.disabled === true,
        hasDot: row.querySelector('.hdw-pm-row-title svg, .hdw-pm-row-title span[class*="dot"]') !== null,
      }
    })
    const notice = body.querySelector('.hdw-pm-notice')
    return {
      groups,
      rows,
      escape: body.querySelector('.hdw-pm-escape') !== null,
      notice: notice === null ? null : {
        role: notice.getAttribute('role'),
        text: notice.textContent.trim().slice(0, 140),
        buttons: [...notice.querySelectorAll('button')].map((b) => b.textContent.trim()),
      },
    }
  })()`)
}

/** Click the on/off button of the row whose package name matches. */
async function flip(win, pkg) {
  return await win.webContents.executeJavaScript(`(() => {
    const body = document.querySelector('[role="tabpanel"][id$="-panel-${TAB_ID}"]')
    const row = [...body.querySelectorAll('.hdw-pm-row')]
      .find((r) => r.querySelector('strong')?.getAttribute('title') === ${JSON.stringify(pkg)})
    if (row === undefined) return { ly_do: 'không thấy dòng ' + ${JSON.stringify(pkg)} }
    const button = row.querySelector('button')
    const was = button.textContent.trim()
    button.click()
    return { ok: true, was }
  })()`)
}

/** Wait for the tab to stop working, then hand back the notice it left behind. */
async function noticeAfterFlip(win) {
  const settled = await waitUntil(win, `(() => {
    const body = document.querySelector('[role="tabpanel"][id$="-panel-${TAB_ID}"]')
    if (body === null) return false
    const working = [...body.querySelectorAll('.hdw-pm-row button')]
      .some((b) => b.textContent.trim() === 'Working…')
    return !working && body.querySelector('.hdw-pm-notice') !== null
  })()`, 30_000)
  const view = await readTab(win)
  return { settled, notice: view.notice ?? null, rows: view.rows ?? [] }
}

/** Set a React-controlled input's value the way a keystroke would. */
async function typeInto(win, selector, value) {
  return await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (input === null) return { ly_do: 'không thấy ' + ${JSON.stringify(selector)} }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true }
  })()`)
}

/** Is the dock panel present in the page at all? */
async function dockPresent(win) {
  return await win.webContents.executeJavaScript(
    `document.querySelector('.hdw-dock') !== null`)
}

/**
 * Press the notice's Reload button and wait for the page to come back.
 *
 * Deliberately the REAL button rather than `win.reload()`: whether that button
 * reloads anything is exactly what the user reported broken.
 */
async function pressReload(win) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const notice = document.querySelector('.hdw-pm-notice')
    const button = [...(notice?.querySelectorAll('button') ?? [])]
      .find((b) => /reload/i.test(b.textContent))
    if (button === undefined) return { ly_do: 'không có nút Reload trong thông báo' }
    button.click()
    return { ok: true }
  })()`)
  if (clicked.ly_do !== undefined) return clicked
  await new Promise((resolve) => { win.webContents.once('did-finish-load', resolve) })
  await sleep(1500)
  return clicked
}

// -------------------------------------------------------------------- main

async function main() {
  const baseUrl = await startEngine()
  console.log(`engine:  ${baseUrl}\n`)

  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    show: process.env['HDW_HIEN'] === '1',
    webPreferences: { webviewTag: true },
  })
  const guards = await loadRealGuards()
  guards.guardWebviews(win)
  guards.setEngineOrigin(baseUrl)

  // Load once for the origin, seed the panel open, reload. Same route a real user
  // takes on every launch — the panel reads its state back from localStorage —
  // and it gives checks 6 and 8 something observable to look for.
  await win.loadURL(baseUrl)
  await win.webContents.executeJavaScript(`
    localStorage.setItem('hdw.dock', JSON.stringify({
      open: true, width: 480,
      panes: [{ id: 'p-files', kind: 'files', title: 'Files' }],
      activeId: 'p-files',
    }))
  `)
  await win.loadURL(baseUrl)

  const mounted = await waitUntil(win, `!!document.querySelector('.hdw-pm, .hdw-dock, [data-slot="sidebar.settings"]')`, 60_000)
  if (mounted !== true) {
    record('0. trang web của engine nạp được', false, String(mounted))
    return
  }

  // --- 0. overlays out of the way
  const cleared = await clearOverlays(win)
  const inertGone = !cleared.startsWith('KHÔNG') && !cleared.includes('vẫn inert')
  record('0. hộp thoại đã đóng và #root nhận lại thao tác', inertGone, cleared)
  if (!inertGone) return

  // --- 1. reach the tab
  const reached = await openSwitchTab(win)
  record('1. mở được Cài đặt → Plugins, tab của ta có mặt và bấm được bằng chuột thật',
    reached.ly_do === undefined && reached.bodyUp === true && reached.clickable === true,
    reached.ly_do ?? `nhãn "${reached.label}", ${reached.siblings} tab cùng dải,`
      + ` mục nav #${reached.navIndex}/${reached.navCount}, bấm được=${reached.clickable}`
      + ` (kẻ che: ${reached.covering}), thân tab=${String(reached.bodyUp)}`)
  if (reached.bodyUp !== true) return

  // --- 2. the body actually rendered
  const view = await readTab(win)
  const twoGroups = Array.isArray(view.groups) && view.groups.length === 2
  const counted = twoGroups && view.groups.every((g) => /\(\d+\)/.test(g.heading))
  const oursGroup = twoGroups ? view.groups[0] : { rows: 0 }
  record('2. thân tab dựng ra: hai nhóm có số đếm, có dòng, có lối thoát',
    counted && view.rows.length > 20 && oursGroup.rows >= 2 && view.escape === true,
    `${JSON.stringify(view.groups)}, tổng ${view.rows.length} dòng, lối thoát=${String(view.escape)}`)

  // --- 3. a locked row must refuse the click AND say why
  //
  // The "say why" half is not decoration: the tab's own intro sentence tells the
  // user to hover the button for the reason, so a reason that never appears is a
  // broken promise the user can see.
  // Measured with a REAL mouse move, not a synthesized `mouseenter`. Dispatching
  // the event by hand would pass even while a user sees nothing: `dispatchEvent`
  // ignores `pointer-events`, and `mouseenter` does not bubble, so hand-firing it
  // on the button proves nothing about whether hovering the button can ever reach
  // the element the tooltip is attached to.
  const spot = await win.webContents.executeJavaScript(`(() => {
    const body = document.querySelector('[role="tabpanel"][id$="-panel-${TAB_ID}"]')
    const row = [...body.querySelectorAll('.hdw-pm-row')]
      .find((r) => r.querySelector('button')?.disabled === true)
    if (row === undefined) return { ly_do: 'không có dòng nào bị khoá' }
    const button = row.querySelector('button')
    row.scrollIntoView({ block: 'center' })
    const box = button.getBoundingClientRect()
    const x = Math.round(box.left + box.width / 2)
    const y = Math.round(box.top + box.height / 2)
    const hit = document.elementFromPoint(x, y)
    return {
      x, y,
      pkg: row.querySelector('strong')?.getAttribute('title'),
      disabled: button.disabled,
      action: button.textContent.trim(),
      // What a real mouse actually lands on at that point.
      hit: hit === null ? 'không có' : (hit.className || hit.tagName),
    }
  })()`)
  if (spot.ly_do !== undefined) {
    record('3. dòng bị khoá: bấm không được, VÀ nói được lý do', false, spot.ly_do)
  } else {
    // Come from somewhere else first: a mouseMove that lands where the pointer
    // already is produces no enter event.
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 10, y: 10 })
    await sleep(200)
    win.webContents.sendInputEvent({ type: 'mouseMove', x: spot.x, y: spot.y })
    const shown = await waitUntil(win, `document.querySelector('[role="tooltip"]') !== null`, 6000)
    const tip = await win.webContents.executeJavaScript(`(() => {
      const el = document.querySelector('[role="tooltip"]')
      return el === null ? null : el.textContent.trim().slice(0, 90)
    })()`)
    record('3. dòng bị khoá: bấm không được, VÀ rê chuột vào thì nói được lý do',
      spot.disabled === true && shown === true && tip !== null && tip.length > 10,
      `${spot.pkg}: nút "${spot.action}" disabled=${String(spot.disabled)},`
        + ` chuột trúng "${spot.hit}",`
        + ` tooltip=${tip === null ? `KHÔNG HIỆN (${String(shown)})` : JSON.stringify(tip)}`)
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 10, y: 10 })
    await sleep(300)
  }

  // --- 4. the search box narrows the list
  await typeInto(win, '.hdw-pm-search input', 'harness-desktop')
  await sleep(600)
  const filtered = await readTab(win)
  await typeInto(win, '.hdw-pm-search input', '')
  await sleep(600)
  const restored = await readTab(win)
  record('4. ô tìm kiếm lọc thật, và xoá đi thì danh sách trở lại',
    filtered.rows.length > 0 && filtered.rows.length < view.rows.length
      && filtered.rows.every((r) => r.pkg.includes('harness-desktop'))
      && restored.rows.length === view.rows.length,
    `${view.rows.length} → ${filtered.rows.length} → ${restored.rows.length} dòng`)

  // --- 5. disable the dock: notice AND a way to act on it
  const dockBefore = await dockPresent(win)
  const off = await flip(win, DOCK_PKG)
  const afterOff = off.ly_do === undefined ? await noticeAfterFlip(win) : { notice: null, rows: [] }
  const offNotice = afterOff.notice
  const offHasReload = offNotice !== null && offNotice.buttons.some((b) => /reload/i.test(b))
  record('5. TẮT dock: có thông báo, và có nút Reload để bấm',
    off.ly_do === undefined && offNotice !== null && offNotice.role === 'status' && offHasReload,
    off.ly_do ?? `nút trước khi bấm="${off.was}", role=${String(offNotice?.role)},`
      + ` nút trong thông báo=${JSON.stringify(offNotice?.buttons)}, chữ="${offNotice?.text ?? ''}"`)

  // --- 6. and pressing it really removes the panel
  const pressedOff = await pressReload(win)
  const dockAfterOff = await dockPresent(win)
  record('6. bấm Reload → panel MẤT thật khỏi trang',
    pressedOff.ly_do === undefined && dockBefore === true && dockAfterOff === false,
    pressedOff.ly_do ?? `.hdw-dock: ${String(dockBefore)} → ${String(dockAfterOff)}`)

  // Back to the tab — the page reloaded, so Settings closed. This is also what the
  // user does, and it is where the reported bug lived.
  const clearedAgain = await clearOverlays(win)
  const backOn = await openSwitchTab(win)
  if (backOn.bodyUp !== true) {
    record('7. BẬT LẠI dock: có thông báo, và có nút Reload', false,
      `không quay lại được tab sau khi nạp lại: ${backOn.ly_do ?? String(backOn.bodyUp)} (${clearedAgain})`)
    return
  }

  // --- 7. THE REPORTED BUG. Re-enabling used to show no notice and no Reload
  // button, because the tab asked "does this plugin have a UI half?" only BEFORE
  // the flip — and that trace runs the other way when enabling (404 → 200).
  const on = await flip(win, DOCK_PKG)
  const afterOn = on.ly_do === undefined ? await noticeAfterFlip(win) : { notice: null, rows: [] }
  const onNotice = afterOn.notice
  const onHasReload = onNotice !== null && onNotice.buttons.some((b) => /reload/i.test(b))
  record('7. BẬT LẠI dock: có thông báo, và có nút Reload  ← đúng lỗi chủ dự án gặp',
    on.ly_do === undefined && onNotice !== null && onNotice.role === 'status' && onHasReload,
    on.ly_do ?? `nút trước khi bấm="${on.was}", role=${String(onNotice?.role)},`
      + ` nút trong thông báo=${JSON.stringify(onNotice?.buttons)}, chữ="${onNotice?.text ?? ''}"`)

  // --- 8. and pressing it really brings the panel back
  const pressedOn = onHasReload ? await pressReload(win) : { ly_do: 'không có nút Reload để bấm' }
  const dockAfterOn = await dockPresent(win)
  record('8. bấm Reload → panel QUAY VỀ thật',
    pressedOn.ly_do === undefined && dockAfterOn === true,
    pressedOn.ly_do ?? `.hdw-dock: ${String(dockAfterOff)} → ${String(dockAfterOn)}`)

  const clearedThird = await clearOverlays(win)
  const third = await openSwitchTab(win)
  if (third.bodyUp !== true) {
    record('9. plugin lõi: hộp xác nhận bật lên', false,
      `không quay lại được tab: ${third.ly_do ?? String(third.bodyUp)} (${clearedThird})`)
    return
  }

  // --- 9. a core plugin asks first, and will not act until acknowledged
  const asked = await win.webContents.executeJavaScript(`(async () => {
    const body = document.querySelector('[role="tabpanel"][id$="-panel-${TAB_ID}"]')
    const groups = [...body.querySelectorAll('.hdw-pm-group')]
    const core = groups[groups.length - 1]
    const rows = [...core.querySelectorAll('.hdw-pm-row')]
    const pick = rows.find((r) => r.querySelector('strong')?.getAttribute('title') === ${JSON.stringify(CORE_PREF)}
        && r.querySelector('button')?.disabled !== true)
      ?? rows.find((r) => r.querySelector('button')?.disabled !== true
        && r.querySelector('button')?.textContent.trim() === 'Disable')
    if (pick === undefined) return { ly_do: 'không có dòng lõi nào gạt được' }
    const pkg = pick.querySelector('strong').getAttribute('title')
    pick.querySelector('button').click()
    for (let wait = 0; wait < 20; wait += 1) {
      const box = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
        .find((d) => /^Disable /.test(d.getAttribute('aria-label') ?? ''))
      if (box !== undefined) {
        const buttons = [...box.querySelectorAll('button')]
        const confirm = buttons[buttons.length - 1]
        const box2 = box.querySelector('input[type="checkbox"]')
        return {
          pkg,
          title: box.getAttribute('aria-label'),
          confirmLabel: confirm.textContent.trim(),
          confirmBlocked: confirm.disabled === true,
          hasCheckbox: box2 !== null,
          checked: box2?.checked === true,
        }
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    return { ly_do: 'bấm tắt một plugin lõi mà không có hộp xác nhận nào bật lên', pkg }
  })()`)
  record('9. plugin lõi: hộp xác nhận bật lên, và nút Disable còn KHOÁ khi chưa tích ô',
    asked.ly_do === undefined && asked.confirmBlocked === true && asked.hasCheckbox === true
      && asked.checked === false,
    asked.ly_do ?? `"${asked.title}", ô tích=${String(asked.hasCheckbox)} (đang tích=${String(asked.checked)}),`
      + ` nút "${asked.confirmLabel}" khoá=${String(asked.confirmBlocked)}`)

  // --- 10. Cancel must change nothing
  const cancelled = await win.webContents.executeJavaScript(`(async () => {
    const box = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
      .find((d) => /^Disable /.test(d.getAttribute('aria-label') ?? ''))
    if (box === undefined) return { ly_do: 'không còn hộp xác nhận để bấm Cancel' }
    const buttons = [...box.querySelectorAll('button')]
    const cancel = buttons.find((b) => /^cancel$/i.test(b.textContent.trim()))
    if (cancel === undefined) return { ly_do: 'hộp xác nhận không có nút Cancel' }
    cancel.click()
    await new Promise((r) => setTimeout(r, 800))
    const stillOpen = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
      .some((d) => /^Disable /.test(d.getAttribute('aria-label') ?? ''))
    return { stillOpen }
  })()`)
  const afterCancel = await readTab(win)
  const cancelRow = (afterCancel.rows ?? []).find((r) => r.pkg === asked.pkg)
  record('10. bấm Cancel → hộp đóng, và plugin VẪN đang bật',
    cancelled.ly_do === undefined && cancelled.stillOpen === false
      && cancelRow !== undefined && cancelRow.action === 'Disable' && cancelRow.pill !== 'disabled',
    cancelled.ly_do ?? `hộp còn mở=${String(cancelled.stillOpen)};`
      + ` ${asked.pkg}: nút="${cancelRow?.action ?? '?'}" pill="${cancelRow?.pill ?? '?'}"`)

  // --- 11. what the screen shows agrees with what the engine says
  //
  // Asked from INSIDE the page, so the request carries the same headers the tab's
  // own request carries and passes the trust gate the same way.
  const truth = await win.webContents.executeJavaScript(
    `fetch('/hdw/plugins/list', { cache: 'no-store' }).then((r) => r.json())`)
  const byId = new Map(truth.entries.map((e) => [e.entryId, e]))
  const mismatched = (afterCancel.rows ?? []).filter((row) => {
    const real = byId.get(row.entryId)
    if (real === undefined) return true
    const shownEnabled = row.action === 'Disable'
    return shownEnabled !== real.enabled
  })
  record('11. mọi dòng trên màn hình khớp với trạng thái engine báo',
    mismatched.length === 0 && (afterCancel.rows ?? []).length > 0,
    `${(afterCancel.rows ?? []).length} dòng, lệch ${mismatched.length}`
      + `${mismatched.length === 0 ? '' : ': ' + mismatched.map((r) => r.entryId).join(', ')}`)

  // --- 12. when the engine refuses, the user must be told
  //
  // Forced from the page by making the toggle route fail, because the UI's own
  // gates make a genuine refusal unreachable by clicking. What is under test is
  // the tab's failure branch: does it surface the problem, with `role="alert"` so
  // a screen reader announces it, rather than swallowing it.
  const failed = await win.webContents.executeJavaScript(`(async () => {
    const real = window.fetch
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url
      if (url.includes('/hdw/plugins/toggle')) {
        return Promise.resolve(new Response(JSON.stringify({ reason: 'spike đã bắt route này trả lỗi' }), {
          status: 500, headers: { 'content-type': 'application/json' },
        }))
      }
      return real(input, init)
    }
    const body = document.querySelector('[role="tabpanel"][id$="-panel-${TAB_ID}"]')
    const row = [...body.querySelectorAll('.hdw-pm-row')]
      .find((r) => r.querySelector('strong')?.getAttribute('title') === ${JSON.stringify(DOCK_PKG)})
    row.querySelector('button').click()
    let seen = null
    for (let wait = 0; wait < 40; wait += 1) {
      const notice = body.querySelector('.hdw-pm-notice')
      if (notice !== null && notice.getAttribute('role') === 'alert') {
        seen = { role: 'alert', text: notice.textContent.trim().slice(0, 120) }
        break
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    window.fetch = real
    return seen ?? { ly_do: 'engine từ chối mà giao diện không báo gì' }
  })()`)
  record('12. engine từ chối → giao diện báo lỗi bằng role="alert", không nuốt lỗi',
    failed.ly_do === undefined,
    failed.ly_do ?? `role=${failed.role}, chữ="${failed.text}"`)

  if (process.env['HDW_ANH'] !== undefined) {
    const image = await win.webContents.capturePage()
    writeFileSync(process.env['HDW_ANH'], image.toPNG())
    console.log(`\nảnh cuối: ${process.env['HDW_ANH']}`)
  }
}

app.whenReady().then(main).then(
  () => finish(),
  (error) => { console.log(`\nLỖI: ${error.message}`); finish(1) },
)

function finish(code) {
  console.log('\n=== KẾT QUẢ ===')
  const failed = results.filter((r) => !r.ok)
  console.log(failed.length === 0 && code === undefined
    ? `Tất cả ${results.length} mục đạt. Tab Bật/tắt chạy đúng trong trang thật.`
    : `${failed.length}/${results.length} mục KHÔNG đạt${failed.length ? ': ' + failed.map((r) => r.name).join(', ') : ''}`)
  try {
    execFileSync('taskkill', ['/pid', String(engine.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch { /* đã tắt */ }
  app.exit(code ?? (failed.length === 0 ? 0 : 1))
}
