/**
 * One browser tab: a navigation bar, an address bar, and **one empty slot**.
 *
 * The empty slot is where the web page will appear. The page itself is not in the React
 * tree — it lives on a stage outside `document.body` (see `browser-stage.ts`). This
 * component only measures the slot and reports the coordinates across.
 *
 * The approach is copied from the reference app, and one small detail of theirs is worth
 * copying too: after measuring, **compare with last time and stop if it matches**.
 * Dragging the panel's edge makes the measurement run every frame, while the work on the
 * other side is re-laying out a live web page — not cheap at all.
 * @module
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconRefreshOutline16,
  IconStopFill16,
  Input,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { normalizeUrl, type Stage, type TabOwner, type TabStatus } from './browser-stage.ts'

const EMPTY_STATUS: TabStatus = {
  url: '', title: '', loading: false, canBack: false, canForward: false,
}

export interface BrowserPaneProps {
  paneId: string
  stage: Stage
  /** Covered because another pane is showing. Not unmounted, only hidden. */
  isHidden: boolean
  /** A preset address, when the tab was created with a URL (opened by the agent, or read back from a previous run). */
  startUrl: string | undefined
  /**
   * The page has been put to sleep to save memory: its tag is closed, its pill remains.
   *
   * While true this component builds no page at all. When it goes back to false the page
   * is built again from the address the pane was last at.
   */
  asleep: boolean
  /** Who opened this tab — it decides whether the redirect gate applies to it. */
  openedBy: TabOwner
}

/**
 * One browser tab's body.
 * @param props - see {@link BrowserPaneProps}.
 * @returns the tab element.
 */
export function BrowserPane({ paneId, stage, isHidden, startUrl, asleep, openedBy }: BrowserPaneProps): React.JSX.Element {
  const slotRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<TabStatus>(() => stage.status(paneId) ?? initialStatus(startUrl))
  const [input, setInput] = useState(startUrl ?? '')
  const [typing, setTyping] = useState(false)

  // Create the webview once. It does not depend on `startUrl` so a later address change
  // does not rebuild the tag — rebuilding wipes the page's entire state.
  //
  // `asleep` is the one exception, and it is not really one: the sleep sweep has already
  // closed the tag, so this effect running again is the page being built back rather than
  // an existing page being thrown away. It reads `startUrl` at that moment, which is
  // where the pane had navigated to before it slept — not the address it first opened at.
  useEffect(() => {
    if (asleep) return
    stage.ensure(paneId, startUrl, openedBy)
    // `startUrl` is deliberately left out of the dependency list: it is only a starting
    // address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, paneId, openedBy, asleep])

  // Listen for tab status. The stage reports to the whole panel, so filter for our own tab.
  useEffect(() => {
    const readStatus = (): void => {
      const next = stage.status(paneId)
      if (next === undefined) return
      // Compare field by field before writing. `stage.status()` returns a NEW object on
      // every call, so writing it straight through would make the whole pane re-render four
      // times a second until the tab closes — even when nothing changed.
      setStatus((prev) => (
        prev.url === next.url && prev.title === next.title && prev.loading === next.loading
        && prev.canBack === next.canBack && prev.canForward === next.canForward
      ) ? prev : next)
    }
    readStatus()
    // The stage has no event emitter of its own; it calls the panel's `onChange`, which
    // the panel uses to update the store. When the store changes, this component
    // re-renders and re-reads the status here. A polling beat covers the changes that do
    // not travel through the store (whether back/forward are lit or dimmed).
    const timer = setInterval(readStatus, 250)
    return () => { clearInterval(timer) }
  }, [stage, paneId])

  // Follow the real address, EXCEPT while the user is typing — otherwise a page
  // redirecting itself mid-way would erase what they were half-way through entering.
  useEffect(() => {
    if (!typing && status.url !== '') setInput(status.url)
  }, [status.url, typing])

  /**
   * Measure the empty slot and report the coordinates to the stage.
   *
   * Coalescing into one frame and skipping when the rectangle has not changed are both
   * lessons copied from the reference app, not premature optimization.
   */
  const publishRect = useCallback((): void => {
    const el = slotRef.current
    if (el === null || isHidden) return
    const r = el.getBoundingClientRect()
    stage.setRect({
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    })
  }, [stage, isHidden])

  useEffect(() => {
    const el = slotRef.current
    if (el === null || isHidden) return undefined

    let last = ''
    const sync = (): void => {
      const r = el.getBoundingClientRect()
      const key = `${String(Math.round(r.left))},${String(Math.round(r.top))},${String(Math.round(r.width))},${String(Math.round(r.height))}`
      // Skip when the rectangle has not changed: the work on the other side is re-laying
      // out a live web page, which is not cheap.
      if (key === last) return
      last = key
      publishRect()
    }

    // Do NOT wrap this in `requestAnimationFrame`. An earlier version did, and the price
    // was a page that loaded but never appeared: the stage sat still at `display: none`
    // because the command to show it was waiting for a frame that never came. Chromium
    // stops producing frames for a window it believes nobody is watching, so sending an
    // INITIALIZATION command through `requestAnimationFrame` is sending a command that may
    // never run.
    //
    // And it is not needed: `ResizeObserver` already fires at most once per frame, and the
    // rectangle comparison above already blocks every redundant send.
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    window.addEventListener('resize', sync)
    // When the app window scrolls, the viewport coordinates change with it.
    window.addEventListener('scroll', sync, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [isHidden, publishRect])

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const url = normalizeUrl(input)
    if (url === undefined) return
    stage.navigate(paneId, url)
    setTyping(false)
    // Hand the keyboard back to the page. Without this line, the new page finishes
    // loading while focus is still in the address bar, and the first key the user presses —
    // usually to scroll or to search within the page — goes into the input instead.
    stage.focus(paneId)
  }

  return (
    <div className="hdw-browser" hidden={isHidden}>
      <form className="hdw-navbar" onSubmit={submit}>
        <Tooltip label="Back" side="bottom">
          <Button
            variant="ghost" size="sm" type="button"
            icon={<IconChevronLeftOutline14 />}
            aria-label="Back"
            disabled={!status.canBack}
            onClick={() => { stage.goBack(paneId) }}
          />
        </Tooltip>
        <Tooltip label="Forward" side="bottom">
          <Button
            variant="ghost" size="sm" type="button"
            icon={<IconChevronRightOutline14 />}
            aria-label="Forward"
            disabled={!status.canForward}
            onClick={() => { stage.goForward(paneId) }}
          />
        </Tooltip>
        <Tooltip label={status.loading ? 'Stop' : 'Reload'} side="bottom">
          <Button
            variant="ghost" size="sm" type="button"
            icon={status.loading ? <IconStopFill16 /> : <IconRefreshOutline16 />}
            aria-label={status.loading ? 'Stop' : 'Reload'}
            onClick={() => { status.loading ? stage.stop(paneId) : stage.reload(paneId) }}
          />
        </Tooltip>
        <Input
          className="hdw-address"
          aria-label="Address"
          value={input}
          spellCheck={false}
          placeholder="Enter a web address"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => { setInput(event.target.value) }}
          onFocus={() => { setTyping(true) }}
          onBlur={() => { setTyping(false) }}
        />
      </form>
      {/* The web page is painted over this slot. It is empty, and it has to be. */}
      <div className="hdw-slot" ref={slotRef} aria-hidden />
    </div>
  )
}

/** The initial status, taking any preset address into account. */
function initialStatus(url: string | undefined): TabStatus {
  return url === undefined ? EMPTY_STATUS : { ...EMPTY_STATUS, url, loading: true }
}
