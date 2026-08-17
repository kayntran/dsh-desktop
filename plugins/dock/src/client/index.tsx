/**
 * The right-hand panel's client half. The engine serves this file to the browser at
 * `/plugins/harness-desktop-dock/client.js`.
 *
 * **Level 1 — additive only.** Two registrations, both into empty `list` slots upstream
 * leaves open: `shell.overlay` (the layer floating above every column) and
 * `conversation.session.header.utilities` (the right-aligned utility group on the
 * session header row). No slot with an owner is taken, so every future DeepSeek update
 * still arrives intact.
 * @module
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import xtermStyles from '@xterm/xterm/css/xterm.css'
import { AgentControlRow } from './AgentControlRow.tsx'
import { openBridge } from './bus.ts'
import { DockPanel } from './DockPanel.tsx'
import { DockToggle } from './DockToggle.tsx'
import { ScreenshotCard, SCREENSHOT_TOOL } from './ScreenshotCard.tsx'
import { shotUrl } from './shot-loader.ts'
import { createStageHolder } from './stage-holder.ts'
import { createDock } from './store.ts'
import styles from './styles.css'

// Pull upstream's slot declarations into the program. Without these lines
// `shell.overlay` and `conversation.session.header.utilities` do not exist as far as the
// type system is concerned.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'

export const name = 'harness-desktop-dock'

export const inject = ['slots']

/**
 * Inject the plugin's CSS with an ownership tag, following upstream's convention for
 * plugin stylesheets — that tag is how the module teardown knows whose the tag is.
 *
 * xterm's stylesheet rides along. It only targets `.xterm*` classes so it cannot reach
 * upstream's UI, and it shares one tag, so unloading the plugin cleans up both.
 * @returns the disposer that removes the style tag.
 */
function injectStyles(): () => void {
  const tag = document.createElement('style')
  tag.dataset['plugin'] = name
  tag.dataset['pluginCss'] = `${name}/styles.css`
  tag.textContent = `${xtermStyles}\n${styles}`
  document.head.append(tag)
  return () => { tag.remove() }
}

/**
 * Plugin body on the browser side.
 * @param ctx - the client-side root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(injectStyles, 'hdw-dock: css')

  // One store shared by both registrations. Passed through `inject` rather than
  // `store`: these two slots sit in different scopes (window and session), and `store`
  // hands each scope its own copy — see the module comment in `store.ts`.
  const dock = createDock()

  // The holder for the webview stage. Built here because the bridge needs it NOW, while
  // the stage itself only exists once the panel mounts — see `stage-holder.ts`.
  const stageHolder = createStageHolder()

  const share = (): {
    hooks: { dock: typeof dock.store }
    actions: typeof dock.actions
    stageHolder: typeof stageHolder
  } => ({ hooks: { dock: dock.store }, actions: dock.actions, stageHolder })

  // The bridge to the Node half. Placed HERE rather than inside `DockPanel`: a slot may
  // remount a component at any time, and a remounted bridge is a dead bridge — silently,
  // showing up only as every Node-half request timing out.
  ctx.effect(() => openBridge(dock.actions, stageHolder, dock.store), 'hdw-dock: bridge to the Node half')

  // `ctx.slots.inject` is required, not surplus caution: registering straight into a
  // slot that has not been declared throws. `inject` waits until the slot's owner mounts,
  // and re-registers if that owner crashes and comes back.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'hdw-dock',
    order: 10,
    inject: share,
  }, DockPanel))

  // Last in the utility group, exactly where the reference app puts this button: the
  // rightmost element of the session header.
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'hdw-dock-toggle',
    order: 100,
    inject: share,
  }, DockToggle))

  // The agent's permission switch, in the General section. Placed after upstream's own
  // rows (language order 0, appearance 10, Enter key 20): this is an option belonging to
  // an added feature, not a core option of the app.
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'hdw-agent-control',
    order: 50,
    inject: share,
  }, AgentControlRow))

  // The screenshot command's result card.
  //
  // **Level 1.** This slot is keyed by tool name, and the key here is our own tool —
  // upstream states plainly that this counts as additive. The other eleven tools are
  // deliberately NOT claimed: upstream's default row draws them well enough, and
  // claiming more would mean maintaining a row of our own for nothing in return.
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: SCREENSHOT_TOOL,
    inject: () => ({ loadShot: async (ref: ImageAttachmentRef) => shotUrl(ref) }),
  }, ScreenshotCard))
}
