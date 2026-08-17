/**
 * The Terminal tab: a real Windows shell, right inside the panel.
 *
 * The screen is drawn by `@xterm/xterm` — the same library VS Code and most
 * in-browser terminals use. It handles the hard parts: ANSI escape sequences, colors,
 * the cursor, scrolling, text selection, the double-width characters of Chinese,
 * Japanese and Korean. Rewriting that ourselves would be thousands of lines and still
 * wrong in the places nobody thinks about.
 *
 * **Why the terminal is always dark, even while the app is in light mode.** The 16-color
 * ANSI palette (the reds, greens and yellows `npm`, `git` and `dir` use) does not exist
 * in DeepSeek's token system — they have amber, blue, green, red and neutral, with cyan
 * and magenta missing entirely. Two ways forward: invent a 16-color palette, or use
 * xterm's default one. That default palette is designed for a dark background; put it on
 * white and "bright white" and "bright yellow" become nearly invisible. So the choice was
 * to invent no colors at all: keep the terminal's face dark using upstream's own
 * `--dsw-static-*` tokens (which deliberately do not change with light/dark), while the
 * frame around it still follows the theme like everything else.
 * @module
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { Button, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

/** How many lines are kept for scrolling back. */
const SCROLLBACK = 5000

type PtyState = 'opening' | 'live' | 'closed'

/**
 * Read a computed CSS variable. Returns an empty string when there is none, leaving the
 * caller to decide its own fallback.
 */
function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim()
}

export interface TerminalTabProps {
  /** The directory the terminal opens in — the workspace path, re-validated by the server. */
  root: string | undefined
  /** Covered because another tab is showing. Not unmounted, only hidden. */
  isHidden: boolean
}

/**
 * The Terminal tab's body.
 * @param props - see {@link TerminalTabProps}.
 * @returns the tab element.
 */
export function TerminalTab({ root, isHidden }: TerminalTabProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | undefined>(undefined)
  const fitRef = useRef<FitAddon | undefined>(undefined)
  const wsRef = useRef<WebSocket | undefined>(undefined)
  const [state, setState] = useState<PtyState>('opening')
  const [note, setNote] = useState<string | undefined>(undefined)
  // Bumped to force the effect to rebuild the whole session — the only route the "Reopen"
  // button has.
  const [attempt, setAttempt] = useState(0)

  /** Re-measure the size and tell the shell, so text wraps in the right place. */
  const refit = useCallback((): void => {
    const host = hostRef.current
    const term = termRef.current
    const fit = fitRef.current
    // While hidden, the element has size 0; measuring then yields a nonsense number and
    // xterm would redraw the whole screen at it.
    if (host === null || term === undefined || fit === undefined) return
    if (host.clientWidth === 0 || host.clientHeight === 0) return
    fit.fit()
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }))
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (host === null || root === undefined) return undefined

    setState('opening')
    setNote(undefined)

    const term = new Terminal({
      scrollback: SCROLLBACK,
      cursorBlink: true,
      fontSize: 12,
      fontFamily: cssVar(document.documentElement, '--ds-font-family-code')
        || 'ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace',
      theme: {
        background: cssVar(host, '--hdw-term-bg'),
        foreground: cssVar(host, '--hdw-term-fg'),
        cursor: cssVar(host, '--hdw-term-fg'),
        selectionBackground: cssVar(host, '--hdw-term-sel'),
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    termRef.current = term
    fitRef.current = fit
    if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit()

    const url = new URL('/hdw/pty', location.href)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('cwd', root)
    url.searchParams.set('cols', String(term.cols))
    url.searchParams.set('rows', String(term.rows))

    const ws = new WebSocket(url)
    // Raw bytes, not decoded by the browser: a UTF-8 character can be split across two
    // packets, and xterm is the place that knows how to join it back correctly.
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onmessage = (event: MessageEvent<unknown>) => {
      // A binary frame is screen content; a text frame is a control message. Split by frame
      // type, so no string a user types is mistaken for a command.
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data))
        return
      }
      if (typeof event.data !== 'string') return
      let msg: { t?: string, exitCode?: number, reason?: string }
      try {
        msg = JSON.parse(event.data) as typeof msg
      } catch {
        return
      }
      if (msg.t === 'ready') { setState('live'); return }
      if (msg.t === 'error') { setState('closed'); setNote(msg.reason); return }
      if (msg.t === 'exit') {
        setState('closed')
        setNote(`Shell exited (code ${String(msg.exitCode ?? 0)}).`)
      }
    }

    ws.onerror = () => {
      setState('closed')
      setNote('Lost the connection to the engine.')
    }

    ws.onclose = () => {
      // If `exit` or `error` already gave a specific explanation, keep it rather than
      // overwriting it with something vaguer.
      setState('closed')
      setNote((prev) => prev ?? 'The terminal session closed.')
    }

    const onInput = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(data))
    })

    // The panel changing width, the window resizing, the tab coming back into view — all
    // three arrive here.
    const observer = new ResizeObserver(() => { refit() })
    observer.observe(host)

    return () => {
      observer.disconnect()
      onInput.dispose()
      // Detach the listeners before closing, or `onclose` would setState on an unmounted
      // component.
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      ws.close()
      term.dispose()
      wsRef.current = undefined
      termRef.current = undefined
      fitRef.current = undefined
    }
  }, [root, attempt, refit])

  // Going from hidden to shown: the element has just regained a size, so it has to be
  // re-measured. Wait one frame for the browser to finish laying it out.
  useEffect(() => {
    if (isHidden) return undefined
    const id = requestAnimationFrame(() => { refit() })
    return () => { cancelAnimationFrame(id) }
  }, [isHidden, refit])

  // `hidden` here is not surplus caution: this component is NOT unmounted on a tab
  // switch, so without it the Terminal's notice line would sit right in the middle of the
  // Files tab.
  if (root === undefined) {
    return <div className="hdw-empty" hidden={isHidden}>No session is open yet, so there is no folder to start a terminal in. Start a session and come back.</div>
  }

  return (
    <div className="hdw-termwrap" hidden={isHidden}>
      {state === 'closed' && (
        <div className="hdw-termbar">
          <span className="hdw-note">{note ?? 'The terminal session closed.'}</span>
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefreshOutline16 />}
            onClick={() => { setAttempt((n) => n + 1) }}
          >
            Reopen
          </Button>
        </div>
      )}
      <div className="hdw-term" ref={hostRef} />
    </div>
  )
}
