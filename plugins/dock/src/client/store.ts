/**
 * The panel's state: open/closed, its width, and the list of open panes.
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
 * ## One strip of panes, not three fixed tabs
 *
 * Files, each terminal and each web page are all peer `Pane`s in one list — the same
 * shape as the reference app. The gain is not only cosmetic: **there is one list and one
 * owner**. An earlier version had one fixed `tab` plus (eventually) a separate list of
 * web tabs, meaning two descriptions of "what is being viewed", and two descriptions
 * eventually disagree — which is exactly the bug the reference project had to untangle
 * and recorded in their own `browserStore.ts`.
 * @module
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { isPublicUrl } from '../net-policy.ts'
import type { TabOwner } from './browser-stage.ts'

/** A pane's kind. */
export type PaneKind = 'files' | 'terminal' | 'browser'

/** The narrowest width at which the directory tree is still readable. */
export const MIN_WIDTH = 220

/** The widest width, so the panel does not swallow the conversation. */
export const MAX_WIDTH = 720

/** One pane in the strip. */
export interface Pane {
  /** A durable identifier, used as the React key and as the tab name the agent addresses. */
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
}

/** The panel's state, one shape shared by the panel and its on/off button. */
export interface DockState {
  open: boolean
  width: number
  panes: Pane[]
  /** The pane currently showing. `undefined` when the strip is empty. */
  activeId: string | undefined
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
}

/** The panel's writers. Components may only change state through these. */
export interface DockActions {
  toggle: () => void
  close: () => void
  setWidth: (px: number) => void
  /**
   * Open a new pane and switch to it.
   *
   * Files is **unique**: calling again only switches to the existing one. Two directory
   * trees of the same workspace cannot say anything different from each other, while
   * they do make the tab strip needlessly longer.
   * @returns the id of the pane showing after the call.
   */
  openPane: (kind: PaneKind, url?: string, openedBy?: TabOwner) => string
  closePane: (id: string) => void
  setActive: (id: string) => void
  /** Turn the agent's permission to act on the page on or off. */
  setAgentControl: (allowed: boolean) => void
  /** Update the pill's text and the address, when a page retitles itself or navigates. */
  describePane: (id: string, patch: { title?: string | undefined, url?: string | undefined }) => void
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
 * Build the panel's state store.
 *
 * Called inside `apply` rather than at module level: a module-level store is a singleton
 * in disguise; it survives plugin reloads and carries old state into the new build.
 * @returns the store and the writers bound to it.
 */
export function createDock(): Dock {
  const first: Pane = { id: newId('files'), kind: 'files', title: LABELS.files }
  const store = createSnapshotStore<DockState>(
    { open: false, width: 320, panes: [first], activeId: first.id, agentControl: true },
    { persist: { name: 'hdw.dock' } },
  )

  // State read back from a previous run may come from an older plugin build (the
  // `hdw.dock` key does not change between builds). Clean it once at construction, so the
  // rest of the code does not have to defend itself at every read.
  store.update((d) => {
    if (!Array.isArray(d.panes) || d.panes.length === 0) {
      const files: Pane = { id: newId('files'), kind: 'files', title: LABELS.files }
      d.panes = [files]
    }
    if (!d.panes.some((p) => p.id === d.activeId)) d.activeId = d.panes[0]?.id
    if (typeof d.agentControl !== 'boolean') d.agentControl = true

    // An address the AGENT opened must not come back to life after the app closes.
    //
    // The panel store has `persist`, so an address the agent opened today would reopen
    // itself on the next run — and on that pass it would go through NO check at all,
    // because the check only runs when the agent calls the open command. Re-checking at
    // read time is the only place this can be closed.
    //
    // A tab the user opened is left alone: typing a router's or a NAS's address by hand is
    // legitimate, and it should survive launches like any other tab.
    for (const pane of d.panes) {
      if (pane.openedBy !== 'agent') continue
      if (pane.url !== undefined && !isPublicUrl(pane.url)) {
        delete pane.url
        pane.title = 'Blocked: internal address'
      }
    }
  })

  return {
    store,
    actions: {
      toggle: () => { store.update((d) => { d.open = !d.open }) },
      close: () => { store.update((d) => { d.open = false }) },
      setWidth: (px) => {
        store.update((d) => { d.width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(px))) })
      },

      openPane: (kind, url, openedBy = 'user') => {
        let result = ''
        store.update((d) => {
          if (kind === 'files') {
            const existing = d.panes.find((p) => p.kind === 'files')
            if (existing !== undefined) {
              d.activeId = existing.id
              result = existing.id
              return
            }
          }
          const pane: Pane = url === undefined
            ? { id: newId(kind), kind, title: LABELS[kind], openedBy }
            : { id: newId(kind), kind, title: LABELS[kind], url, openedBy }
          d.panes.push(pane)
          d.activeId = pane.id
          d.open = true
          result = pane.id
        })
        return result
      },

      closePane: (id) => {
        store.update((d) => {
          const index = d.panes.findIndex((p) => p.id === id)
          if (index === -1) return
          d.panes.splice(index, 1)
          if (d.activeId === id) d.activeId = nextAfterClose(d.panes, index)
        })
      },

      setActive: (id) => {
        store.update((d) => {
          if (d.panes.some((p) => p.id === id)) d.activeId = id
        })
      },

      setAgentControl: (allowed) => {
        store.update((d) => { d.agentControl = allowed })
      },

      describePane: (id, patch) => {
        store.update((d) => {
          const pane = d.panes.find((p) => p.id === id)
          if (pane === undefined) return
          if (patch.title !== undefined) pane.title = patch.title
          if (patch.url !== undefined) pane.url = patch.url
        })
      },
    },
  }
}
