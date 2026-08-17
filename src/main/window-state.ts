/**
 * Remember the window's position and size between launches.
 *
 * A saved position is only reused while it is still visible: if the user unplugs a
 * second monitor, the window must not open at coordinates that lie outside every
 * display.
 * @module
 */

import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Default size for the very first run. */
const DEFAULT_SIZE = { width: 1280, height: 860 }

/** Smallest acceptable size, matching the window's own `minWidth`/`minHeight`. */
const MIN_SIZE = { width: 900, height: 600 }

/** Defer the disk write while the user is still dragging the window around. */
const SAVE_DEBOUNCE_MS = 400

/** The window state that gets saved. */
interface WindowState {
  /** The window's bounds in its normal state (not maximized). */
  bounds: Rectangle
  /** Whether the window is maximized. */
  maximized: boolean
}

function statePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/** Whether the bounds fall inside the work area of at least one attached display. */
function isVisible(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x)
    const overlapY = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y)
    // Demand a large enough patch rather than a touching edge: the title bar has to be reachable.
    return overlapX > 120 && overlapY > 60
  })
}

function isRectangle(value: unknown): value is Rectangle {
  const candidate = value as Partial<Rectangle> | null
  return candidate !== null && typeof candidate === 'object'
    && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(candidate[key as keyof Rectangle]))
}

/**
 * Read the saved state, ignoring it when the file is broken or the position is no
 * longer visible.
 * @returns bounds options to pass to `BrowserWindow`, plus the maximized flag.
 */
export function restoreState(): { bounds: Partial<Rectangle>; maximized: boolean } {
  const fallback = { bounds: DEFAULT_SIZE, maximized: false }
  const path = statePath()
  if (!existsSync(path)) return fallback
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const state = parsed as Partial<WindowState>
    if (!isRectangle(state.bounds)) return fallback
    const bounds = {
      ...state.bounds,
      width: Math.max(state.bounds.width, MIN_SIZE.width),
      height: Math.max(state.bounds.height, MIN_SIZE.height),
    }
    // The size is still reusable even when the coordinates have wandered off screen;
    // only the position has to be dropped, and dropping it lets Electron center.
    if (!isVisible(bounds)) {
      return { bounds: { width: bounds.width, height: bounds.height }, maximized: state.maximized === true }
    }
    return { bounds, maximized: state.maximized === true }
  } catch {
    return fallback
  }
}

/** Watch the window and save its state whenever the user moves, resizes, or closes it. */
export function trackState(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined

  const save = (): void => {
    if (window.isDestroyed()) return
    const state: WindowState = {
      // getNormalBounds returns the bounds from before maximizing, so a restore brings
      // back the size the user actually chose rather than the full-screen size.
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
    }
    try {
      writeFileSync(statePath(), JSON.stringify(state))
    } catch {
      // If the write fails, the next launch uses the default size — not worth bothering anyone.
    }
  }

  const scheduleSave = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(save, SAVE_DEBOUNCE_MS)
  }

  window.on('resize', scheduleSave)
  window.on('move', scheduleSave)
  window.on('maximize', scheduleSave)
  window.on('unmaximize', scheduleSave)
  // Write immediately on close: the debounce timer would not fire before the app exits.
  window.on('close', () => {
    if (timer !== undefined) clearTimeout(timer)
    save()
  })
}
