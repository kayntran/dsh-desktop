/**
 * The client end of the `/hdw/bus` bridge: take a command from the Node half, do
 * it, answer.
 *
 * It lives at plugin level (inside `apply()` in `client/index.tsx`), **not** inside
 * `DockPanel`. Same reason the panel store has to be built at plugin level:
 * upstream's slots may remount a component at any moment, and a remounted bridge is
 * a dead bridge — a death that reports nothing, except that from then on every
 * request from the agent times out.
 *
 * Each command here is the lower half of a tool: the tool in the Node half owns what
 * the model sees (name, description, parameter checks), and this side owns actually
 * touching the page.
 * @module
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { isPublicUrl } from '../net-policy.ts'
import { PAGE_SCRIPT } from './page-script.ts'
import type { InputEvent, Stage } from './browser-stage.ts'
import type { StageHolder } from './stage-holder.ts'
import type { DockActions, DockState } from './store.ts'

/** Must match `BUS_VERSION` in `bus-routes.ts`. */
const BUS_VERSION = 2

/** The close code that means "do not reconnect". */
const CLOSE_FINAL = 4001

/** Only reset the backoff step once a connection has lived long enough to count as healthy. */
const HEALTHY_AFTER_MS = 10_000

/** Ceiling on the wait between reconnects. */
const MAX_BACKOFF_MS = 30_000

/** The command table: command name → the work to do. */
type CommandTable = Record<string, (params: unknown) => unknown>

/**
 * Pick the tab to act on.
 *
 * With `tab_id` left out, the web tab currently on screen is used — matching the
 * habit of "act on what I am looking at". When no web tab is on screen this
 * **raises an error** rather than picking some background tab: an agent acting on
 * the wrong tab is the kind of mistake it cannot detect itself, because every
 * command still answers "done".
 */
function pickTab(holder: StageHolder, params: unknown): string {
  const stage = holder.require()
  const wanted = (params as { tab_id?: unknown } | null)?.tab_id
  const tabs = stage.list()

  if (typeof wanted === 'string' && wanted !== '') {
    if (!tabs.some((t) => t.id === wanted)) {
      throw new Error(`there is no tab "${wanted}". Currently open: ${tabs.map((t) => t.id).join(', ') || '(no web tabs at all)'}`)
    }
    return wanted
  }

  const active = tabs.find((t) => t.active)
  if (active !== undefined) return active.id
  throw new Error(
    tabs.length === 0
      ? 'no browser tab is open yet'
      : `no web tab is on screen — name a tab_id. Currently open: ${tabs.map((t) => t.id).join(', ')}`,
  )
}

/**
 * Pick the tab, then refuse if the page it has open is not a public address.
 *
 * This is the **strongest** gate in the whole set, and it is strong because it
 * blocks the *payoff* rather than only the *entrance*: however the tab arrived at a
 * private address — an open command, a server redirect, the page's own script, or
 * the user typing it and the agent borrowing that tab — the agent can neither read
 * it nor act on it.
 *
 * Applies to EVERY tab, not only tabs the agent opened. A user opening their
 * router's admin page and leaving it there is ordinary; the agent has no business
 * inside it.
 */
function pickPublicTab(holder: StageHolder, params: unknown): string {
  const id = pickTab(holder, params)
  const tab = holder.require().list().find((t) => t.id === id)
  const url = tab?.url ?? ''
  // A blank page, and a freshly created tab with no address yet: allowed through,
  // there is nothing to read and nothing to leak.
  if (url === '' || url === 'about:blank') return id
  if (!isPublicUrl(url)) {
    throw new Error(
      `tab "${id}" has a private address open (${url}). `
      + 'The agent may not read or act on a private address.',
    )
  }
  return id
}

/**
 * Install the agent's script into the guest page if it is not there, then call one
 * of its functions.
 *
 * It has to be checked every time rather than installed once: every navigation
 * wipes the page's globals, and calling regardless surfaces the failure as "cannot
 * read property of undefined" — a sentence that tells nobody anything.
 */
async function callInPage(stage: Stage, id: string, expression: string): Promise<unknown> {
  const installed = await withPageReady(stage, id, stage.evaluate(id, `typeof window.__hdw`))
  if (installed !== 'object') await withPageReady(stage, id, stage.evaluate(id, PAGE_SCRIPT))
  return withPageReady(stage, id, stage.evaluate(id, expression))
}

/**
 * Budget for one run of code inside the page before concluding the page is not
 * ready. Deliberately SHORTER than the tool's own limit (25s) so the answer reaches
 * the model as an explanation rather than an empty timeout.
 */
const PAGE_READY_MS = 12_000

/**
 * Wrap a call into the guest page with a deadline and an error that tells the truth.
 *
 * Why it is needed: `executeJavaScript` on a page whose **DOM is not built yet**
 * neither throws nor answers — it just waits. A slow page, or a page holding a
 * connection open (measured on httpbin.org), made every read hang the full 25
 * seconds and then die with *"command read_page got no answer within 25000ms"*. A
 * model reading that has no idea what to do, so it retries, and the retry hangs for
 * another 25 seconds.
 *
 * What it needs to know is that **the page has not finished loading**, plus the
 * address so it can decide for itself whether to wait or reload. That is this
 * function's entire job.
 * @param stage - the webview stage.
 * @param id - the tab being acted on.
 * @param work - the call already in flight.
 * @returns the result, or throws with an explanation once the deadline passes.
 */
async function withPageReady(stage: Stage, id: string, work: Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = Symbol('expired')
  try {
    const outcome = await Promise.race([
      work,
      new Promise((resolve) => { timer = setTimeout(() => { resolve(expired) }, PAGE_READY_MS) }),
    ])
    if (outcome !== expired) return outcome
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }

  const tab = stage.list().find((t) => t.id === id)
  throw new Error(
    `the page has not finished loading, so nothing can run inside it yet`
    + `${tab === undefined ? '' : ` (${tab.loading ? 'still loading' : 'stopped loading but not built yet'}: ${tab.url})`}. `
    + 'Wait a few seconds and try again, or use browser_navigate to reload the page.',
  )
}

/** Wait a while, for commands that must give the page time to react. */
const wait = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms) })

/**
 * Read a numeric parameter, with a floor and a ceiling.
 *
 * The model generates these parameters, and what it generates can be anything.
 * Clamp into the valid range rather than throwing: one number out of range does not
 * deserve to wreck a whole working session.
 */
function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Key table: readable name → the key code Chromium understands.
 *
 * Only keys that CANNOT be derived from a character are listed. Letters and digits
 * pass straight through.
 */
const KEY_CODES: Record<string, string> = {
  enter: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape',
  backspace: 'Backspace', delete: 'Delete', space: 'Space',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
}

/** Modifier names Electron accepts. */
const MODIFIERS: Record<string, string> = {
  ctrl: 'control', control: 'control', alt: 'alt', shift: 'shift',
  meta: 'meta', cmd: 'meta', command: 'meta',
}

/**
 * Split a chord like `ctrl+shift+a` into a key code and its modifiers.
 * @param combo - the chord string.
 * @returns the Chromium key code and the list of modifiers.
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
  if (keyCode === '') throw new Error(`key chord "${combo}" is not understood`)
  return { keyCode, modifiers }
}

/**
 * Send a real mouse click, moving the pointer there first.
 *
 * The `mouseMove` step is not decoration: plenty of pages only reveal a button, a
 * submenu or a tooltip once the pointer passes over. Clicking a coordinate without
 * going through that is clicking a page that has not yet become the shape the agent
 * just looked at.
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

/** The result of aiming, occlusion already checked. */
interface AimPoint {
  x: number
  y: number
  role: string
  name: string
}

/**
 * Work out the point to click, from a reference code or from coordinates.
 *
 * Given a reference code this **refuses when the element is covered**, naming what
 * is covering it. That is the biggest difference between a correct click and a click
 * that lands in a cookie banner while the command still reports success.
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
        `${ref} ("${spot.name ?? ''}") is covered by "${spot.coveredBy ?? '?'}", so a click would hit something else. `
        + 'Usually a cookie banner, a sticky bar, or a dialog scrim — close it first.',
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
  throw new Error('no target: needs "ref" (from the page read) or "coordinate"')
}

/**
 * Build the command table.
 * @param actions - the panel store's actions.
 * @param holder - the holder for the webview stage.
 * @returns the command table for the bridge.
 */
function buildCommands(actions: DockActions, holder: StageHolder): CommandTable {
  /**
   * The function that puts the screen back after a capture.
   *
   * A screenshot is the ONLY command that spans two calls — raise the tab in call
   * one, the shell captures in between, put it back in call two. So this state has
   * to outlive a single call. Two `shot_prepare` calls in a row clean up the earlier
   * one first, so a pinned tab can never be left stuck.
   */
  let restoreAfterShot: (() => void) | undefined

  return {
    ping: () => ({ at: Date.now() }),

    /** Every open tab. The foundation for `browser_tabs`. */
    tabs_list: () => ({ tabs: holder.require().list() }),

    /**
     * Prepare a capture: raise the tab, wait until it is being painted, then hand
     * back the id for the shell to capture.
     *
     * This command does NOT capture. The capture has to run in the shell — calling
     * it from inside the page hard-locks the whole window on a real https page. Its
     * job is to set up the right conditions and hand over the key.
     *
     * It does NOT return the restore function: the tab has to stay on top while the
     * shell captures, and putting the screen back is the `shot_done` command's job
     * afterwards.
     */
    shot_prepare: async (params) => {
      const id = pickPublicTab(holder, params)
      const stage = holder.require()
      restoreAfterShot?.()
      restoreAfterShot = await stage.revealForInput(id)
      if (!await stage.isDrawable(id)) {
        restoreAfterShot()
        restoreAfterShot = undefined
        throw new Error('this page is not being painted, so there is no frame to capture')
      }
      const wcId = stage.webContentsId(id)
      if (wcId === undefined) throw new Error('the tab has not finished attaching, so it cannot be captured yet')
      return { tab_id: id, wc_id: wcId }
    },

    /** Put the screen back exactly where it was before the capture. */
    shot_done: () => {
      restoreAfterShot?.()
      restoreAfterShot = undefined
      return { ok: true }
    },

    /**
     * Run code inside the guest page.
     *
     * This path is the foundation of every read — reading the page, getting its
     * text, finding an element, measuring where to click. Check 15d measured it
     * arriving on a real https page.
     */
    page_eval: async (params) => {
      const code = (params as { code?: unknown } | null)?.code
      if (typeof code !== 'string' || code === '') throw new Error('missing parameter code')
      const id = pickPublicTab(holder, params)
      return { tab_id: id, value: await holder.require().evaluate(id, code) }
    },

    /**
     * Open a browser tab at the given address.
     *
     * Returns `tab_id` and does NOT promise "the page has loaded". `openPane` only
     * pushes a pane into the store; the webview tag is created by `BrowserPane` on a
     * later render, and the page loads after that. Overpromising here would mean the
     * first tool built on this bridge reports success for an address returning 404.
     * A "wait for load" command belongs to a later stage, together with the link to
     * the webview stage.
     *
     * The address gate is NOT here but in the Node half: a gate the blocked party
     * can set for itself is not a gate.
     */
    open_tab: (params) => {
      const url = (params as { url?: unknown } | null)?.url
      if (typeof url !== 'string' || url === '') throw new Error('missing parameter url')
      // Mark this as an AGENT tab. The label follows the tab for its whole life, and
      // it is what decides whether the redirect gate pulls the tab back when the page
      // jumps to a private address on its own.
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

    // ------------------------------------------------------------- navigation

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
        if (typeof url !== 'string' || url === '') throw new Error('missing parameter url')
        stage.navigate(id, url)
      }

      // Wait for the load before answering. This is the difference from `open_tab`,
      // which deliberately promises NOTHING about the page having loaded; this one
      // does, because the agent reads the page immediately after calling it.
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

    // ------------------------------------------------------------- reading it

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
      if (typeof query !== 'string' || query === '') throw new Error('missing parameter query')
      const id = pickPublicTab(holder, params)
      const matches = await callInPage(
        holder.require(), id,
        `window.__hdw.find(${JSON.stringify(query)})`,
      ) as unknown[]
      // An empty list almost always means the page was never read, not that nothing
      // matched. Say so, or the agent goes looking in the wrong direction.
      return { tab_id: id, matches, hint: matches.length === 0 ? 'the page was never read, or nothing matched' : '' }
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

    // ---------------------------------------------------------------- acting

    computer: async (params) => {
      const p = (params ?? {}) as Record<string, unknown>
      const action = String(p['action'] ?? '')
      const id = pickPublicTab(holder, params)
      const stage = holder.require()

      if (action === 'wait') {
        await wait(clampNumber(p['duration'], 1000, 50, 10_000))
        return { tab_id: id, action, ok: true }
      }

      // A page that is not being painted ACCEPTS the click and STILL reports done,
      // while doing nothing at all. Raise the tab, do the work, then put the screen
      // back exactly where it was — the user does not get their tab yanked away.
      const restore = await stage.revealForInput(id)
      try {
        if (!await stage.isDrawable(id)) {
          throw new Error(
            'this page is not being painted, so it accepts the action without reacting. '
            + 'Open the panel, switch to that tab, and try again.',
          )
        }

        const modifiers = Array.isArray(p['modifiers'])
          ? (p['modifiers']).map((m) => MODIFIERS[String(m).toLowerCase()] ?? '').filter(Boolean)
          : []

        if (action === 'type') {
          const value = p['text']
          if (typeof value !== 'string') throw new Error('missing parameter text')
          if (typeof p['ref'] === 'string') {
            await callInPage(stage, id, `window.__hdw.focus(${JSON.stringify(p['ref'])})`)
          }
          // `insertText` rather than key-by-key: far faster, and it does not produce
          // the wrong key sequence on a non-English keyboard. Special keys (Enter,
          // Tab) go down the `key` path.
          await stage.insertText(id, value)
          await wait(120)
          return { tab_id: id, action, typed: value.length }
        }

        if (action === 'key') {
          const combo = p['text']
          if (typeof combo !== 'string' || combo === '') throw new Error('missing parameter text (the key chord)')
          const repeat = clampNumber(p['repeat'], 1, 1, 50)
          const parsed = parseKey(combo)
          for (let i = 0; i < repeat; i += 1) {
            // Modifiers have to be REALLY PRESSED around the main key, not just
            // flagged: a page listening for events on the Ctrl key itself would see
            // nothing from a flag alone.
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
          if (from === undefined) throw new Error('no starting point: start_ref or start_coordinate')
          const to = await aim(stage, id, p)
          stage.sendInput(id, { type: 'mouseMove', x: from.x, y: from.y })
          await wait(60)
          stage.sendInput(id, { type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 })
          await wait(60)
          // Drag in several steps rather than one jump: every drag-and-drop UI
          // listens for `mousemove`, and a single jump is usually ignored.
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

        throw new Error(`there is no action "${action}"`)
      } finally {
        restore()
      }
    },

    form_input: async (params) => {
      const p = (params ?? {}) as Record<string, unknown>
      const ref = p['ref']
      if (typeof ref !== 'string' || ref === '') throw new Error('missing parameter ref')
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
      return { tab_id: id, viewport: size ?? 'follows the panel' }
    },
  }
}

/**
 * Connect to the bridge and keep that connection alive.
 * @param actions - the panel store's actions, so commands can affect tabs.
 * @param holder - the webview stage holder, the only path to a web page.
 * @returns a function that closes the bridge, called when the plugin unloads.
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

    // The hello frame carries the switch state the user had saved. The Node half
    // starts knowing nothing about it — it only exists where the user clicks.
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
        ws.send(JSON.stringify({ t: 'error', id, reason: `there is no command "${String(frame.cmd)}"` }))
        return
      }
      // `Promise.resolve` wraps this so synchronous and asynchronous commands travel
      // the same path — and so a command that throws synchronously becomes an `error`
      // rather than tearing down the whole bridge.
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
      // The server closing with the private code means "do not reconnect" (the
      // plugin unloaded, or the protocol versions differ). Reconnecting to a bridge
      // that has been taken down is exactly what breeds a connection storm.
      if (event.code === CLOSE_FINAL) { stopped = true; return }
      // Only count it healthy once the connection lived long enough. Resetting the
      // step at open time turns "the server accepts then closes immediately because
      // it is over the ceiling" into a tight loop.
      if (Date.now() - openedAt > HEALTHY_AFTER_MS) step = 0
      scheduleReconnect()
    }

    // Nothing happens in `onerror`: every failure path ends in `onclose`, and
    // reconnecting in both places means reconnecting twice.
    ws.onerror = () => {}
  }

  /** Exponential backoff, with full jitter. */
  const scheduleReconnect = (): void => {
    if (stopped || retryTimer !== undefined) return
    step += 1
    // Jitter is not decoration: without it two app windows that lost the network
    // together would reconnect in lockstep forever.
    const wait = Math.random() * Math.min(MAX_BACKOFF_MS, 500 * 2 ** step)
    retryTimer = setTimeout(() => { retryTimer = undefined; connect() }, wait)
  }

  connect()

  // When the user flips the switch, report it AT ONCE rather than waiting for a
  // reconnect: turning a permission off means wanting it off now, not after the next
  // page load.
  //
  // Skipped while the bridge is not connected — the next hello frame carries the new
  // value anyway.
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
