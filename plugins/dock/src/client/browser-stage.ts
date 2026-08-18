/**
 * The stage holding the `<webview>` tags — living **outside** the React tree, on purpose.
 *
 * Three facts force that:
 *
 * 1. Detaching a `<webview>` from the DOM and reattaching it **reloads the page from
 *    scratch**: scroll position gone, form content gone, JS state gone, and any unsaved
 *    login gone with them.
 * 2. React reconciliation is an expert at detach-and-reattach. A change in an ancestor,
 *    a list reorder, a different `key` — each of them can do it, and nothing reports it.
 * 3. `partition` (the cookie jar) can only be set **before** the first navigation.
 *    Rebuilding the tag forfeits that chance for good.
 *
 * So React draws only the frame — the pill strip, the address bar — and leaves an empty
 * slot. On every layout change it measures that slot and reports the coordinates across;
 * the stage follows. Exactly how the reference app sets `bounds` on its
 * `WebContentsView`.
 *
 * ## Why a background tab is COVERED rather than hidden
 *
 * `scripts/spike-webview.cjs` measured it: `capturePage()` **hangs forever** when a
 * webview is `visibility: hidden` or pushed outside the viewport — no error, no timeout,
 * the Promise simply never settles. The only way of hiding one that still captures is
 * **being completely covered by another layer**. So every tab stacks in one place with
 * the viewed one on top; a background tab is covered by that one, and stays capturable.
 *
 * The original plan said `visibility: hidden`. Had it been followed, an agent screenshot
 * aimed at a background tab would have hard-locked the whole conversation turn.
 * @module
 */

import { isPublicUrl, withScheme } from '../net-policy.ts'

/**
 * The part of the `<webview>` tag's API the panel actually uses.
 *
 * Declared by hand rather than pulling `@types/electron` into the plugin: the plugin
 * does not depend on Electron, and it runs inside the page rather than the main process.
 * This short list doubles as a complete statement of what we really touch.
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
   * The guest page's process id.
   *
   * This number is the only bridge between the client half and the Electron shell: the
   * screenshot command runs in the shell, and the shell identifies the page to capture by
   * this id.
   */
  getWebContentsId: () => number
  /**
   * Send real mouse and key events into the guest page.
   *
   * Measured (check 15e): this path arrives. And check 15a measured something more
   * important — it arrives **even when the app window is not in front**, contrary to a
   * note in Electron's documentation. That is what lets the agent work while the user is
   * busy in another app.
   */
  sendInputEvent: (event: InputEvent) => void
  /** Type text into whatever holds the caret. Faster and more correct than key by key. */
  insertText: (text: string) => Promise<void>
  setUserAgent: (ua: string) => void
  setZoomFactor: (factor: number) => void
  /**
   * Whether the page is making a sound RIGHT NOW.
   *
   * The sleep timer's first exemption. A page playing music or a video is being used even
   * though nobody has touched it for half an hour, and closing it mid-sentence is the
   * rudest thing this feature could do.
   */
  isCurrentlyAudible: () => boolean
  /**
   * DO NOT CALL. On a real https page, calling this from inside the host page
   * **hard-locks the host page's entire event loop** — even a wrapping `setTimeout` never
   * fires, so there is no way to rescue it. Declared so a reader knows it exists and knows
   * why it is not used. The only healthy screenshot path is from the main process.
   */
  capturePage: () => Promise<{ toDataURL: () => string }>
}

/** One mouse or key event sent into the guest page. */
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

/** What the panel needs to know about a tab to draw the address bar and the pill. */
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
   * How many history entries have been visited, and the current position.
   *
   * Counted by hand rather than asking `canGoBack()`: that function is deprecated on
   * `webContents`, and its replacement (`navigationHistory`) is not exposed on a
   * `<webview>` tag. Counting navigation events is the thing that definitely exists.
   */
  historyLength: number
  historyIndex: number
  /** Who opened this tab. It decides whether the address gate applies to it. */
  owner: TabOwner
  /** The console ring buffer, trimmed at `MAX_CONSOLE_LINES`. */
  consoleLines: ConsoleLine[]
}

/**
 * How many console lines are kept per tab.
 *
 * Enough to trace an error that just happened, and small enough that a page spamming
 * `console.log` in a loop cannot eat the window's memory.
 */
const MAX_CONSOLE_LINES = 200

/** The four `console-message` levels, in the order Chromium numbers them. */
const CONSOLE_LEVELS: readonly ConsoleLine['level'][] = ['debug', 'info', 'warn', 'error']

/** The slot the stage has to follow, in viewport coordinates. */
export interface StageRect {
  x: number
  y: number
  width: number
  height: number
}

export interface Stage {
  /** Create the tab if it does not exist yet. */
  ensure: (id: string, url?: string, owner?: TabOwner) => void
  remove: (id: string) => void
  /**
   * Which tab sits on top. `undefined` means none (an empty strip).
   * @param giveKeyboard - true when the user themselves just picked this tab, so the
   * keyboard goes to the page as well. Defaults to false: grabbing the keyboard while the
   * app rebuilds the panel by itself steals it from the conversation input.
   */
  setActive: (id: string | undefined, giveKeyboard?: boolean) => void
  /** Set the stage's position; `undefined` hides it entirely. */
  setRect: (rect: StageRect | undefined) => void
  status: (id: string) => TabStatus | undefined
  navigate: (id: string, url: string) => void
  goBack: (id: string) => void
  goForward: (id: string) => void
  reload: (id: string) => void
  stop: (id: string) => void
  /** Hand the keyboard to this tab's page. */
  focus: (id: string) => void
  element: (id: string) => WebviewTag | undefined
  /** Whether this tab has a live page behind it. False for one that is asleep. */
  has: (id: string) => boolean
  /**
   * Whether the page is making a sound right now.
   *
   * `false` when the tab has no page, and `false` when the tag has not finished attaching
   * — asking too early throws, and "not audible yet" is the truthful answer at that
   * moment anyway.
   */
  isAudible: (id: string) => boolean
  destroy: () => void

  // --- The surface for the agent's tool layer ---

  /** Every existing tab, in the pill strip's own order. */
  list: () => TabInfo[]
  /** Whether this tab was opened by the agent or by the user. */
  openedBy: (id: string) => TabOwner | undefined
  /** Record the owner at tab creation. Defaults to the user. */
  claim: (id: string, owner: TabOwner) => void
  /**
   * Run code inside the guest page and get a value back.
   * @throws when that tab does not exist, or the code throws inside the page.
   */
  evaluate: (id: string, code: string) => Promise<unknown>
  /** Send one real mouse or key event into the page. */
  sendInput: (id: string, event: InputEvent) => void
  /** Type text into whatever holds the caret inside the page. */
  insertText: (id: string, text: string) => Promise<void>
  /**
   * Whether the page is BEING PAINTED.
   *
   * The most expensive lesson copied from the reference project: a tab that is not being
   * painted **still accepts a click and still answers "done"**, while doing nothing at
   * all. Without checking this, the agent reports success for actions that never happened.
   */
  isDrawable: (id: string) => Promise<boolean>
  /**
   * Briefly raise the tab so it gets painted, then return a restore function.
   *
   * Called at the start of every action command. The returned function puts everything
   * back where it was, so the agent can work in a background tab without the user's screen
   * jumping.
   */
  revealForInput: (id: string) => Promise<() => void>
  /** The page's few hundred most recent console lines. */
  consoleLog: (id: string) => readonly ConsoleLine[]
  /** The guest page's process id, so the shell knows which one to capture. */
  webContentsId: (id: string) => number | undefined
  /** Change the viewport size the page believes it has. */
  setViewport: (id: string, size: ViewportSize | undefined) => void
}

/** Who opened a tab — it decides whether the address gate applies to it. */
export type TabOwner = 'user' | 'agent'

/** One tab, trimmed for the tool layer. */
export interface TabInfo {
  id: string
  url: string
  title: string
  loading: boolean
  active: boolean
  openedBy: TabOwner
}

/** One console line from the guest page. */
export interface ConsoleLine {
  level: 'debug' | 'info' | 'warn' | 'error'
  text: string
  source: string
  line: number
  at: number
}

/**
 * An emulated viewport.
 *
 * The panel is far narrower than a desktop screen, so a real width of 1280px is
 * impossible. The approach: set the LAYOUT width to 1280 and scale the picture down to
 * fit the slot. The page believes it is at 1280px — media queries, breakpoints and layout
 * all follow that — while the user still sees the whole of it inside the panel.
 */
export interface ViewportSize {
  width: number
  height: number
}

/**
 * Add `https://` when the user leaves it out, and refuse anything that is not a URL.
 *
 * The scheme detection is shared with the address gate (`withScheme`), deliberately: two
 * entrances into the same browser that understand addresses differently eventually mean
 * the user can type something the agent cannot open, or the reverse. An earlier version
 * had one of each, and both wrongly refused `example.com:8080` — that colon is a port,
 * not a scheme.
 */
export function normalizeUrl(raw: string): string | undefined {
  const text = raw.trim()
  if (text === '') return undefined
  try {
    const url = new URL(withScheme(text))
    // http/https only. `javascript:` typed into an address bar is a classic way to fire a
    // script into the page you already have open.
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/**
 * Build the stage and attach it to `document.body`.
 * @param onChange - called whenever a tab's status changes, so React re-renders.
 * @returns the stage's controls.
 */
export function createStage(onChange: (id: string, status: TabStatus) => void): Stage {
  const root = document.createElement('div')
  root.className = 'hdw-stage'
  root.dataset['plugin'] = 'harness-desktop-dock'

  /**
   * Hide the stage by SINKING IT BENEATH the app UI — never by using `display: none`.
   *
   * This was paid for: a `<webview>` attached while its container is `display: none`
   * **never gets a display surface allocated**. Everything else still runs — navigation
   * events fire, the title reaches the pill, the page paints itself in memory (a CDP
   * capture from the guest comes back complete) — only the screen is blank. Because every
   * earlier "is the page painting" measurement measured the guest's memory, this bug walked
   * through all 13 checks and only surfaced in a real screen capture taken with
   * PrintWindow.
   *
   * Sunk with `z-index: -1` the element is still painted (it is merely covered by the
   * layers painted after it — the panel has an opaque background), so the guest's surface
   * stays alive. This is exactly what `spike-webview.cjs` check 6b measured from the
   * start: *"completely covered"* is the only way of hiding a webview that leaves it fully
   * functional.
   */
  const sink = (): void => {
    root.style.zIndex = '-1'
    root.style.pointerEvents = 'none'
  }
  /** Raise it back to its own layer (z-index 5, declared in the CSS). */
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
      // The viewed tab sits on top; a background tab is completely covered by it. This is
      // the ONLY way of hiding one that still captures — see the module comment.
      tab.el.style.zIndex = id === activeId ? '1' : '0'
    }
    handOffFocus(giveKeyboard)
  }

  /**
   * Hand over keyboard focus when the viewed tab changes.
   *
   * This has to be explicit: `z-index` only changes paint order, it does NOT move focus.
   * And here a background tab is not hidden, only covered — so without this step the user
   * clicks into the page on tab A, switches to another tab, types, and the keys go straight
   * into an invisible web page sitting underneath. Nothing reports it; the user only sees
   * "I type and nothing happens".
   *
   * The keyboard is only TAKEN when the USER THEMSELVES just picked the tab —
   * `giveKeyboard`. Taking it unconditionally means opening the app, the panel rebuilding a
   * web tab by itself, and the keyboard being stolen from the conversation input; that
   * trades one bug for a more irritating one.
   *
   * The intent has to be DECLARED, not inferred. An earlier version inferred it by checking
   * whether focus was currently inside the panel — plausible, and wrong on a common path:
   * calling `.click()` from code (and several keyboard selections) does not move focus at
   * all, so a genuine intent was read as "not the user".
   *
   * RELEASING it is unconditional: a covered page still holding the keyboard is always
   * wrong.
   * @param giveKeyboard - the user just picked this tab themselves.
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
    // `document.createElement('webview')` rather than JSX: this tag has to stay out of
    // React's reach, and it must never be rebuilt.
    const el = document.createElement('webview') as WebviewTag
    el.setAttribute('src', url ?? BLANK_PAGE)
    // `partition` is forced by the shell at `will-attach-webview` regardless of what is
    // written here; it is written out so a reader sees the intent, and so the tag stays
    // correct even if that guard changes.
    el.setAttribute('partition', 'persist:hdw-browser')
    // `allowpopups` is deliberately NOT declared. It is an HTML boolean attribute:
    // present means ON, even when its value is the string "false". An earlier version wrote
    // `allowpopups="false"` intending to disable popups, and it stated the exact opposite of
    // what it meant. No real consequence followed, because the shell deletes this attribute
    // at `will-attach-webview` and blocks again at `setWindowOpenHandler` — but leaving it
    // would leave a reading trap.
    //
    // `tabindex="-1"` is what makes `focus()` callable from code.
    //
    // Without it a `<webview>` tag is not a focusable element and `el.focus()` silently does
    // nothing — measured: after calling focus, the host page still reported
    // `activeElement=BODY` and the guest page still had `hasFocus=false`. Exactly the kind
    // of silent failure this project's rules exist to catch.
    //
    // `-1` rather than `0`: a web page should not push into the app UI's Tab cycle — a user
    // pressing Tab inside the panel means to move between the panel's buttons, not to fall
    // into the page.
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

      // An AGENT tab has just landed on a private address: pull it out immediately.
      //
      // The route here is not the agent's open command — that command was already blocked
      // by the address gate in the Node half. This is the detour: the agent supplies a
      // perfectly valid public address, and that page returns a redirect into the local
      // network. The check at open time already ran and already allowed it.
      //
      // Honest about the limit: reaching this point means EXACTLY ONE request already flew
      // to that private address. What is blocked is everything after it — the agent cannot
      // read the content, cannot act on it, and the tab does not come back to life on the
      // next launch. Blocking even the first request would require a separate cookie jar
      // for agent tabs, and the project owner chose to share one.
      //
      // The engine's own address cannot reach this point: the shell blocks it hard at the
      // request layer for EVERY tab (`window.ts`, guard 4).
      if (tab.owner === 'agent' && !isPublicUrl(address)) {
        el.stop()
        void el.loadURL(BLANK_PAGE)
        patchStatus({
          url: BLANK_PAGE,
          title: 'Blocked: redirect to a private address',
          loading: false,
        })
        return
      }

      // A new navigation truncates the "forward" branch ahead, exactly as a browser does.
      tab.historyIndex += 1
      tab.historyLength = tab.historyIndex + 1
      patchStatus({ url: address, canBack: tab.historyIndex > 0, canForward: false })
    })
    el.addEventListener('did-navigate-in-page', (event) => {
      const e = event as unknown as { url: string, isMainFrame: boolean }
      if (e.isMainFrame) patchStatus({ url: e.url })
    })
    // The page's console. Collected continuously rather than switched on when needed: the
    // error the agent wants to read has usually already happened BEFORE it thinks to look.
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
    // After navigating elsewhere, the old console no longer describes the page being
    // viewed. Keeping it would hand the agent evidence from a page that is gone.
    el.addEventListener('did-navigate', () => { tab.consoleLines.length = 0 })

    el.addEventListener('did-fail-load', (event) => {
      const e = event as unknown as { errorCode: number, isMainFrame: boolean }
      // -3 is ERR_ABORTED: the user pressed stop, or the page redirected itself mid-way.
      // That is not a failure, and reporting it would be a false alarm.
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

    has: (id) => tabs.has(id),

    isAudible: (id) => {
      const tab = tabs.get(id)
      if (tab === undefined) return false
      try {
        return tab.el.isCurrentlyAudible()
      } catch {
        // Thrown while the tag is still attaching. Nothing is playing out of a page that
        // has not loaded, so the honest answer here is the same as the safe one.
        return false
      }
    },

    setActive: (id, giveKeyboard = false) => {
      activeId = id
      restack(giveKeyboard)
    },

    setRect: (rect) => {
      if (rect === undefined) {
        // Keep the position and the size — only sink it. Resizing at this moment would
        // force every background page into a pointless re-layout.
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

    // --- The surface for the tool layer ---

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
      if (tab === undefined) throw new Error(`there is no tab "${id}"`)
      return tab.el.executeJavaScript(code)
    },

    sendInput: (id, event) => { tabs.get(id)?.el.sendInputEvent(event) },

    insertText: async (id, text) => {
      const tab = tabs.get(id)
      if (tab === undefined) throw new Error(`there is no tab "${id}"`)
      await tab.el.insertText(text)
    },

    isDrawable: async (id) => {
      const tab = tabs.get(id)
      if (tab === undefined) return false
      try {
        // Ask EXACTLY ONE question: does `requestAnimationFrame` run?
        //
        // An earlier version also asked `document.visibilityState` and refused outright
        // whenever it was not `visible`. That was a WRONG test, and this very suite measured
        // it: check 13 found a tab reporting `visibility=hidden` while still being given 167
        // frames per second. The consequence for the user: the agent opens a tab, the page
        // appears plainly in front of them, and every click and every screenshot is refused
        // with "this page is not being painted".
        //
        // A `requestAnimationFrame` loop answers the real question directly: Chromium stops
        // calling it when it stops painting the page. A painted page runs it within about a
        // sixtieth of a second; an unpainted page never runs it, and the timeout is itself
        // the answer "no".
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
      if (tab === undefined) throw new Error(`there is no tab "${id}"`)
      const prevActive = activeId
      const wasSunk = root.style.zIndex === '-1'

      if (activeId !== id) { activeId = id; restack() }
      // `raise()` restores the exact previous position and size, because `sink()`
      // deliberately changes only the layer and never touches the geometry — see `sink`'s
      // comment.
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
        // A tag that has not finished attaching has no id yet. That is a normal state
        // immediately after opening a tab, not a failure.
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
      // Set the LAYOUT width to exactly the number the agent asked for, then scale the
      // picture down to fit the slot. The page believes it is at that size — media queries,
      // breakpoints and responsive layout all follow this number — while the user still sees
      // the whole of it inside a narrow panel. A real resize is impossible: the panel is at
      // most 720px wide and cannot hold a 1280px desktop viewport.
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
 * Wait for the guest page to paint a few frames.
 *
 * The wait is on THE GUEST PAGE'S OWN FRAMES, not a `setTimeout` in the host page. The
 * difference matters: a sleep only says "this many milliseconds have passed", while what
 * needs to be known is "has the page managed to paint yet" — and those two come apart
 * exactly when the machine is busy, which is exactly when things break.
 * @param el - the guest page's tag.
 * @param count - how many frames to wait for.
 */
async function waitFrames(el: WebviewTag, count: number): Promise<void> {
  try {
    await Promise.race([
      el.executeJavaScript(`new Promise((res) => {
        let left = ${String(count)}
        const step = () => { left -= 1; if (left <= 0) res(1); else requestAnimationFrame(step) }
        requestAnimationFrame(step)
      })`),
      // On an unpainted page `requestAnimationFrame` never runs. Waiting forever here would
      // hang the agent's whole command; time out instead and let the `isDrawable` check state
      // that truth.
      new Promise((r) => { setTimeout(r, 1200) }),
    ])
  } catch {
    // The page closed mid-way. The caller finds out for itself on the real action.
  }
}
