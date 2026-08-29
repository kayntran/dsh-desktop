/**
 * UI probe for the Plugins page — the surface that turns plugins on and off.
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
const { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const root = join(__dirname, '..')
const nodeExe = join(root, 'runtime', 'node.exe')
const dshBin = join(root, 'engine', 'node_' + 'modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

/** Package name of the plugin whose switch we flip, and the one under test. */
const DOCK_PKG = 'harness-desktop-dock'
/** Handle on our own sidebar button. Upstream's entry shares that slot. */
const TRIGGER = '[data-hdw="plugins-trigger"]'

/**
 * The plugin installed for real, then removed again.
 *
 * Chosen on facts, not taste: zero runtime dependencies, no lifecycle scripts, a
 * repository the npm record points back at, and it declares `dsh.bundle.patch` so
 * a successful install has an observable effect on the profile manifest.
 */
const TEST_PKG = 'dsh-plugin-vetting'

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
/** The throwaway DSH_HOME this run uses. Checks read the profile out of it. */
let engineHome

/**
 * Spawn the engine the way the shell spawns it, in a throwaway DSH_HOME.
 * @param reuse - true to start again in the home the last run used, which is how
 *   a plugin installed mid-run gets loaded: the engine reads its bundle list once,
 *   at boot, so nothing installed afterwards exists until it starts again.
 * @returns {Promise<string>} the engine's loopback origin.
 */
function startEngine(reuse = false) {
  const home = reuse ? engineHome : mkdtempSync(join(tmpdir(), 'hdw-switch-'))
  engineHome = home
  const nmDir = join(home, 'profiles', 'node_' + 'modules')
  mkdirSync(nmDir, { recursive: true })
  if (reuse) return spawnEngine(home)
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

  return spawnEngine(home)
}

/**
 * Start the engine process against a home that is already prepared.
 * @param home - the DSH_HOME to run in.
 * @returns {Promise<string>} the engine's loopback origin.
 */
function spawnEngine(home) {
  const statePath = join(home, 'harness-desktop-plugins.cordis.yml')
  const seedPatch = join(home, 'hdw-ws-seed.patch.yml')
  const patches = [
    '--patch', join(root, 'plugins', 'dock', 'cordis.patch.yml'),
    '--patch', join(root, 'plugins', 'plugin-manager', 'cordis.patch.yml'),
    '--patch', seedPatch,
    '--patch', statePath,
  ]

  engine = spawn(nodeExe, [dshBin, '--profile', 'web', ...patches, '--port', '0', '--no-open'], {
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
 * Open the Plugins page from the foot of the sidebar.
 *
 * The page used to be a tab inside Settings, reached by clicking every nav button
 * until our tab appeared. It is now its own surface, opened by one button that
 * upstream renders in the `sidebar.footer.action` list — the same list upstream's
 * own Cordis entry sits in, which is why the probe addresses OUR button by its
 * `data-hdw` handle rather than by class or by position.
 *
 * The ray-cast is kept from the old version and is the point of the check: "in the
 * DOM" and "reachable by a real mouse" are different questions, and only the second
 * one is what a user experiences. The whole `dongHopThoai` saga in
 * `spike-dock-ui.cjs` came from the first answering yes while the second said no.
 * @returns {Promise<object>} a report of each step.
 */
async function openSwitchTab(win) {
  const reach = await win.webContents.executeJavaScript(`(() => {
    const trigger = document.querySelector('${TRIGGER}')
    if (trigger === null) {
      // Say WHICH of the three things went wrong, otherwise the failure reads the
      // same whether the slot is missing, the bundle never loaded, or apply() threw.
      const slots = [...document.querySelectorAll('[data-slot]')].map((n) => n.getAttribute('data-slot'))
      const footer = slots.filter((n) => n.startsWith('sidebar'))
      const served = [...document.querySelectorAll('script[src*="/plugins/"]')].map((n) => n.getAttribute('src'))
      return {
        ly_do: 'không thấy nút Plugins ở chân thanh bên'
          + ' | slot sidebar.* trong trang: ' + (footer.length ? footer.join(', ') : 'KHÔNG CÓ')
          + ' | script plugin đã nạp: ' + (served.length ? served.join(', ') : 'KHÔNG CÓ')
          + ' | css của plugin-manager: '
          + String(document.querySelector('style[data-plugin="harness-desktop-plugin-manager"]') !== null)
          + ' | trong slot: ' + (document.querySelector('[data-slot="sidebar.footer.action"]')?.innerHTML ?? '?').slice(0, 400),
      }
    }
    trigger.scrollIntoView({ block: 'center' })
    const box = trigger.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    const slot = trigger.closest('[data-slot]')
    return {
      label: trigger.textContent.trim(),
      slot: slot === null ? 'không có' : slot.getAttribute('data-slot'),
      siblings: slot === null ? 0 : slot.querySelectorAll('button').length,
      clickable: hit !== null && (trigger === hit || trigger.contains(hit)),
      covering: hit === null ? 'không có' : (hit.className || hit.tagName),
    }
  })()`)
  if (reach.ly_do !== undefined) return reach

  // The real button, not a synthesized event: whether a user can reach it is the
  // question, and `dispatchEvent` would answer a different one.
  await win.webContents.executeJavaScript(
    `document.querySelector('${TRIGGER}').click()`)

  const bodyUp = await waitUntil(win, `(() => {
    const body = document.querySelector('.hdw-pm-body')
    return body !== null && body.hidden !== true && body.querySelector('.hdw-pm-grid') !== null
  })()`, 20_000)

  return { ...reach, bodyUp }
}

/** Read the whole tab body in one round trip. */
async function readTab(win) {
  return await win.webContents.executeJavaScript(`(() => {
    const body = document.querySelector('.hdw-pm-body')
    if (body === null) return { ly_do: 'thân tab không có trong trang' }
    const groups = [...body.querySelectorAll('.hdw-pm-group')].map((section) => ({
      heading: section.querySelector('h3')?.textContent.trim() ?? '',
      rows: section.querySelectorAll('.hdw-pm-card').length,
    }))
    const rows = [...body.querySelectorAll('.hdw-pm-card')].map((row) => {
      const button = row.querySelector('button')
      return {
        entryId: row.dataset.pluginEntry,
        pkg: row.querySelector('strong')?.getAttribute('title') ?? '',
        pill: row.querySelector('.hdw-pm-card-title span:last-child')?.textContent.trim() ?? '',
        action: button?.textContent.trim() ?? '',
        locked: button?.disabled === true,
        icon: row.querySelector('.hdw-pm-card-icon svg') !== null,
        desc: row.querySelector('.hdw-pm-card-desc')?.textContent.trim() ?? '',
        hasDot: row.querySelector('.hdw-pm-card-title svg, .hdw-pm-card-title span[class*="dot"]') !== null,
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
    const body = document.querySelector('.hdw-pm-body')
    const row = [...body.querySelectorAll('.hdw-pm-card')]
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
    const body = document.querySelector('.hdw-pm-body')
    if (body === null) return false
    const working = [...body.querySelectorAll('.hdw-pm-card button')]
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
  // Electron points the app path at the folder of the script it was handed, so in
  // this probe that is `scripts/`. The shell modules loaded further down resolve
  // `runtime/node.exe` and the engine CLI relative to it, exactly as they do in
  // `npm run dev` — so point it where the real app would.
  app.setAppPath(root)

  const baseUrl = await startEngine()
  console.log(`engine:  ${baseUrl}\n`)

  // Point the shell modules at the throwaway home, then lay down the pnpm
  // wrapper the app ships. Without this the installs below quietly use whatever
  // pnpm the developer's machine happens to have — which is exactly the thing a
  // user's machine will not have.
  process.env['DSH_HOME'] = engineHome
  const tools = await import(pathToFileURL(join(root, 'dist', 'main', 'tools.js')).href)
  tools.ensureTools()

  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    show: process.env['HDW_HIEN'] === '1',
    webPreferences: { webviewTag: true },
  })
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.log(`   [renderer] ${message.slice(0, 300)}`)
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

  const mounted = await waitUntil(win, `!!document.querySelector('.hdw-pm-trigger, .hdw-dock, [data-slot="sidebar.settings"]')`, 60_000)
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
  record('1. nút Plugins có ở chân thanh bên, bấm được bằng chuột thật, và mở ra trang',
    reached.ly_do === undefined && reached.bodyUp === true && reached.clickable === true,
    reached.ly_do ?? `nhãn "${reached.label}", slot ${reached.slot} (${reached.siblings} nút),`
      + ` bấm được=${reached.clickable} (kẻ che: ${reached.covering}),`
      + ` thân trang=${String(reached.bodyUp)}`)
  if (reached.bodyUp !== true) return

  // --- 2. the body actually rendered
  const view = await readTab(win)
  // Three groups: ours, installed from the market, DeepSeek's own. The middle one
  // is empty on a fresh profile and still has to be there — it is where a user
  // goes looking for what they installed.
  const twoGroups = Array.isArray(view.groups) && view.groups.length === 3
  const counted = twoGroups && view.groups.every((g) => /\(\d+\)/.test(g.heading))
  const oursGroup = twoGroups ? view.groups[0] : { rows: 0 }
  record('2. thân tab dựng ra: ba nhóm có số đếm, có dòng, có lối thoát',
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
    const body = document.querySelector('.hdw-pm-body')
    const row = [...body.querySelectorAll('.hdw-pm-card')]
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
    const body = document.querySelector('.hdw-pm-body')
    const groups = [...body.querySelectorAll('.hdw-pm-group')]
    const core = groups[groups.length - 1]
    const rows = [...core.querySelectorAll('.hdw-pm-card')]
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
    const body = document.querySelector('.hdw-pm-body')
    const row = [...body.querySelectorAll('.hdw-pm-card')]
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

  // --- 13. the cards say what each plugin does
  //
  // The whole point of moving off the old list: a wall of ids told the user
  // nothing. An icon on every card and a real sentence — not a repeat of the
  // package name — on our own plugins is what replaced it.
  const cards = await readTab(win)
  const ours = (cards.rows ?? []).filter((r) => r.pkg.startsWith('harness-desktop-'))
  const allIcons = (cards.rows ?? []).every((r) => r.icon === true)
  const oursDescribed = ours.length > 0 && ours.every((r) => r.desc.length > 0 && r.desc !== r.pkg)
  const coreDescribed = (cards.rows ?? []).filter((r) => r.desc !== '' && r.desc !== r.pkg).length
  record('13. mỗi thẻ có icon, và plugin của dự án có mô tả thật (không phải tên gói)',
    allIcons && oursDescribed && coreDescribed > 20,
    `${(cards.rows ?? []).length} thẻ, đủ icon=${String(allIcons)},`
      + ` ${coreDescribed} thẻ có mô tả riêng; của ta: `
      + ours.map((r) => `${r.pkg}="${r.desc.slice(0, 40)}"`).join(' | '))

  // The frame worth looking at: the page open with its cards rendered. Taken here
  // rather than at the end, where the last check leaves Settings on screen.
  if (process.env['HDW_ANH'] !== undefined) {
    const shot = await win.webContents.capturePage()
    writeFileSync(process.env['HDW_ANH'], shot.toPNG())
    console.log(`\nảnh trang Plugins: ${process.env['HDW_ANH']}`)
  }

  // --- 14. the page closes the two ways a user expects
  const escaped = await win.webContents.executeJavaScript(`(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 600))
    return document.querySelector('.hdw-pm-body') === null
  })()`)
  const reopened = await openSwitchTab(win)
  const masked = await win.webContents.executeJavaScript(`(async () => {
    const mask = document.querySelector('.hdw-pm-mask')
    if (mask === null) return { ly_do: 'không thấy lớp mờ' }
    mask.click()
    await new Promise((r) => setTimeout(r, 600))
    return { closed: document.querySelector('.hdw-pm-body') === null }
  })()`)
  record('14. bấm Escape đóng trang, mở lại được, và bấm ra ngoài cũng đóng',
    escaped === true && reopened.bodyUp === true && masked.closed === true,
    `Escape đóng=${String(escaped)}, mở lại=${String(reopened.bodyUp)},`
      + ` bấm ra ngoài đóng=${masked.ly_do ?? String(masked.closed)}`)

  // --- 15. collapsed sidebar: the label goes, the name must not
  const rail = await win.webContents.executeJavaScript(`(async () => {
    const bar = document.querySelector('[data-slot="sidebar"]')
    const toggle = [...(bar?.querySelectorAll('button') ?? [])]
      .find((b) => /toggle/i.test(b.className))
    if (toggle === undefined) return { ly_do: 'không thấy nút thu thanh bên' }
    toggle.click()
    await new Promise((r) => setTimeout(r, 900))
    const trigger = document.querySelector('${TRIGGER}')
    const shape = trigger === null ? null : {
      rail: trigger.className.includes('hdw-pm-trigger-rail'),
      text: trigger.textContent.trim(),
      width: Math.round(trigger.getBoundingClientRect().width),
    }
    return { shape }
  })()`)
  // Hover is retried up to three times. The collapse is animated, so the first
  // move can land on a button that is still sliding, and one miss says nothing
  // about whether a user can reach the tooltip.
  let tipText = null
  if (rail.shape !== null && rail.shape !== undefined) {
    for (let attempt = 0; attempt < 3 && tipText === null; attempt += 1) {
      const spot2 = await win.webContents.executeJavaScript(`(() => {
        const box = document.querySelector('${TRIGGER}').getBoundingClientRect()
        return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
      })()`)
      // Come from somewhere else first: a move that lands where the pointer
      // already is produces no enter event.
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 10, y: 10 })
      await sleep(300)
      win.webContents.sendInputEvent({ type: 'mouseMove', x: spot2.x, y: spot2.y })
      await waitUntil(win, `document.querySelector('[role="tooltip"]') !== null`, 6000)
      tipText = await win.webContents.executeJavaScript(`(() => {
        const el = document.querySelector('[role="tooltip"]')
        return el === null ? null : el.textContent.trim()
      })()`)
    }
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 10, y: 10 })
    await sleep(300)
  }
  record('15. thu thanh bên: nút thành icon tròn, không còn nhãn, rê chuột vẫn hiện tên',
    rail.ly_do === undefined && rail.shape?.rail === true && rail.shape?.text === ''
      && rail.shape?.width <= 40 && tipText === 'Plugins',
    rail.ly_do ?? `rail=${String(rail.shape?.rail)}, chữ="${rail.shape?.text ?? '?'}",`
      + ` rộng ${String(rail.shape?.width)}px, tooltip=${JSON.stringify(tipText)}`)

  // Put the sidebar back, so the last check runs against the normal layout.
  await win.webContents.executeJavaScript(`(() => {
    const bar = document.querySelector('[data-slot="sidebar"]')
    const toggle = [...(bar?.querySelectorAll('button') ?? [])].find((b) => /toggle/i.test(b.className))
    toggle?.click()
  })()`)
  await sleep(900)

  // --- 16. one job, one place: the old tab inside Settings must be gone
  //
  // Not cosmetic. Two surfaces doing the same thing is how a user ends up
  // flipping a switch in one place and not believing the other. Upstream's own
  // read-only tab must survive — that one is theirs, not ours.
  const settingsTabs = await win.webContents.executeJavaScript(`(async () => {
    const trigger = document.querySelector('[data-slot="sidebar.settings"] button[aria-haspopup="dialog"]')
    if (trigger === null) return { ly_do: 'không thấy nút mở Cài đặt' }
    trigger.click()
    for (let wait = 0; wait < 40; wait += 1) {
      const panel = document.querySelector('[role="dialog"][aria-modal="true"]')
      if (panel !== null) break
      await new Promise((r) => setTimeout(r, 200))
    }
    const panel = document.querySelector('[role="dialog"][aria-modal="true"]')
    if (panel === null) return { ly_do: 'panel Cài đặt không mở' }
    const buttons = [...panel.querySelectorAll('nav button')]
    for (let i = 0; i < buttons.length; i += 1) {
      buttons[i].click()
      for (let wait = 0; wait < 10; wait += 1) {
        const tabs = [...panel.querySelectorAll('[role="tab"]')]
        if (tabs.length > 0) return { labels: tabs.map((t) => t.textContent.trim()) }
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    return { ly_do: 'bấm hết ' + buttons.length + ' mục nav mà không thấy dải tab nào' }
  })()`)
  const labels = settingsTabs.labels ?? []
  record('16. Settings không còn tab "On/off" của ta, mà tab của DeepSeek vẫn còn',
    settingsTabs.ly_do === undefined && labels.length > 0
      && !labels.some((l) => /on\/off/i.test(l)),
    settingsTabs.ly_do ?? `tab trong Settings: ${JSON.stringify(labels)}`)


  // --- 17..19 the Market tab. Reopened from scratch: check 16 left Settings up.
  await win.webContents.executeJavaScript(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })()`)
  await sleep(600)
  await clearOverlays(win)
  const back = await openSwitchTab(win)
  if (back.bodyUp !== true) {
    record('17. chuyển sang tab Market', false, `không mở lại được trang: ${back.ly_do ?? String(back.bodyUp)}`)
    return
  }

  // --- 17. the tab strip: click, and the arrow keys upstream's own strips answer to
  const strip = await win.webContents.executeJavaScript(`(async () => {
    const tabs = [...document.querySelectorAll('.hdw-pm-tab')]
    if (tabs.length !== 2) return { ly_do: 'dải tab có ' + tabs.length + ' tab, chờ 2' }
    const labels = tabs.map((t) => t.textContent.trim())
    tabs[1].click()
    await new Promise((r) => setTimeout(r, 400))
    const afterClick = document.querySelector('.hdw-pm-tab[data-active="true"]')?.textContent.trim()
    // Back to the first with the keyboard, then forward again: only the selected
    // tab is in the tab order, so arrows are the only way through the strip.
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    const afterArrow = document.querySelector('.hdw-pm-tab[data-active="true"]')?.textContent.trim()
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    return {
      labels, afterClick, afterArrow,
      tabIndexes: tabs.map((t) => t.tabIndex),
      ended: document.querySelector('.hdw-pm-tab[data-active="true"]')?.textContent.trim(),
    }
  })()`)
  record('17. hai tab Installed/Market: bấm chuyển được, và phím mũi tên cũng chuyển được',
    strip.ly_do === undefined && JSON.stringify(strip.labels) === '["Installed","Market"]'
      && strip.afterClick === 'Market' && strip.afterArrow === 'Installed' && strip.ended === 'Market',
    strip.ly_do ?? `${JSON.stringify(strip.labels)}, bấm→"${strip.afterClick}",`
      + ` ArrowLeft→"${strip.afterArrow}", ArrowRight→"${strip.ended}",`
      + ` tabindex=${JSON.stringify(strip.tabIndexes)}`)

  // --- 18. the catalog really arrives, and every card carries what an install needs
  const listed = await waitUntil(win, `(() => {
    const body = document.querySelector('.hdw-pm-body:not([hidden])')
    return body !== null && (body.querySelector('.hdw-pm-grid') !== null
      || body.querySelector('[role="alert"]') !== null)
  })()`, 90_000)
  const market = await win.webContents.executeJavaScript(`(() => {
    const body = document.querySelector('.hdw-pm-body:not([hidden])')
    if (body === null) return { ly_do: 'không thấy thân tab đang hiện' }
    const alert = body.querySelector('[role="alert"]')
    if (alert !== null) return { ly_do: 'chợ báo lỗi: ' + alert.textContent.trim().slice(0, 160) }
    const cards = [...body.querySelectorAll('.hdw-pm-card')]
    return {
      cards: cards.length,
      chips: body.querySelectorAll('.hdw-pm-chips button').length,
      total: body.querySelector('.hdw-pm-pager .hdw-pm-status')?.textContent.trim() ?? '',
      allIcons: cards.every((c) => c.querySelector('.hdw-pm-card-icon svg') !== null),
      allVersions: cards.every((c) => {
        const title = c.querySelector('.hdw-pm-card-title')
        const last = title === null ? null : title.lastElementChild
        // Doubled backslashes: this whole block is a template literal, and a
        // single \\d there collapses to a plain d before the page ever sees it.
        return /^\\d+\\.\\d+\\.\\d+$/.test(last?.textContent.trim() ?? '')
      }),
      allRepos: cards.every((c) => (c.querySelector('.hdw-pm-card-meta a')?.href ?? '')
        .startsWith('https://github.com/')),
      sample: cards[0]?.querySelector('strong')?.textContent.trim() ?? '',
    }
  })()`)
  record('18. chợ tải được: có thẻ, có icon, mỗi thẻ có phiên bản cố định và link về repo GitHub',
    market.ly_do === undefined && market.cards > 20 && market.chips > 5
      && market.allIcons === true && market.allVersions === true && market.allRepos === true,
    market.ly_do ?? `${market.cards} thẻ, ${market.chips} nhóm, "${market.total}",`
      + ` icon=${String(market.allIcons)}, phiên bản=${String(market.allVersions)},`
      + ` repo=${String(market.allRepos)}, thẻ đầu="${market.sample}" (chờ chợ: ${String(listed)})`)
  if (market.ly_do !== undefined) return

  if (process.env['HDW_ANH'] !== undefined) {
    // Settle first. The probe window is never shown, so Chromium composites
    // lazily and a capture taken the instant a tab switches hands back the frame
    // from before the switch — measured: the first attempt at this shot came out
    // showing the tab we had just left.
    await sleep(2000)
    const shot = await win.webContents.capturePage()
    const path = process.env['HDW_ANH'].replace(/\.png$/i, '') + '-market.png'
    writeFileSync(path, shot.toPNG())
    console.log(`\nảnh tab Market: ${path}`)
  }

  // --- 19. search, category filter and paging each change the list
  const before = market.cards
  await typeInto(win, '.hdw-pm-body:not([hidden]) .hdw-pm-search input', 'terminal')
  await sleep(1200)
  const searched = await win.webContents.executeJavaScript(`(() => {
    const body = document.querySelector('.hdw-pm-body:not([hidden])')
    return {
      cards: body.querySelectorAll('.hdw-pm-card').length,
      total: body.querySelector('.hdw-pm-pager .hdw-pm-status')?.textContent.trim() ?? '',
    }
  })()`)
  await typeInto(win, '.hdw-pm-body:not([hidden]) .hdw-pm-search input', '')
  await sleep(1200)
  const paged = await win.webContents.executeJavaScript(`(async () => {
    const body = document.querySelector('.hdw-pm-body:not([hidden])')
    const first = body.querySelector('.hdw-pm-card')?.dataset.marketId
    const next = [...body.querySelectorAll('.hdw-pm-pager button')]
      .find((b) => /next/i.test(b.textContent))
    if (next === undefined || next.disabled) return { ly_do: 'không có nút Next bấm được' }
    next.click()
    await new Promise((r) => setTimeout(r, 1200))
    // Read every value BEFORE the next click. These are live DOM nodes: reading
    // them afterwards reports the state that came later, and the check then
    // compares a thing with itself.
    const body2 = document.querySelector('.hdw-pm-body:not([hidden])')
    const second = body2.querySelector('.hdw-pm-card')?.dataset.marketId
    const pageText = body2.querySelector('.hdw-pm-pager .hdw-pm-status')?.textContent.trim() ?? ''

    const chip = [...body2.querySelectorAll('.hdw-pm-chips button')][1]
    const label = chip?.textContent.trim() ?? ''
    chip?.click()
    await new Promise((r) => setTimeout(r, 1200))
    const body3 = document.querySelector('.hdw-pm-body:not([hidden])')
    const afterChip = body3.querySelector('.hdw-pm-pager .hdw-pm-status')?.textContent.trim() ?? ''
    return { first, second, pageText, chipLabel: label, afterChip }
  })()`)
  record('19. gõ tìm kiếm, sang trang sau, và lọc theo nhóm — cả ba đều đổi danh sách thật',
    paged.ly_do === undefined && searched.cards > 0 && searched.cards <= before
      && searched.total !== '' && paged.first !== paged.second
      && /page 2 of/.test(paged.pageText) && paged.afterChip !== paged.pageText,
    paged.ly_do ?? `tìm "terminal": ${before} → ${searched.cards} thẻ ("${searched.total}");`
      + ` sang trang: "${paged.pageText}"; lọc nhóm "${paged.chipLabel}": "${paged.afterChip}"`)

  // --- 20..22 install a real plugin, then take it away again.
  //
  // Nothing below is mocked. It reaches npm, runs the engine's own CLI, and then
  // reads the profile manifest off disk to ask whether the install had the effect
  // that makes a plugin load at the next boot.
  const readProfile = () => {
    try {
      return JSON.parse(readFileSync(join(engineHome, 'profiles', 'web', 'package.json'), 'utf8'))
    } catch (error) {
      return { ly_do: error.message }
    }
  }

  // Check 19 left a category selected. Clear it first, or the search below runs
  // inside that category and finds nothing for a reason that has nothing to do
  // with installing.
  await win.webContents.executeJavaScript(`(() => {
    const body = document.querySelector('.hdw-pm-body:not([hidden])')
    const all = body.querySelector('.hdw-pm-chips button')
    if (all !== null && all.getAttribute('aria-pressed') !== 'true') all.click()
  })()`)
  await sleep(1200)
  await typeInto(win, '.hdw-pm-body:not([hidden]) .hdw-pm-search input', TEST_PKG)
  await sleep(1500)

  // --- 20. the confirmation names what is about to run, and blocks until ticked
  const asked20 = await win.webContents.executeJavaScript(`(async () => {
    const body = document.querySelector('.hdw-pm-body:not([hidden])')
    const card = [...body.querySelectorAll('.hdw-pm-card')]
      .find((c) => c.querySelector('strong')?.getAttribute('title') === ${JSON.stringify(TEST_PKG)})
    if (card === undefined) return { ly_do: 'không tìm thấy thẻ ' + ${JSON.stringify(TEST_PKG)} }
    const button = card.querySelector('button')
    const label = button.textContent.trim()
    button.click()
    for (let wait = 0; wait < 25; wait += 1) {
      const box = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
        .find((d) => /^Install /.test(d.getAttribute('aria-label') ?? ''))
      if (box !== undefined) {
        const buttons = [...box.querySelectorAll('button')]
        const confirm = buttons[buttons.length - 1]
        const check = box.querySelector('input[type="checkbox"]')
        return {
          buttonLabel: label,
          title: box.getAttribute('aria-label'),
          text: box.textContent.trim(),
          confirmBlocked: confirm.disabled === true,
          hasCheckbox: check !== null,
        }
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    return { ly_do: 'bấm Install mà không có hộp xác nhận nào bật lên' }
  })()`)
  record('20. bấm Install: hộp xác nhận nêu đúng tên gói và repo, và còn KHOÁ khi chưa tích ô',
    asked20.ly_do === undefined && asked20.buttonLabel === 'Install'
      && asked20.confirmBlocked === true && asked20.hasCheckbox === true
      && asked20.text.includes(TEST_PKG) && asked20.text.includes('github.com'),
    asked20.ly_do ?? `"${asked20.title}", ô tích=${String(asked20.hasCheckbox)},`
      + ` nút xác nhận khoá=${String(asked20.confirmBlocked)},`
      + ` có tên gói=${String(asked20.text.includes(TEST_PKG))},`
      + ` có repo=${String(asked20.text.includes('github.com'))}`)
  if (asked20.ly_do !== undefined) return

  // --- 21. tick, confirm, and let it run for real
  const beforeDeps = Object.keys(readProfile().dependencies ?? {})
  await win.webContents.executeJavaScript(`(async () => {
    const box = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
      .find((d) => /^Install /.test(d.getAttribute('aria-label') ?? ''))
    box.querySelector('input[type="checkbox"]').click()
    await new Promise((r) => setTimeout(r, 400))
    const buttons = [...box.querySelectorAll('button')]
    buttons[buttons.length - 1].click()
  })()`)
  const settled = await waitUntil(win, `(() => {
    const banner = document.querySelector('.hdw-pm-job')
    return banner !== null && banner.dataset.jobStatus !== 'running'
  })()`, 300_000)
  const outcome = await win.webContents.executeJavaScript(`(() => {
    const banner = document.querySelector('.hdw-pm-job')
    return banner === null ? null : {
      status: banner.dataset.jobStatus,
      // The whole head line: its first child is the state dot, whose own span is
      // empty, so picking that span alone reports nothing.
      text: banner.querySelector('.hdw-pm-job-head')?.textContent.trim() ?? '',
    }
  })()`)
  const afterProfile = readProfile()
  const afterDeps = Object.keys(afterProfile.dependencies ?? {})
  const bundles = afterProfile.dsh?.profile?.bundles ?? []
  record('21. cài THẬT: chạy xong, gói vào dependencies, VÀ được ghi vào danh sách bundle của profile',
    settled === true && outcome?.status === 'done'
      && !beforeDeps.includes(TEST_PKG) && afterDeps.includes(TEST_PKG)
      && bundles.includes(TEST_PKG),
    `chờ xong=${String(settled)}, trạng thái=${String(outcome?.status)}, "${outcome?.text ?? ''}";`
      + ` dependencies ${JSON.stringify(beforeDeps)} → ${JSON.stringify(afterDeps)};`
      + ` bundles=${JSON.stringify(bundles)}`)
  if (outcome?.status !== 'done') return

  // --- 21b. the note the shell reads when the engine will not come back
  const notePath = join(engineHome, 'harness-desktop-last-install.json')
  let noteAfterInstall
  try {
    noteAfterInstall = JSON.parse(readFileSync(notePath, 'utf8'))
  } catch (error) {
    noteAfterInstall = { ly_do: error.message }
  }

  // --- 21c. installed, not restarted yet: the Installed tab has to SAY so
  //
  // Reported from the real app: install something, switch to Installed, and the
  // market group read "(0)". The user had just installed it; the page said
  // otherwise. The plugin tree only learns about it at the next boot, so the tab
  // has to carry the gap itself.
  const waiting = await win.webContents.executeJavaScript(`(async () => {
    const installed = [...document.querySelectorAll('.hdw-pm-tab')]
      .find((t) => t.textContent.trim() === 'Installed')
    installed.click()
    await new Promise((r) => setTimeout(r, 1500))
    const body = document.querySelector('.hdw-pm-body:not([hidden])')
    const group = [...body.querySelectorAll('.hdw-pm-group')]
      .find((g) => /market/i.test(g.querySelector('h3').textContent))
    if (group === undefined) return { ly_do: 'không thấy nhóm plugin cài từ chợ' }
    const card = group.querySelector('[data-plugin-pending]')
    const notice = group.querySelector('.hdw-pm-notice')
    return {
      heading: group.querySelector('h3').textContent.trim(),
      pkg: card?.getAttribute('data-plugin-pending') ?? null,
      pill: card?.querySelector('.hdw-pm-card-title')?.lastElementChild?.textContent.trim() ?? null,
      desc: card?.querySelector('.hdw-pm-card-desc')?.textContent.trim().slice(0, 40) ?? null,
      buttons: card === null ? [] : [...card.querySelectorAll('button')]
        .map((b) => b.textContent.trim() || b.getAttribute('aria-label') || '(không nhãn)'),
      notice: notice?.textContent.trim() ?? null,
    }
  })()`)
  record('21c. cài xong mà chưa khởi động lại: tab Installed vẫn hiện plugin đó, nói rõ chưa nạp, và mời khởi động lại',
    waiting.ly_do === undefined && waiting.pkg === TEST_PKG
      && /\(1\)/.test(waiting.heading ?? '') && waiting.pill === 'not loaded yet'
      && (waiting.buttons ?? []).some((b) => /^Remove /.test(b))
      && /Restart/.test(waiting.notice ?? ''),
    waiting.ly_do ?? `nhóm "${waiting.heading}", thẻ ${JSON.stringify(waiting.pkg)},`
      + ` pill "${waiting.pill}", nút ${JSON.stringify(waiting.buttons)},`
      + ` thông báo "${(waiting.notice ?? '').slice(0, 80)}", mô tả "${waiting.desc}"`)

  // Back to Market, where the next check expects to be.
  await win.webContents.executeJavaScript(`(() => {
    [...document.querySelectorAll('.hdw-pm-tab')].find((t) => t.textContent.trim() === 'Market').click()
  })()`)
  await sleep(1200)

  // --- 22. the same card now offers Remove, and removing really undoes it
  const removed = await win.webContents.executeJavaScript(`(async () => {
    const body = document.querySelector('.hdw-pm-body:not([hidden])')
    const card = [...body.querySelectorAll('.hdw-pm-card')]
      .find((c) => c.querySelector('strong')?.getAttribute('title') === ${JSON.stringify(TEST_PKG)})
    if (card === undefined) return { ly_do: 'thẻ biến mất sau khi cài' }
    const button = card.querySelector('button')
    const label = button.textContent.trim()
    if (label !== 'Remove') return { ly_do: 'nút trên thẻ vẫn là "' + label + '", chờ "Remove"' }
    button.click()
    return { label }
  })()`)
  const removedSettled = removed.ly_do === undefined && await waitUntil(win, `(() => {
    const banner = document.querySelector('.hdw-pm-job')
    return banner !== null && banner.dataset.jobStatus === 'done'
      && /removed/i.test(banner.textContent)
  })()`, 300_000)
  const finalDeps = Object.keys(readProfile().dependencies ?? {})
  record('22. thẻ đổi sang nút Remove, và bấm vào thì gói biến mất khỏi profile',
    removed.ly_do === undefined && removedSettled === true && !finalDeps.includes(TEST_PKG),
    removed.ly_do ?? `nút="${removed.label}", chờ xong=${String(removedSettled)},`
      + ` dependencies còn ${JSON.stringify(finalDeps)}`)

  // --- 23. the note: written on install, and gone once the plugin is removed
  let noteAfterRemove = 'còn'
  try {
    readFileSync(notePath, 'utf8')
  } catch {
    noteAfterRemove = 'đã xoá'
  }
  record('23. cài xong thì ghi lại tên gói cho trang lỗi, gỡ xong thì xoá đi',
    noteAfterInstall.ly_do === undefined && noteAfterInstall.pkg === TEST_PKG
      && noteAfterRemove === 'đã xoá',
    noteAfterInstall.ly_do ?? `ghi chú sau khi cài=${JSON.stringify(noteAfterInstall.pkg)},`
      + ` sau khi gỡ: ${noteAfterRemove}`)

  // --- 24. the restart handshake, both halves
  //
  // The shell holds `wait` open and the page rings `restart`. Driven from inside
  // the page so both requests carry the headers the trust gate expects, exactly
  // as they do in the app.
  const handshake = await win.webContents.executeJavaScript(`(async () => {
    const started = Date.now()
    const held = fetch('/hdw/lifecycle/wait', { cache: 'no-store' }).then((r) => r.json())
    await new Promise((r) => setTimeout(r, 500))
    const rang = await fetch('/hdw/lifecycle/restart', { method: 'POST' })
    const answer = await held
    return { ok: rang.ok, restart: answer.restart, tookMs: Date.now() - started }
  })()`)
  record('24. trang bấm "Restart now" thì yêu cầu tới được lớp vỏ đang chờ sẵn',
    handshake.ok === true && handshake.restart === true && handshake.tookMs < 20_000,
    `POST ok=${String(handshake.ok)}, trả lời restart=${String(handshake.restart)},`
      + ` mất ${handshake.tookMs}ms (chờ tối đa 25s rồi tự trả "chưa")`)

  // --- 25. the way back in: the REAL shell function, against the real profile
  //
  // Not a copy of it. `undoLastInstall` is what the error page calls when the
  // engine will not start, and that is the one moment nobody can test by hand
  // because the app is already broken. It reads DSH_HOME at call time, so
  // pointing this process at the throwaway home is enough to exercise it here.
  const reinstalled = await win.webContents.executeJavaScript(`(async () => {
    const res = await fetch('/hdw/market/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ${JSON.stringify('truelove-dreamer/' + 'dsh-plugin-vetting')} }),
    })
    if (!res.ok) return { ly_do: 'không bắt đầu cài lại được: ' + res.status }
    for (let wait = 0; wait < 600; wait += 1) {
      const seen = await (await fetch('/hdw/market/job', { cache: 'no-store' })).json()
      if (seen.job !== null && seen.job.status !== 'running') return { status: seen.job.status }
      await new Promise((r) => setTimeout(r, 500))
    }
    return { ly_do: 'cài lại không xong sau 5 phút' }
  })()`)
  if (reinstalled.status !== 'done') {
    record('25. lối lùi: nút trên trang lỗi gỡ đúng plugin vừa cài', false,
      reinstalled.ly_do ?? `cài lại kết thúc ở trạng thái ${String(reinstalled.status)}`)
  } else {
    const undo = await import(pathToFileURL(join(root, 'dist', 'main', 'plugin-undo.js')).href)
    const before25 = undo.lastInstall()
    let failed25
    try {
      await undo.undoLastInstall()
    } catch (error) {
      failed25 = error.message
    }
    const deps25 = Object.keys(readProfile().dependencies ?? {})
    const noteGone = undo.lastInstall() === undefined
    record('25. lối lùi: hàm trang lỗi gọi gỡ đúng plugin vừa cài, và quên nó đi',
      failed25 === undefined && before25?.pkg === TEST_PKG
        && !deps25.includes(TEST_PKG) && noteGone,
      failed25 ?? `ghi chú trước=${JSON.stringify(before25?.pkg)},`
        + ` dependencies còn ${JSON.stringify(deps25)}, ghi chú đã xoá=${String(noteGone)}`)
  }

  // --- 26. the package manager the app ships, not the one this machine has
  //
  // A developer machine has pnpm; the machine an installer lands on does not.
  // Comparing the VERSION is what makes this check mean something: the wrapper
  // has to resolve to the pnpm shipped inside this build, not to whatever
  // happens to be first on PATH. Every install above already went through it.
  const shim = join(engineHome, 'tools', 'bin', 'pnpm.cmd')
  let shimVersion
  try {
    shimVersion = execFileSync(shim, ['--version'], { encoding: 'utf8', shell: true }).trim()
  } catch (error) {
    shimVersion = `LỖI: ${error.message.slice(0, 120)}`
  }
  const shipped = require(join(root, 'node_' + 'modules', 'pnpm', 'package.json')).version
  record('26. app tự mang theo pnpm, nên máy chưa có pnpm vẫn cài được plugin',
    existsSync(shim) && shimVersion === shipped,
    `wrapper=${existsSync(shim) ? 'có' : 'KHÔNG CÓ'}, bản chạy được=${shimVersion},`
      + ` bản đóng gói=${shipped}`)

  // --- 27. dark mode, measured rather than assumed
  //
  // Rule 4 says colors come from the --dsw-* variables and never from a literal.
  // The way that rule breaks is invisible in light mode: a hard-coded white panel
  // looks perfect until someone switches themes. So flip the real theme source
  // and read the painted colors back.
  const readPaint = () => win.webContents.executeJavaScript(`(() => {
    const pick = (selector) => {
      const el = document.querySelector(selector)
      if (el === null) return null
      const style = getComputedStyle(el)
      return { bg: style.backgroundColor, fg: style.color }
    }
    return { panel: pick('.hdw-pm-panel'), card: pick('.hdw-pm-card'), tab: pick('.hdw-pm-tab') }
  })()`)
  /** Rough perceived lightness of an `rgb(...)` string, 0 dark to 1 light. */
  const lightness = (color) => {
    const parts = /rgba?\(([^)]+)\)/.exec(color ?? '')
    if (parts === null) return null
    const [r, g, b] = parts[1].split(',').map((n) => Number(n.trim()))
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  }

  const { nativeTheme } = require('electron')
  const beforeTheme = nativeTheme.themeSource
  nativeTheme.themeSource = 'light'
  await sleep(900)
  const lightPaint = await readPaint()
  nativeTheme.themeSource = 'dark'
  await sleep(900)
  const darkPaint = await readPaint()
  nativeTheme.themeSource = beforeTheme

  const lightPanel = lightness(lightPaint.panel?.bg)
  const darkPanel = lightness(darkPaint.panel?.bg)
  const darkCard = lightness(darkPaint.card?.bg)
  const darkText = lightness(darkPaint.tab?.fg)
  record('27. đổi sang chế độ tối: nền trang và nền thẻ tối theo, chữ sáng lên — không mảng nào kẹt trắng',
    lightPanel !== null && darkPanel !== null && lightPanel > 0.7 && darkPanel < 0.3
      && darkCard !== null && darkCard < 0.35 && darkText !== null && darkText > 0.4,
    `nền trang sáng=${lightPaint.panel?.bg} (${lightPanel?.toFixed(2)})`
      + ` → tối=${darkPaint.panel?.bg} (${darkPanel?.toFixed(2)});`
      + ` nền thẻ tối=${darkPaint.card?.bg} (${darkCard?.toFixed(2)});`
      + ` chữ tab tối=${darkPaint.tab?.fg} (${darkText?.toFixed(2)})`)

  // --- 28..30 what a market plugin looks like ONCE IT IS LOADED.
  //
  // Everything above stops at the moment the install finishes. That is not where
  // the user stops: they restart, and then they look at the thing they installed.
  // Three defects lived in exactly that gap and were only found by opening the
  // real app — the page called the plugin "one of DeepSeek's core plugins",
  // demanded an acknowledgement to turn off something the user had added five
  // minutes earlier, and offered no way to take it off again.
  const reinstall = await win.webContents.executeJavaScript(`(async () => {
    const res = await fetch('/hdw/market/install', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ${JSON.stringify('truelove-dreamer/' + 'dsh-plugin-vetting')} }),
    })
    if (!res.ok) return { ly_do: 'không cài lại được: ' + res.status }
    for (let wait = 0; wait < 600; wait += 1) {
      const seen = await (await fetch('/hdw/market/job', { cache: 'no-store' })).json()
      if (seen.job !== null && seen.job.status !== 'running') return { status: seen.job.status }
      await new Promise((r) => setTimeout(r, 500))
    }
    return { ly_do: 'cài lại không xong sau 5 phút' }
  })()`)
  if (reinstall.status !== 'done') {
    record('28. plugin từ chợ sau khi khởi động lại: nằm đúng nhóm, có nút Remove', false,
      reinstall.ly_do ?? `cài lại kết thúc ở ${String(reinstall.status)}`)
    return
  }

  // Restart the engine in the same home — the only way a freshly installed
  // plugin is ever loaded.
  try {
    execFileSync('taskkill', ['/pid', String(engine.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch { /* đã tắt */ }
  const secondUrl = await startEngine(true)
  guards.setEngineOrigin(secondUrl)
  await win.loadURL(secondUrl)
  await waitUntil(win, `!!document.querySelector('.hdw-pm-trigger')`, 60_000)
  await clearOverlays(win)
  const afterRestart = await openSwitchTab(win)
  if (afterRestart.bodyUp !== true) {
    record('28. plugin từ chợ sau khi khởi động lại: nằm đúng nhóm, có nút Remove', false,
      `không mở lại được trang sau khi engine khởi động lại: ${afterRestart.ly_do ?? String(afterRestart.bodyUp)}`)
    return
  }

  // --- 28. the plugin is loaded, in the market group, with a way back out
  const placed = await win.webContents.executeJavaScript(`(() => {
    const body = document.querySelector('.hdw-pm-body:not([hidden])')
    const groups = [...body.querySelectorAll('.hdw-pm-group')].map((g) => g.querySelector('h3').textContent.trim())
    const card = [...body.querySelectorAll('.hdw-pm-card')]
      .find((c) => c.querySelector('strong')?.getAttribute('title') === ${JSON.stringify(TEST_PKG)})
    if (card === undefined) return { ly_do: 'không thấy thẻ của plugin vừa cài trong tab Installed', groups }
    return {
      groups,
      group: card.closest('.hdw-pm-group').querySelector('h3').textContent.trim(),
      // The remove control is icon-only, so its name lives in aria-label.
      buttons: [...card.querySelectorAll('button')]
        .map((b) => b.textContent.trim() || b.getAttribute('aria-label') || '(không nhãn)'),
      desc: card.querySelector('.hdw-pm-card-desc')?.textContent.trim().slice(0, 60) ?? '',
      phase: card.querySelector('.hdw-pm-card-title').lastElementChild.textContent.trim(),
    }
  })()`)
  record('28. plugin từ chợ sau khi khởi động lại: đang chạy, nằm nhóm riêng (KHÔNG phải nhóm lõi), có mô tả và nút Remove',
    placed.ly_do === undefined && /market/i.test(placed.group ?? '')
      && (placed.buttons ?? []).some((b) => /^Remove /.test(b)) && placed.phase === 'running'
      && (placed.desc ?? '').length > 0,
    placed.ly_do ?? `nhóm "${placed.group}", nút ${JSON.stringify(placed.buttons)},`
      + ` pill "${placed.phase}", mô tả "${placed.desc}"; các nhóm: ${JSON.stringify(placed.groups)}`)

  if (process.env['HDW_ANH'] !== undefined) {
    await sleep(2000)
    const shot = await win.webContents.capturePage()
    const path = process.env['HDW_ANH'].replace(/\.png$/i, '') + '-installed.png'
    writeFileSync(path, shot.toPNG())
    console.log(`\nảnh tab Installed có plugin từ chợ: ${path}`)
  }

  // --- 29. turning it off is the user's business, not a risk to acknowledge
  const noAsk = await win.webContents.executeJavaScript(`(async () => {
    const card = [...document.querySelectorAll('.hdw-pm-card')]
      .find((c) => c.querySelector('strong')?.getAttribute('title') === ${JSON.stringify(TEST_PKG)})
    const toggle = [...card.querySelectorAll('button')]
      .find((b) => /^(Disable|Enable)$/.test(b.textContent.trim()))
    toggle.click()
    await new Promise((r) => setTimeout(r, 900))
    const dialog = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
      .find((d) => /^Disable /.test(d.getAttribute('aria-label') ?? ''))
    for (let wait = 0; wait < 40; wait += 1) {
      if (document.querySelector('.hdw-pm-notice') !== null) break
      await new Promise((r) => setTimeout(r, 300))
    }
    const list = await (await fetch('/hdw/plugins/list', { cache: 'no-store' })).json()
    const row = list.entries.find((e) => e.moduleName === ${JSON.stringify(TEST_PKG)})
    return { asked: dialog !== undefined, enabled: row?.enabled, origin: row?.origin }
  })()`)
  record('29. tắt plugin từ chợ: KHÔNG bắt xác nhận như plugin lõi, và tắt được thật',
    noAsk.asked === false && noAsk.enabled === false && noAsk.origin === 'market',
    `hỏi xác nhận=${String(noAsk.asked)}, engine báo enabled=${String(noAsk.enabled)},`
      + ` origin=${String(noAsk.origin)}`)

  // --- 30. removing it takes the stored on/off row with it
  const statePath = join(engineHome, 'harness-desktop-plugins.cordis.yml')
  const before30 = readFileSync(statePath, 'utf8')
  const gone = await win.webContents.executeJavaScript(`(async () => {
    const card = [...document.querySelectorAll('.hdw-pm-card')]
      .find((c) => c.querySelector('strong')?.getAttribute('title') === ${JSON.stringify(TEST_PKG)})
    const remove = [...card.querySelectorAll('button')]
      .find((b) => /^Remove /.test(b.getAttribute('aria-label') ?? ''))
    if (remove === undefined) return { ly_do: 'thẻ không có nút Remove' }
    remove.click()
    for (let wait = 0; wait < 600; wait += 1) {
      await new Promise((r) => setTimeout(r, 500))
      const j = await (await fetch('/hdw/market/job', { cache: 'no-store' })).json()
      if (j.job !== null && j.job.status !== 'running') return { status: j.job.status, installed: j.installed }
    }
    return { ly_do: 'gỡ không xong sau 5 phút' }
  })()`)
  const after30 = readFileSync(statePath, 'utf8')
  const rowsOf = (text) => [...text.matchAll(/^-\s+id:\s*(\S+)/gm)].map((m) => m[1])
  record('30. gỡ plugin xong thì dòng bật/tắt của nó cũng biến mất, không để lại rác trong file lựa chọn',
    gone.ly_do === undefined && gone.status === 'done'
      && rowsOf(before30).length > rowsOf(after30).length
      && !rowsOf(after30).some((id) => rowsOf(before30).includes(id) === false),
    gone.ly_do ?? `gỡ=${String(gone.status)}, còn cài ${JSON.stringify(gone.installed)};`
      + ` file lựa chọn ${JSON.stringify(rowsOf(before30))} → ${JSON.stringify(rowsOf(after30))}`)
}

app.whenReady().then(main).then(
  () => finish(),
  (error) => { console.log(`\nLỖI: ${error.message}`); finish(1) },
)

function finish(code) {
  console.log('\n=== KẾT QUẢ ===')
  const failed = results.filter((r) => !r.ok)
  console.log(failed.length === 0 && code === undefined
    ? `Tất cả ${results.length} mục đạt. Trang Plugins chạy đúng trong trang thật.`
    : `${failed.length}/${results.length} mục KHÔNG đạt${failed.length ? ': ' + failed.map((r) => r.name).join(', ') : ''}`)
  try {
    execFileSync('taskkill', ['/pid', String(engine.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch { /* đã tắt */ }
  app.exit(code ?? (failed.length === 0 ? 0 : 1))
}
