/**
 * The panel's state: how wide it is, and — **per chat** — whether it is open and which
 * panes it holds.
 *
 * Built with `createSnapshotStore` rather than `defineStore`, and the reason lies in
 * WHERE the button sits. The panel lives in the whole window's overlay layer (`root`
 * scope), while the on/off button lives in EACH SESSION's header (`session` scope).
 * `defineStore` hands each scope its own copy — one declaration, two instances — so the
 * button in a session would toggle a copy the panel never sees: clicking does nothing,
 * and no error is reported.
 *
 * A store built at plugin level exists exactly once, and both sides receive that very
 * store through `inject`. This is upstream's own mechanism, not a workaround: their
 * agent-preset plugin passes a `SnapshotStore` to slots in precisely this way.
 *
 * `persist` is still upstream's job: read back from localStorage at construction,
 * written on every change, and if localStorage is broken it disables persistence rather
 * than breaking the store.
 *
 * ## One strip of panes per chat, not one for the whole app
 *
 * An earlier version kept ONE list of panes for the entire window. That followed from
 * the paragraph above — the store has to exist once — but it was never a decision anyone
 * made, and what the user saw was plainly wrong: a web page opened while working in one
 * chat showed up in every other chat, in every workspace. Worse, the Files and Terminal
 * panes took their folder from whichever chat was on screen, so switching to a chat in
 * another workspace tore down the terminal's socket and **killed the running shell**.
 *
 * So the store exists once, and inside it the panes are **keyed by chat**. One owner,
 * one instance, and each chat still gets its own strip.
 *
 * `width`, `agentControl` and `sleepAfterMinutes` deliberately stay app-wide: they are
 * preferences, not work in progress. Nobody wants to set the panel's width again in
 * every chat.
 * @module
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { isPublicUrl } from '../net-policy.ts'
import type { TabOwner } from './browser-stage.ts'

/** A pane's kind. */
export type PaneKind = 'files' | 'terminal' | 'browser'

/** The narrowest width at which the directory tree is still readable. */
export const MIN_WIDTH = 220

/**
 * The slice of conversation the panel must always leave beside itself.
 *
 * There is no fixed maximum width: the panel may be dragged as wide as the user likes,
 * up to the point where the chat column would shrink below this — the same way Claude's
 * side panel keeps a readable chat rather than capping the panel at one hard number. The
 * ceiling therefore follows the window: a wider window allows a wider panel.
 */
export const MIN_CONVERSATION_WIDTH = 480

/** How long a background web page may sit idle before it is put to sleep. `0` means never. */
export const SLEEP_CHOICES = [0, 15, 30, 60, 120] as const

/** The default idle time before a background web page sleeps. */
export const DEFAULT_SLEEP_MINUTES = 30

/** One pane in the strip. */
export interface Pane {
  /**
   * A durable identifier, used as the React key and as the tab name the agent addresses.
   *
   * Unique across the WHOLE window, not merely within one chat. That is what lets the
   * webview stage keep one flat table of pages, and it lets `describePane` and the sleep
   * bookkeeping find a pane without being told which chat it is in.
   */
  id: string
  kind: PaneKind
  /**
   * The text on the pill. Files is a constant; a terminal takes the shell's name; a web
   * page takes the page title — **set by the page itself**, so it is only ever
   * displayed and never used to decide anything.
   */
  title: string
  /** Only for `kind: 'browser'` — the address currently open. */
  url?: string
  /**
   * Who opened this tab. Absent means the user — every tab from an earlier version is a
   * user tab, and that is also the safe direction to guess: it only RELAXES things for a
   * genuine user tab, never for an agent's tab.
   */
  openedBy?: TabOwner
  /**
   * A web page put to sleep: its pill stays in the strip, its `<webview>` is gone.
   *
   * Sleeping is only ever a memory measure. Everything needed to bring the page back is
   * in `url`, and the signed-in state lives in the on-disk partition the pages share, so
   * a woken page is still signed in. What is genuinely lost is the scroll position and
   * anything typed into the page — which is why `hibernate.ts` refuses to sleep a page
   * holding either.
   */
  asleep?: boolean
  /**
   * When this pane was last on screen, in epoch ms. The clock the sleep timer reads.
   *
   * Only browser panes carry it. A terminal is never slept — killing a shell to save
   * memory would destroy whatever it is running, which is the very thing this panel
   * exists to keep safe.
   */
  lastSeen?: number
}

/** One chat's own strip of panes. */
export interface ChatDock {
  open: boolean
  panes: Pane[]
  /** The pane currently showing in this chat. `undefined` when the strip is empty. */
  activeId: string | undefined
}

/** The panel's state, one shape shared by the panel and its on/off button. */
export interface DockState {
  width: number
  /**
   * Let the agent click, type, scroll and fill forms in the panel's browser.
   *
   * On by default. Turned off, the agent can still **read** the page: blindfolding it
   * does not stop it acting, it only makes it act blind.
   *
   * This store is only where the choice is KEPT and where the user clicks. The source of
   * truth at enforcement time lives in the Node half — a gate the blocked party can lift
   * for itself is not a gate.
   */
  agentControl: boolean
  /** Idle minutes before a background web page sleeps. `0` means never. */
  sleepAfterMinutes: number
  /** Each chat's own strip, keyed by session id. */
  byChat: Record<string, ChatDock>
  /**
   * The chat on screen right now, written by the panel as the user navigates.
   *
   * It lives here so the Node half can reach it: a command arriving over the bridge with
   * no session of its own (the diagnostic HTTP routes) has to act on SOMETHING, and the
   * chat the user is looking at is the only defensible answer.
   */
  visibleChat: string | undefined
}

/** The panel's writers. Components may only change state through these. */
export interface DockActions {
  toggle: (chatId: string) => void
  close: (chatId: string) => void
  setWidth: (px: number) => void
  /**
   * Open a new pane in one chat and switch to it.
   *
   * Files is **unique per chat**: calling again only switches to that chat's existing
   * one. Two directory trees of the same workspace cannot say anything different from
   * each other, while they do make the tab strip needlessly longer.
   * @returns the id of the pane showing after the call.
   */
  openPane: (chatId: string, kind: PaneKind, url?: string, openedBy?: TabOwner) => string
  closePane: (chatId: string, id: string) => void
  setActive: (chatId: string, id: string) => void
  /** Turn the agent's permission to act on the page on or off. */
  setAgentControl: (allowed: boolean) => void
  /** Set the idle time before a background web page sleeps; `0` means never. */
  setSleepAfterMinutes: (minutes: number) => void
  /** Record which chat is on screen, so the Node half can fall back to it. */
  setVisibleChat: (chatId: string | undefined) => void
  /** Update the pill's text and the address, when a page retitles itself or navigates. */
  describePane: (id: string, patch: { title?: string | undefined, url?: string | undefined }) => void
  /** Mark a pane as having been on screen just now. */
  touchPane: (id: string) => void
  /** Put a web page to sleep, or bring it back. */
  setPaneAsleep: (id: string, asleep: boolean) => void
  /**
   * Drop every chat that no longer exists.
   *
   * Called with the live session list. A deleted chat has to take its panes with it —
   * otherwise its terminals keep running and its pages keep occupying memory with
   * nothing left on screen that could ever close them.
   */
  forgetChatsExcept: (liveIds: readonly string[]) => void
}

/** The store plus its writers, built once inside `apply` and shared with the slots. */
export interface Dock {
  store: SnapshotStore<DockState>
  actions: DockActions
}

/** Each kind's default pill text. */
const LABELS: Record<PaneKind, string> = {
  files: 'Files',
  terminal: 'Terminal',
  browser: 'New page',
}

/** A short id, unique within one run. */
let counter = 0
function newId(kind: PaneKind): string {
  counter += 1
  return `${kind}-${String(counter)}-${Date.now().toString(36)}`
}

/** A chat's starting strip: the directory tree, and the panel closed. */
function freshChat(): ChatDock {
  const files: Pane = { id: newId('files'), kind: 'files', title: LABELS.files }
  return { open: false, panes: [files], activeId: files.id }
}

/**
 * Find a chat's strip, creating it on first use.
 *
 * Every writer goes through this, so a chat opened for the first time needs no special
 * case anywhere else.
 */
function chatOf(state: DockState, chatId: string): ChatDock {
  const existing = state.byChat[chatId]
  if (existing !== undefined) return existing
  const made = freshChat()
  state.byChat[chatId] = made
  return made
}

/**
 * Run `visit` on the pane with this id, wherever it lives.
 *
 * Pane ids are unique across the window, so the caller does not have to know the chat —
 * which matters because titles, addresses and sleep all arrive from places that only
 * ever knew the pane.
 */
function withPane(state: DockState, id: string, visit: (pane: Pane) => void): void {
  for (const chat of Object.values(state.byChat)) {
    const pane = chat.panes.find((p) => p.id === id)
    if (pane !== undefined) { visit(pane); return }
  }
}

/**
 * Pick the next pane after closing the one being viewed.
 *
 * Take the one to the right, or failing that the one to the left — the habit every
 * browser has. Returns `undefined` when the last one was just closed.
 */
function nextAfterClose(panes: readonly Pane[], index: number): string | undefined {
  return panes[index]?.id ?? panes[index - 1]?.id
}

/**
 * Repair state read back from a previous run.
 *
 * It may come from an older plugin build — the `hdw.dock` key does not change between
 * builds — so it is cleaned once at construction and the rest of the code can then read
 * it without defending itself at every turn.
 */
function sanitize(state: DockState): void {
  // The pre-per-chat shape kept `panes` / `activeId` / `open` at the top level. There is
  // no way to work out which chat those panes belonged to, because at the time they
  // belonged to all of them at once. They are dropped, and only the genuine preferences
  // (width, agent control) carry over. It costs the user the tabs open at the moment they
  // upgrade, once.
  const legacy = state as unknown as Record<string, unknown>
  delete legacy['panes']
  delete legacy['activeId']
  delete legacy['open']

  if (typeof state.byChat !== 'object' || state.byChat === null) state.byChat = {}
  if (typeof state.agentControl !== 'boolean') state.agentControl = true
  if (!SLEEP_CHOICES.includes(state.sleepAfterMinutes as typeof SLEEP_CHOICES[number])) {
    state.sleepAfterMinutes = DEFAULT_SLEEP_MINUTES
  }
  // Which chat was on screen last time says nothing about this run, and leaving a stale
  // id here would point the Node half's fallback at a chat nobody is looking at.
  state.visibleChat = undefined

  for (const [chatId, chat] of Object.entries(state.byChat)) {
    if (typeof chat !== 'object' || !Array.isArray(chat.panes) || chat.panes.length === 0) {
      state.byChat[chatId] = freshChat()
      continue
    }
    if (typeof chat.open !== 'boolean') chat.open = false
    if (!chat.panes.some((p) => p.id === chat.activeId)) chat.activeId = chat.panes[0]?.id

    for (const pane of chat.panes) {
      // No `<webview>` survives the app closing, so nothing is asleep at startup — every
      // page is simply not built yet, and the first time it is shown it loads from `url`
      // like any other. Leaving the flag set would dim a pill that is perfectly awake.
      delete pane.asleep

      // `lastSeen` is deliberately KEPT across runs rather than reset to now.
      //
      // It means "when did you last look at this page", and that question does not start
      // over because the app was restarted — a page last opened three days ago has not
      // been looked at recently, however many times the app has been launched since.
      // Resetting it would mean a page the user never visits stays awake forever as long
      // as they restart often enough, which is the exact opposite of what the sleep timer
      // is for.
      //
      // The visible consequence is mild and self-correcting: pages restored from an old
      // run are built at startup and then closed again by the first sweep, within a
      // minute, leaving their pills in place.
      if (typeof pane.lastSeen !== 'number') pane.lastSeen = Date.now()

      // An address the AGENT opened must not come back to life after the app closes.
      //
      // The panel store has `persist`, so an address the agent opened today would reopen
      // itself on the next run — and on that pass it would go through NO check at all,
      // because the check only runs when the agent calls the open command. Re-checking at
      // read time is the only place this can be closed.
      //
      // A tab the user opened is left alone: typing a router's or a NAS's address by hand is
      // legitimate, and it should survive launches like any other tab.
      if (pane.openedBy !== 'agent') continue
      if (pane.url !== undefined && !isPublicUrl(pane.url)) {
        delete pane.url
        pane.title = 'Blocked: internal address'
      }
    }
  }
}

/**
 * Build the panel's state store.
 *
 * Called inside `apply` rather than at module level: a module-level store is a singleton
 * in disguise; it survives plugin reloads and carries old state into the new build.
 * @returns the store and the writers bound to it.
 */
export function createDock(): Dock {
  const store = createSnapshotStore<DockState>(
    {
      width: 320,
      agentControl: true,
      sleepAfterMinutes: DEFAULT_SLEEP_MINUTES,
      byChat: {},
      visibleChat: undefined,
    },
    { persist: { name: 'hdw.dock' } },
  )

  store.update(sanitize)

  return {
    store,
    actions: {
      toggle: (chatId) => { store.update((d) => { const c = chatOf(d, chatId); c.open = !c.open }) },
      close: (chatId) => { store.update((d) => { chatOf(d, chatId).open = false }) },
      setWidth: (px) => {
        store.update((d) => {
          // The ceiling follows the window: as wide as the user drags, so long as
          // MIN_CONVERSATION_WIDTH of chat is left. On a very narrow window that cap could
          // fall below MIN_WIDTH, so the panel's own floor still wins.
          const cap = Math.max(MIN_WIDTH, window.innerWidth - MIN_CONVERSATION_WIDTH)
          d.width = Math.min(cap, Math.max(MIN_WIDTH, Math.round(px)))
        })
      },

      openPane: (chatId, kind, url, openedBy = 'user') => {
        let result = ''
        store.update((d) => {
          const chat = chatOf(d, chatId)
          if (kind === 'files') {
            const existing = chat.panes.find((p) => p.kind === 'files')
            if (existing !== undefined) {
              chat.activeId = existing.id
              result = existing.id
              return
            }
          }
          const pane: Pane = url === undefined
            ? { id: newId(kind), kind, title: LABELS[kind], openedBy, lastSeen: Date.now() }
            : { id: newId(kind), kind, title: LABELS[kind], url, openedBy, lastSeen: Date.now() }
          chat.panes.push(pane)
          chat.activeId = pane.id
          chat.open = true
          result = pane.id
        })
        return result
      },

      closePane: (chatId, id) => {
        store.update((d) => {
          const chat = chatOf(d, chatId)
          const index = chat.panes.findIndex((p) => p.id === id)
          if (index === -1) return
          chat.panes.splice(index, 1)
          if (chat.activeId === id) chat.activeId = nextAfterClose(chat.panes, index)
        })
      },

      setActive: (chatId, id) => {
        store.update((d) => {
          const chat = chatOf(d, chatId)
          if (!chat.panes.some((p) => p.id === id)) return
          chat.activeId = id
          // Reset the idle clock. Waking a sleeping page is deliberately NOT done here:
          // the panel wakes whatever becomes visible, which also covers the paths that do
          // not go through this writer — reopening a closed panel over a pane that fell
          // asleep while it was hidden.
          withPane(d, id, (pane) => { pane.lastSeen = Date.now() })
        })
      },

      setAgentControl: (allowed) => {
        store.update((d) => { d.agentControl = allowed })
      },

      setSleepAfterMinutes: (minutes) => {
        store.update((d) => { d.sleepAfterMinutes = minutes })
      },

      setVisibleChat: (chatId) => {
        store.update((d) => { d.visibleChat = chatId })
      },

      describePane: (id, patch) => {
        store.update((d) => {
          withPane(d, id, (pane) => {
            if (patch.title !== undefined) pane.title = patch.title
            if (patch.url !== undefined) pane.url = patch.url
          })
        })
      },

      touchPane: (id) => {
        store.update((d) => { withPane(d, id, (pane) => { pane.lastSeen = Date.now() }) })
      },

      setPaneAsleep: (id, asleep) => {
        store.update((d) => {
          withPane(d, id, (pane) => {
            if (asleep) pane.asleep = true
            else { delete pane.asleep; pane.lastSeen = Date.now() }
          })
        })
      },

      forgetChatsExcept: (liveIds) => {
        store.update((d) => {
          const live = new Set(liveIds)
          for (const chatId of Object.keys(d.byChat)) {
            if (!live.has(chatId)) delete d.byChat[chatId]
          }
        })
      },
    },
  }
}
